// PromptGod service worker — background script
// Handles message routing between content scripts and LLM APIs
// Uses chrome.runtime.connect (ports) for streaming, NOT sendMessage

import type { ContentMessage, ServiceWorkerMessage } from './lib/types'
import { buildGemmaMetaPromptWithIntensity } from './lib/gemma-legacy/llm-branch'
import {
  buildUserMessage,
  callGoogleAPI,
  callGroqCompletionAPI,
  callOpenRouterCompletionAPI,
} from './lib/llm-client'
import { GROQ_FALLBACK_MODEL, GROQ_PRIMARY_MODEL } from './lib/rewrite-groq/models'
import { isEchoWithPadding } from './lib/rewrite-core/validate'
import { RequestSupervisor } from './background/supervisor'
import { translateError } from './lib/error-translator'
import { runPromptGodContextMenuHandler } from './content/context-menu-handler'
import {
  buildContextUserMessage,
  buildGemmaSelectedTextMetaPrompt,
  cleanContextEnhancementOutput,
} from './lib/gemma-legacy/text-branch'
import { buildConservativeFallback } from './lib/rewrite-core/fallback'
import { repairRewrite } from './lib/rewrite-core/repair'
import type { RewriteProvider } from './lib/rewrite-core/types'
import { buildLlmBranchSpec } from './lib/rewrite-llm-branch/spec-builder'
import { buildLlmRetryUserMessage } from './lib/rewrite-llm-branch/retry'
import { validateLlmBranchRewrite } from './lib/rewrite-llm-branch/validator'
import { buildTextBranchSpec } from './lib/rewrite-text-branch/spec-builder'
import { repairTextBranchRewrite } from './lib/rewrite-text-branch/repair'
import { buildTextRetryUserMessage } from './lib/rewrite-text-branch/retry'
import { validateTextBranchRewrite } from './lib/rewrite-text-branch/validator'
import { GOOGLE_GEMMA_FALLBACK_MODEL, GOOGLE_PRIMARY_MODEL, isGoogleGemmaModel } from './lib/rewrite-google/models'
import { shouldEscalateGoogleToFallback } from './lib/rewrite-google/retry-policy'
import { inspectOpenRouterAccountStatus, markOpenRouterDailyCapReached, resetOpenRouterAccountStatusSession } from './lib/rewrite-openrouter/account-status'
import { getOpenRouterMaxTokens } from './lib/rewrite-openrouter/budget-policy'
import {
  OPENROUTER_CATALOG_TTL_MS,
  getOpenRouterCatalogWithPinnedFallback,
  refreshOpenRouterCatalog,
} from './lib/rewrite-openrouter/catalog'
import { OPENROUTER_PRIMARY_FREE_MODEL, normalizeOpenRouterModelId } from './lib/rewrite-openrouter/curation'
import {
  OPENROUTER_MODEL_COOLDOWN_MS,
  buildOpenRouterRouteChain,
  computeOpenRouterRateLimitBackoffMs,
  getOpenRouterCooldownRemainingMs,
  isOpenRouterDailyCapError,
  isOpenRouterRateLimitError,
  parseOpenRouterDailyCapResetMs,
  setOpenRouterModelCooldown,
  shouldTryNextOpenRouterModel,
} from './lib/rewrite-openrouter/route-policy'

const REQUEST_SUPERVISOR_TIMEOUT_MS = 65000
const SUPERVISOR_HEARTBEAT_MS = 30000
const OPENROUTER_CATALOG_ALARM_NAME = 'promptgod-openrouter-catalog-refresh'
export const CONTEXT_MENU_ID = 'promptgod-context-enhance'
export const CONTEXT_MENU_TITLE = 'Enhance with PromptGod'
export const CONTEXT_SELECTION_MAX_CHARS = 10000
const CONTEXT_PORT_NAME = 'context-enhance'

export type ContextSelectionValidation =
  | { ok: true; selectedText: string }
  | { ok: false; code: 'SELECTION_TOO_SHORT' | 'SELECTION_TOO_LONG'; message: string }

export type ContextEnhanceBootstrapRequest =
  | {
    requestId: string
    status: 'ready'
    selectedText: string
    requestedAt: number
  }
  | {
    requestId: string
    status: 'error'
    code: 'SELECTION_TOO_SHORT' | 'SELECTION_TOO_LONG'
    message: string
    requestedAt: number
  }

function isGoogleGemmaModelId(model: string | undefined): boolean {
  return isGoogleGemmaModel(model)
}

function mapRewriteProvider(provider: string | undefined): RewriteProvider {
  if (provider === 'openrouter') return 'OpenRouter'
  if (provider === 'groq') return 'Groq'
  return 'Google'
}

function assertActiveProvider(provider: string | undefined): void {
  if (provider === undefined || provider === 'google' || provider === 'openrouter' || provider === 'groq') {
    return
  }

  throw new Error(`Unsupported provider: ${provider}. Use a Google, OpenRouter, or Groq key.`)
}

type ProviderFailureChainEntry = {
  branch: 'LLM' | 'Text'
  provider: 'Google' | 'Gemma' | 'OpenRouter' | 'Groq'
  model: string
  stage: 'primary' | 'fallback' | 'final-chain'
  failure: string
}

const supervisor = new RequestSupervisor({
  timeoutMs: REQUEST_SUPERVISOR_TIMEOUT_MS,
  onTimeout: (port) => {
    sendMessage(port, { type: 'SETTLEMENT', status: 'ERROR', message: 'Request timed out while waiting for provider response.' })
    try {
      port.disconnect()
    } catch {
      // no-op
    }
  },
})

console.info('[PromptGod] Service worker started')

function startSupervisorHeartbeat(port: chrome.runtime.Port): () => void {
  const timer = setInterval(() => {
    supervisor.touch(port)
  }, SUPERVISOR_HEARTBEAT_MS)

  return () => clearInterval(timer)
}

async function restrictStorageToTrustedContexts(): Promise<void> {
  const storageArea = chrome.storage?.local as chrome.storage.StorageArea & {
    setAccessLevel?: (options: { accessLevel: 'TRUSTED_CONTEXTS' }) => void | Promise<void>
  }

  if (!storageArea?.setAccessLevel) {
    return
  }

  await Promise.resolve(storageArea.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }))
}

function scheduleOpenRouterCatalogAlarm(): void {
  if (!chrome.alarms?.create) {
    return
  }

  void chrome.alarms.create(OPENROUTER_CATALOG_ALARM_NAME, {
    periodInMinutes: Math.max(1, OPENROUTER_CATALOG_TTL_MS / 60000),
  })
}

// --- Settings cache ---
// Avoids hitting chrome.storage.local.get on every enhance request.
// Invalidated via chrome.storage.onChanged listener.
let cachedSettings: {
  apiKey?: string
  provider?: string
  model?: string
  includeConversationContext?: boolean
  providerApiKeys?: Record<string, string>
} | null = null

type StoredSettings = {
  apiKey?: string
  provider?: string
  model?: string
  includeConversationContext?: boolean
  providerApiKeys?: Record<string, string>
}

async function getSettings(): Promise<{
  apiKey?: string
  provider?: string
  model?: string
  includeConversationContext?: boolean
  providerApiKeys?: Record<string, string>
}> {
  if (!cachedSettings) {
    const storedSettings = await chrome.storage.local.get(['apiKey', 'provider', 'model', 'includeConversationContext', 'providerApiKeys']) as StoredSettings
    const provider = storedSettings?.provider
    const providerApiKeys = storedSettings?.providerApiKeys
    const resolvedApiKey = provider && providerApiKeys ? providerApiKeys[provider] ?? storedSettings?.apiKey : storedSettings?.apiKey

    cachedSettings = {
      apiKey: resolvedApiKey,
      provider,
      model: storedSettings?.model,
      includeConversationContext: storedSettings?.includeConversationContext,
      providerApiKeys,
    }
  }

  return {
    apiKey: cachedSettings.apiKey,
    provider: cachedSettings.provider,
    model: cachedSettings.model,
    includeConversationContext: cachedSettings.includeConversationContext,
    providerApiKeys: cachedSettings.providerApiKeys,
  }
}

// Clears the in-memory settings cache so the next getSettings() re-reads storage.
// In production this happens via the storage.onChanged listener; exported so tests can
// switch providers between cases without cross-test cache bleed.
export function resetSettingsCache(): void {
  cachedSettings = null
}

async function buildOpenRouterModelChain(requestedModel: string): Promise<string[]> {
  const liveModelIds = await getOpenRouterCatalogWithPinnedFallback()
  return buildOpenRouterRouteChain(requestedModel, liveModelIds)
}

function buildOpenRouterDailyCapError(error: unknown): Error {
  const resetAtMs = parseOpenRouterDailyCapResetMs(error)
  markOpenRouterDailyCapReached(resetAtMs)
  const resetSuffix = resetAtMs ? ` (resets at ${new Date(resetAtMs).toISOString()})` : ''
  return new Error(`[ServiceWorker] OpenRouter free-models-per-day cap reached${resetSuffix}`)
}

export function validateContextSelection(selectionText: string | undefined): ContextSelectionValidation {
  const selectedText = (selectionText ?? '').trim()

  if (selectedText.length > CONTEXT_SELECTION_MAX_CHARS) {
    return {
      ok: false,
      code: 'SELECTION_TOO_LONG',
      message: 'Selection is too long. Try a shorter passage.',
    }
  }

  if (shouldSkipContextSelection(selectedText)) {
    return {
      ok: false,
      code: 'SELECTION_TOO_SHORT',
      message: 'Select a little more text to enhance.',
    }
  }

  return { ok: true, selectedText }
}

function shouldSkipContextSelection(selectionText: string): boolean {
  const words = selectionText.trim().split(/\s+/)
  return words.length < 3 || words[0] === ''
}

export function createContextEnhanceRequest(
  validation: ContextSelectionValidation,
  requestId: string = crypto.randomUUID(),
  requestedAt: number = Date.now()
): ContextEnhanceBootstrapRequest {
  if (!validation.ok) {
    return {
      requestId,
      status: 'error',
      code: validation.code,
      message: validation.message,
      requestedAt,
    }
  }

  return {
    requestId,
    status: 'ready',
    selectedText: validation.selectedText,
    requestedAt,
  }
}

export function buildContextInjectionTarget(tabId: number, frameId?: number): chrome.scripting.InjectionTarget {
  const target: chrome.scripting.InjectionTarget = { tabId }

  if (typeof frameId === 'number' && frameId >= 0) {
    target.frameIds = [frameId]
  }

  return target
}

export function registerContextMenu(): void {
  if (!chrome.contextMenus?.create) return

  chrome.contextMenus.remove(CONTEXT_MENU_ID, () => {
    void chrome.runtime.lastError
    chrome.contextMenus.create(
      {
        id: CONTEXT_MENU_ID,
        title: CONTEXT_MENU_TITLE,
        contexts: ['selection'],
      },
      () => {
        const error = chrome.runtime.lastError
        if (error && !/duplicate id/i.test(error.message ?? '')) {
          console.info({ cause: error.message }, '[PromptGod] Could not register context menu')
        }
      }
    )
  })
}

export async function handleContextMenuClick(
  info: Pick<chrome.contextMenus.OnClickData, 'menuItemId' | 'selectionText' | 'frameId'>,
  tab?: chrome.tabs.Tab
): Promise<void> {
  if (info.menuItemId !== CONTEXT_MENU_ID) return

  const tabId = tab?.id
  if (typeof tabId !== 'number') {
    console.info('[PromptGod] Context enhance skipped because the clicked tab has no id')
    return
  }

  const validation = validateContextSelection(info.selectionText)
  const request = createContextEnhanceRequest(validation)

  try {
    await injectContextEnhanceRequest(tabId, info.frameId, request)
  } catch (error) {
    console.info(
      {
        cause: error instanceof Error ? error.message : String(error),
        tabId,
        frameId: info.frameId,
      },
      '[PromptGod] Could not inject text branch request'
    )
  }
}

async function injectContextEnhanceRequest(
  tabId: number,
  frameId: number | undefined,
  request: ContextEnhanceBootstrapRequest
): Promise<void> {
  if (!chrome.scripting?.executeScript) return

  await chrome.scripting.executeScript({
    target: buildContextInjectionTarget(tabId, frameId),
    func: runPromptGodContextMenuHandler,
    args: [request],
  })
}

export function initServiceWorker() {
  void restrictStorageToTrustedContexts().catch((error) => {
    console.info({ cause: error }, '[PromptGod] Could not restrict storage access level')
  })

  chrome.storage.onChanged.addListener(() => {
    cachedSettings = null
    resetOpenRouterAccountStatusSession()
  })

  registerContextMenu()
  chrome.runtime.onInstalled?.addListener(() => {
    registerContextMenu()
    scheduleOpenRouterCatalogAlarm()
    void refreshOpenRouterCatalog().catch((error) => {
      console.info({ cause: error }, '[PromptGod] OpenRouter catalog refresh failed on install')
    })
  })
  chrome.runtime.onStartup?.addListener(() => {
    registerContextMenu()
    scheduleOpenRouterCatalogAlarm()
    void refreshOpenRouterCatalog().catch((error) => {
      console.info({ cause: error }, '[PromptGod] OpenRouter catalog refresh failed on startup')
    })
  })
  chrome.contextMenus?.onClicked?.addListener((info, tab) => {
    void handleContextMenuClick(info, tab)
  })

  scheduleOpenRouterCatalogAlarm()
  chrome.alarms?.onAlarm?.addListener((alarm) => {
    if (alarm.name !== OPENROUTER_CATALOG_ALARM_NAME) {
      return
    }

    void refreshOpenRouterCatalog().catch((error) => {
      console.info({ cause: error }, '[PromptGod] OpenRouter catalog alarm refresh failed')
    })
  })

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'PING') {
      sendResponse({ type: 'PONG' })
      return false
    }

    if (msg.type === 'GET_CONTENT_SETTINGS') {
      void getSettings()
        .then((settings) => {
          sendResponse({
            type: 'CONTENT_SETTINGS',
            includeConversationContext: settings.includeConversationContext === true,
            model: settings.model,
          })
        })
        .catch(() => {
          sendResponse({
            type: 'CONTENT_SETTINGS',
            includeConversationContext: false,
          })
        })
      return true
    }

    if (msg.type === 'GET_TOOLTIP_STATE') {
      void chrome.storage.local.get(['hasSeenTooltip'])
        .then((result) => {
          sendResponse({ type: 'TOOLTIP_STATE', hasSeenTooltip: result.hasSeenTooltip === true })
        })
        .catch(() => {
          sendResponse({ type: 'TOOLTIP_STATE', hasSeenTooltip: true })
        })
      return true
    }

    if (msg.type === 'SET_TOOLTIP_SEEN') {
      void chrome.storage.local.set({ hasSeenTooltip: true })
        .then(() => sendResponse({ type: 'TOOLTIP_STATE', hasSeenTooltip: true }))
        .catch(() => sendResponse({ type: 'TOOLTIP_STATE', hasSeenTooltip: true }))
      return true
    }

    return false
  })

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'enhance' && port.name !== CONTEXT_PORT_NAME) {
      return
    }

    console.info({ portName: port.name }, '[PromptGod] Port connected')

    const abortController = new AbortController()
    port.onDisconnect.addListener(() => {
      abortController.abort()
    })

    port.onMessage.addListener((msg: ContentMessage) => {
      if (port.name === 'enhance' && msg.type === 'ENHANCE') {
        handleEnhance(port, msg, abortController.signal)
      } else if (port.name === CONTEXT_PORT_NAME && msg.type === 'CONTEXT_ENHANCE') {
        handleContextEnhance(port, msg, abortController.signal)
      }
    })
  })
}

if (typeof chrome !== 'undefined') {
  initServiceWorker()
}

export async function handleEnhance(

  port: chrome.runtime.Port,
  msg: ContentMessage & { type: 'ENHANCE' },
  signal: AbortSignal
): Promise<void> {
  console.info(
    { platform: msg.platform, promptLength: msg.rawPrompt.length, context: msg.context },
    '[PromptGod] Received ENHANCE request'
  )

  supervisor.start(port)
  let stopHeartbeat: (() => void) | undefined

  try {
    sendMessage(port, { type: 'START' })
    stopHeartbeat = startSupervisorHeartbeat(port)

    const { apiKey, provider, model, providerApiKeys } = await getSettings()

    if (!apiKey) {
      sendMessage(port, {
        type: 'ERROR',
        message: 'No API key set. Open PromptGod settings to add your key.',
        code: 'NO_API_KEY',
      })
      port.disconnect()
      return
    }
    assertActiveProvider(provider)

    // BYOK mode — direct API call
    const promptWordCount = msg.rawPrompt.trim().split(/\s+/).length
    const effectiveRecentContext = selectLlmRecentContext(msg.rawPrompt, msg.context, msg.recentContext)
    const isFrozenGemmaPath = provider === 'google' && isGoogleGemmaModelId(model)

    if (!isFrozenGemmaPath) {
      const finalText = await runLlmBranchWithProviderFallback({
        apiKey,
        providerApiKeys,
        provider,
        model,
        platform: msg.platform,
        rawPrompt: msg.rawPrompt,
        promptWordCount,
        context: msg.context,
        recentContext: effectiveRecentContext,
        signal,
      })

      sendMessage(port, { type: 'TOKEN', text: finalText })
      sendMessage(port, { type: 'DONE' })
      sendMessage(port, { type: 'SETTLEMENT', status: 'DONE' })
      disconnectPortSoon(port)
      incrementCounter('totalEnhancements', msg.platform)
      console.info('[PromptGod] Enhancement complete')
      return
    }

    const systemPrompt = buildGemmaMetaPromptWithIntensity(
      msg.platform,
      msg.context.isNewConversation,
      msg.context.conversationLength,
      promptWordCount,
      effectiveRecentContext
    )

    const userMessage = buildUserMessage(msg.rawPrompt, msg.platform, msg.context, effectiveRecentContext)

    console.info(
      { platform: msg.platform, provider, model },
      '[PromptGod] Calling LLM API (BYOK)'
    )

    let responseText: string
    try {
      responseText = await callGoogleAPI(
        apiKey,
        systemPrompt,
        userMessage,
        model ?? GOOGLE_PRIMARY_MODEL,
        512
      )
    } catch (error) {
      if (isGoogleGemmaModelId(model) && isGemmaTimeoutError(error)) {
        throw new DirectGemmaTimeoutError(error)
      }
      throw error
    }
    if (isGoogleGemmaModelId(model) && isNoChangeLlmOutput(msg.rawPrompt, responseText)) {
      throw new DirectGemmaNoChangeError()
    }
    sendMessage(port, { type: 'TOKEN', text: responseText })

    sendMessage(port, { type: 'DONE' })
    sendMessage(port, { type: 'SETTLEMENT', status: 'DONE' })
    disconnectPortSoon(port)

    // Increment usage counters
    incrementCounter('totalEnhancements', msg.platform)

    console.info('[PromptGod] Enhancement complete')
  } catch (error) {
    if (signal.aborted) {
      console.info('[PromptGod] Enhancement aborted — port disconnected')
      return
    }

    // Increment error counter
    incrementCounter('errorCount')

    console.error('[PromptGod] Enhancement failed', error)
    const errorMessage = formatErrorMessage(error)
    sendMessage(port, {
      type: 'ERROR',
      message: errorMessage,
    })
    sendMessage(port, { type: 'SETTLEMENT', status: 'ERROR', message: errorMessage })
    disconnectPortSoon(port)
  } finally {
    stopHeartbeat?.()
    supervisor.stop(port)
  }
}

type LlmBranchPipelineRequest = {
  apiKey: string
  provider?: string
  providerApiKeys?: Record<string, string>
  model?: string
  platform: string
  rawPrompt: string
  promptWordCount: number
  context: {
    isNewConversation: boolean
    conversationLength: number
  }
  recentContext?: string
  signal: AbortSignal
  escalateOnValidationFailure?: boolean
}

class RewriteValidationFailure extends Error {
  constructor(readonly branch: 'LLM' | 'Text') {
    super(`[ServiceWorker] ${branch} branch rewrite failed validation after targeted retry`)
    this.name = 'RewriteValidationFailure'
  }
}

class AllProvidersFailedError extends Error {
  constructor(
    readonly branch: 'LLM' | 'Text',
    readonly failureChain: ProviderFailureChainEntry[]
  ) {
    const chainSummary = failureChain
      .map((entry) => `${entry.provider}/${entry.model}: ${entry.failure}`)
      .join(' | ')

    super(`All providers failed for ${branch} branch. Failure chain: ${chainSummary}`)
    this.name = 'AllProvidersFailedError'
  }
}

class DirectGemmaNoChangeError extends Error {
  constructor() {
    super('[ServiceWorker] Direct Gemma returned the prompt unchanged')
    this.name = 'DirectGemmaNoChangeError'
  }
}

class DirectGemmaTimeoutError extends Error {
  constructor(cause: unknown) {
    super('[ServiceWorker] Direct Gemma timed out before returning a rewrite', {
      cause: cause instanceof Error ? cause : undefined,
    })
    this.name = 'DirectGemmaTimeoutError'
  }
}

function selectLlmRecentContext(
  rawPrompt: string,
  context: { isNewConversation: boolean; conversationLength: number },
  recentContext?: string
): string | undefined {
  const trimmedContext = recentContext?.trim()
  if (!trimmedContext || context.isNewConversation) {
    return undefined
  }

  const promptWordCount = countWords(rawPrompt)
  if (promptWordCount <= 18 || explicitlyReferencesPriorContext(rawPrompt)) {
    return trimmedContext
  }

  console.info({
    branch: 'LLM',
    promptWordCount,
    recentContextLength: trimmedContext.length,
  }, '[PromptGod] Dropping recent context for self-contained LLM prompt')

  return undefined
}

function countWords(text: string): number {
  const words = text.trim().match(/\S+/g)
  return words ? words.length : 0
}

function explicitlyReferencesPriorContext(text: string): boolean {
  return /\b(?:above|previous|earlier|last (?:message|answer|response|reply)|previous (?:message|answer|response|reply|draft|output)|the (?:above|previous) (?:message|answer|response|reply|draft|output)|this (?:answer|response|reply|conversation|thread|chat)|from (?:this|the) (?:conversation|thread|chat)|as discussed|you just (?:said|wrote|gave|mentioned)|what you (?:just )?(?:said|wrote|gave|mentioned)|use (?:that|the above|the previous)|continue from)\b/i.test(text)
}

function isGemmaTimeoutError(error: unknown): boolean {
  return error instanceof Error && /Request timed out after|overall request budget exceeded/i.test(error.message)
}

// Groq → OpenRouter-Nemotron escalation gate. Escalate on any provider/validation
// failure so Nemotron catches whatever Groq misses (the "Groq+Nemo combo"); the only
// non-escalating case is a user abort, which must propagate.
function shouldEscalateGroqToFallback(error: unknown): boolean {
  if (error instanceof Error && /aborted/i.test(error.message)) return false
  return true
}

// Groq chain: 70B primary → OpenRouter-Nemotron-Super → Groq 8B backstop. Exhaust the strong
// models first, then fall to the 8B instant model (separate, far larger free-tier bucket on the
// same Groq key) as the "can't fully run out" net. Parallel to the Google chain; the
// Google/Gemini path is untouched. Activates only when the user selects Groq.
async function runGroqBranchWithNemotronFallback(request: LlmBranchPipelineRequest): Promise<string> {
  const failureChain: ProviderFailureChainEntry[] = []
  const groqModel = request.model ?? GROQ_PRIMARY_MODEL

  // Stage 1 — Groq 70B primary.
  try {
    return await runLlmBranchPipeline({
      ...request,
      model: groqModel,
      escalateOnValidationFailure: true,
    })
  } catch (error) {
    failureChain.push(buildFailureChainEntry('LLM', 'Groq', groqModel, 'primary', error))
    if (!(error instanceof RewriteValidationFailure) && !shouldEscalateGroqToFallback(error)) {
      throw error
    }
    console.info({
      cause: error,
      from: 'Groq',
      to: 'OpenRouter',
      trigger: error instanceof RewriteValidationFailure ? 'validation-failure' : 'provider-fallback-eligible',
    }, '[PromptGod] Escalating Groq LLM branch request to OpenRouter Nemotron fallback')
  }

  // Stage 2 — OpenRouter Nemotron Super (only when a key is saved). A failure here does NOT end
  // the chain; it falls through to the Groq 8B backstop below.
  const openRouterKey = request.providerApiKeys?.openrouter
  if (openRouterKey) {
    try {
      return await runLlmBranchPipeline({
        ...request,
        apiKey: openRouterKey,
        provider: 'openrouter',
        model: OPENROUTER_PRIMARY_FREE_MODEL,
        escalateOnValidationFailure: true,
      })
    } catch (error) {
      failureChain.push(buildFailureChainEntry('LLM', 'OpenRouter', OPENROUTER_PRIMARY_FREE_MODEL, 'fallback', error))
      console.info({
        cause: error,
        from: 'OpenRouter',
        to: 'Groq',
        trigger: error instanceof RewriteValidationFailure ? 'validation-failure' : 'provider-fallback-eligible',
      }, '[PromptGod] Escalating OpenRouter Nemotron to Groq 8B backstop')
    }
  } else {
    failureChain.push({
      branch: 'LLM',
      provider: 'OpenRouter',
      model: OPENROUTER_PRIMARY_FREE_MODEL,
      stage: 'fallback',
      failure: 'no OpenRouter key saved; skipped to Groq 8B backstop',
    })
  }

  // Stage 3 — Groq 8B backstop. escalateOnValidationFailure is off so a validation miss yields a
  // conservative fallback rather than a hard error: the backstop's job is to always return text.
  try {
    return await runLlmBranchPipeline({
      ...request,
      model: GROQ_FALLBACK_MODEL,
      escalateOnValidationFailure: false,
    })
  } catch (error) {
    failureChain.push(buildFailureChainEntry('LLM', 'Groq', GROQ_FALLBACK_MODEL, 'final-chain', error))
    throw buildAllProvidersFailedError('LLM', failureChain)
  }
}

async function runLlmBranchWithProviderFallback(request: LlmBranchPipelineRequest): Promise<string> {
  if (request.provider === 'groq') {
    return await runGroqBranchWithNemotronFallback(request)
  }
  if (request.provider !== 'google') {
    return await runLlmBranchPipeline(request)
  }

  const failureChain: ProviderFailureChainEntry[] = []

  try {
    return await runLlmBranchPipeline({
      ...request,
      model: request.model ?? GOOGLE_PRIMARY_MODEL,
      escalateOnValidationFailure: true,
    })
  } catch (error) {
    failureChain.push(buildFailureChainEntry('LLM', 'Google', request.model ?? GOOGLE_PRIMARY_MODEL, 'primary', error))
    if (!(error instanceof RewriteValidationFailure) && !shouldEscalateGoogleToFallback(error)) {
      throw error
    }
    console.info({
      cause: error,
      from: 'Google',
      to: 'Gemma',
      trigger: error instanceof RewriteValidationFailure ? 'validation-failure' : 'provider-fallback-eligible',
    }, '[PromptGod] Escalating Google LLM branch request to frozen Gemma fallback')
  }

  try {
    const systemPrompt = buildGemmaMetaPromptWithIntensity(
      request.platform,
      request.context.isNewConversation,
      request.context.conversationLength,
      request.promptWordCount,
      request.recentContext
    )
    const userMessage = buildUserMessage(request.rawPrompt, request.platform, request.context, request.recentContext)
    const gemmaOutput = await collectContextEnhancementText({
      apiKey: request.apiKey,
      provider: 'google',
      model: GOOGLE_GEMMA_FALLBACK_MODEL,
      systemPrompt,
      userMessage,
      promptWordCount: request.promptWordCount,
      signal: request.signal,
    })
    if (isNoChangeLlmOutput(request.rawPrompt, gemmaOutput)) {
      throw new RewriteValidationFailure('LLM')
    }
    return gemmaOutput
  } catch (error) {
    failureChain.push(buildFailureChainEntry('LLM', 'Gemma', GOOGLE_GEMMA_FALLBACK_MODEL, 'fallback', error))
    if (!(error instanceof RewriteValidationFailure) && !shouldEscalateGoogleToFallback(error)) {
      throw error
    }
    console.info({
      cause: error,
      from: 'Gemma',
      to: 'OpenRouter',
      trigger: error instanceof RewriteValidationFailure ? 'validation-failure' : 'provider-fallback-eligible',
    }, '[PromptGod] Escalating LLM branch request from Gemma to OpenRouter chain')
  }

  const openRouterKey = request.providerApiKeys?.openrouter
  if (!openRouterKey) {
    failureChain.push({
      branch: 'LLM',
      provider: 'OpenRouter',
      model: OPENROUTER_PRIMARY_FREE_MODEL,
      stage: 'final-chain',
      failure: 'no OpenRouter key saved for final fallback',
    })
    throw buildAllProvidersFailedError('LLM', failureChain)
  }

  try {
    return await runLlmBranchPipeline({
      ...request,
      apiKey: openRouterKey,
      provider: 'openrouter',
      model: OPENROUTER_PRIMARY_FREE_MODEL,
      escalateOnValidationFailure: true,
    })
  } catch (error) {
    failureChain.push(buildFailureChainEntry('LLM', 'OpenRouter', OPENROUTER_PRIMARY_FREE_MODEL, 'final-chain', error))
    throw buildAllProvidersFailedError('LLM', failureChain)
  }
}

async function runLlmBranchPipeline({
  apiKey,
  provider,
  model,
  platform,
  rawPrompt,
  promptWordCount,
  context,
  recentContext,
  signal,
  escalateOnValidationFailure = false,
}: LlmBranchPipelineRequest): Promise<string> {
  console.info({
    branch: 'LLM',
    provider,
    model: model ?? '',
    stage: 'pipeline-entry',
  }, '[PromptGod] LLM branch pipeline start')

  const built = buildLlmBranchSpec({
    sourceText: rawPrompt,
    provider: mapRewriteProvider(provider),
    modelId: model ?? '',
    platform,
    isNewConversation: context.isNewConversation,
    conversationLength: context.conversationLength,
    recentContext,
  })

  const firstOutput = await collectContextEnhancementText({
    apiKey,
    provider,
    model,
    systemPrompt: built.systemPrompt,
    userMessage: built.userMessage,
    promptWordCount,
    signal,
  })
  const firstFinal = finalizeLlmBranchCandidate(rawPrompt, firstOutput)
  console.info({
    branch: 'LLM',
    provider,
    model: model ?? '',
    stage: 'first-pass',
    firstOutputLength: firstOutput.length,
    firstValidationOk: firstFinal.validation.ok,
    firstIssueCodes: validationIssueCodes(firstFinal.validation),
  }, '[PromptGod] LLM branch first-pass validation')

  if (firstFinal.validation.ok) {
    return firstFinal.text
  }

  const retryUserMessage = buildLlmRetryUserMessage(rawPrompt, firstOutput, firstFinal.validation.issues)
  console.info({
    branch: 'LLM',
    provider,
    model: model ?? '',
    stage: 'targeted-retry',
    retryFired: true,
    retryIssueCodes: validationIssueCodes(firstFinal.validation),
  }, '[PromptGod] LLM branch targeted retry fired')

  const retryOutput = await collectContextEnhancementText({
    apiKey,
    provider,
    model,
    systemPrompt: built.systemPrompt,
    userMessage: retryUserMessage,
    promptWordCount,
    signal,
  })
  const retryFinal = finalizeLlmBranchCandidate(rawPrompt, retryOutput)
  console.info({
    branch: 'LLM',
    provider,
    model: model ?? '',
    stage: 'targeted-retry-result',
    retryOutputLength: retryOutput.length,
    retryValidationOk: retryFinal.validation.ok,
    retryIssueCodes: validationIssueCodes(retryFinal.validation),
  }, '[PromptGod] LLM branch retry validation')

  if (retryFinal.validation.ok) {
    return retryFinal.text
  }

  // Already-strong prompt: if the model STILL returns only a minimal-touch near-echo after a
  // targeted retry, that is the correct response to a prompt that needs no real improvement —
  // accept it instead of failing the whole provider chain on the echo guard (testing 2026-06-02
  // #1). Scoped to genuine minimal rewordings only: an exact UNCHANGED echo or a lazy
  // echo-plus-padding still fails (we never hand the user their verbatim input back as a result).
  if (isMinimalTouchNoChange(rawPrompt, retryFinal.text, retryFinal.validation)) {
    console.info({
      branch: 'LLM',
      provider,
      model: model ?? '',
      stage: 'minimal-touch-accepted',
    }, '[PromptGod] LLM branch accepted minimal-touch rewrite as no-change')
    return retryFinal.text
  }

  if (escalateOnValidationFailure) {
    throw new RewriteValidationFailure('LLM')
  }

  return buildConservativeFallback({ sourceText: rawPrompt })
}

// True when the only thing wrong with the rewrite is that it is a near-echo of the source
// AND that near-echo is a genuine minimal-touch rewording (not an exact UNCHANGED echo, not a
// lazy echo-plus-padding). On an already-strong prompt this is the right answer, so we ship it
// rather than exhausting the provider chain. Any other issue (dropped deliverable, answered-
// instead, unchanged, padding-echo, etc.) keeps the existing fail/escalate behavior.
function isMinimalTouchNoChange(
  sourceText: string,
  output: string,
  validation: { issues: Array<{ code: string }> }
): boolean {
  if (validation.issues.length === 0) {
    return false
  }
  const echoOnly = validation.issues.every((issue) => issue.code === 'NEAR_ECHO_REWRITE')
  return echoOnly && !isEchoWithPadding(sourceText, output)
}

function finalizeLlmBranchCandidate(sourceText: string, output: string): {
  text: string
  validation: ReturnType<typeof validateLlmBranchRewrite>
} {
  const repaired = repairRewrite({ sourceText, output }).output
  const text = normalizeNoChangeOutput(repaired, sourceText)
  return {
    text,
    validation: validateLlmBranchRewrite(sourceText, text),
  }
}

function validationIssueCodes(validation: { issues: Array<{ code: string }> }): string[] {
  return validation.issues.map((issue) => issue.code)
}

function isNoChangeLlmOutput(sourceText: string, output: string): boolean {
  const cleanOutput = output
    .replace(/\[DIFF:[\s\S]*?\]/gi, '')
    .replace(/^\s*\[NO_CHANGE\]\s*/i, '')
    .trim()
  const normalizedSource = normalizeForNoChangeCompare(sourceText)
  const normalizedOutput = normalizeForNoChangeCompare(cleanOutput)
  return normalizedSource.length > 80 && normalizedSource === normalizedOutput
}

function normalizeForNoChangeCompare(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

type TextBranchPipelineRequest = {
  apiKey: string
  provider?: string
  providerApiKeys?: Record<string, string>
  model?: string
  selectedText: string
  promptWordCount: number
  signal: AbortSignal
  escalateOnValidationFailure?: boolean
}

async function runTextBranchWithProviderFallback(request: TextBranchPipelineRequest): Promise<string> {
  if (request.provider !== 'google') {
    return await runTextBranchPipeline(request)
  }

  const failureChain: ProviderFailureChainEntry[] = []

  try {
    return await runTextBranchPipeline({
      ...request,
      model: request.model ?? GOOGLE_PRIMARY_MODEL,
      escalateOnValidationFailure: true,
    })
  } catch (error) {
    failureChain.push(buildFailureChainEntry('Text', 'Google', request.model ?? GOOGLE_PRIMARY_MODEL, 'primary', error))
    if (!(error instanceof RewriteValidationFailure) && !shouldEscalateGoogleToFallback(error)) {
      throw error
    }
    console.info({ cause: error }, '[PromptGod] Escalating Google Text branch request to frozen Gemma fallback')
  }

  try {
    return cleanContextEnhancementOutput(
      await collectContextEnhancementText({
        apiKey: request.apiKey,
        provider: 'google',
        model: GOOGLE_GEMMA_FALLBACK_MODEL,
        systemPrompt: buildGemmaSelectedTextMetaPrompt(request.promptWordCount),
        userMessage: buildContextUserMessage(request.selectedText),
        promptWordCount: request.promptWordCount,
        signal: request.signal,
      }),
      request.selectedText
    )
  } catch (error) {
    failureChain.push(buildFailureChainEntry('Text', 'Gemma', GOOGLE_GEMMA_FALLBACK_MODEL, 'fallback', error))
    if (!shouldEscalateGoogleToFallback(error)) {
      throw error
    }
    console.info({ cause: error }, '[PromptGod] Escalating Text branch request from Gemma to OpenRouter chain')
  }

  const openRouterKey = request.providerApiKeys?.openrouter
  if (!openRouterKey) {
    failureChain.push({
      branch: 'Text',
      provider: 'OpenRouter',
      model: OPENROUTER_PRIMARY_FREE_MODEL,
      stage: 'final-chain',
      failure: 'no OpenRouter key saved for final fallback',
    })
    throw buildAllProvidersFailedError('Text', failureChain)
  }

  try {
    return await runTextBranchPipeline({
      ...request,
      apiKey: openRouterKey,
      provider: 'openrouter',
      model: OPENROUTER_PRIMARY_FREE_MODEL,
      escalateOnValidationFailure: true,
    })
  } catch (error) {
    failureChain.push(buildFailureChainEntry('Text', 'OpenRouter', OPENROUTER_PRIMARY_FREE_MODEL, 'final-chain', error))
    throw buildAllProvidersFailedError('Text', failureChain)
  }
}

function buildFailureChainEntry(
  branch: 'LLM' | 'Text',
  provider: ProviderFailureChainEntry['provider'],
  model: string,
  stage: ProviderFailureChainEntry['stage'],
  error: unknown
): ProviderFailureChainEntry {
  return {
    branch,
    provider,
    model,
    stage,
    failure: summarizeProviderFailure(error),
  }
}

function summarizeProviderFailure(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function buildAllProvidersFailedError(branch: 'LLM' | 'Text', failureChain: ProviderFailureChainEntry[]): Error {
  console.error(
    { branch, failureChain },
    `[PromptGod] All providers failed for ${branch} branch`
  )

  return new AllProvidersFailedError(branch, failureChain)
}

async function runTextBranchPipeline({
  apiKey,
  provider,
  model,
  selectedText,
  promptWordCount,
  signal,
  escalateOnValidationFailure = false,
}: TextBranchPipelineRequest): Promise<string> {
  const built = buildTextBranchSpec({
    sourceText: selectedText,
    provider: mapRewriteProvider(provider),
    modelId: model ?? '',
  })

  const firstOutput = await collectContextEnhancementText({
    apiKey,
    provider,
    model,
    systemPrompt: built.systemPrompt,
    userMessage: built.userMessage,
    promptWordCount,
    signal,
  })
  const firstFinal = finalizeTextBranchCandidate(selectedText, firstOutput)
  if (firstFinal.validation.ok) {
    return firstFinal.text
  }

  const retryUserMessage = buildTextRetryUserMessage(selectedText, firstOutput, firstFinal.validation.issues)
  const retryOutput = await collectContextEnhancementText({
    apiKey,
    provider,
    model,
    systemPrompt: built.systemPrompt,
    userMessage: retryUserMessage,
    promptWordCount,
    signal,
  })
  const retryFinal = finalizeTextBranchCandidate(selectedText, retryOutput)
  if (retryFinal.validation.ok) {
    return retryFinal.text
  }

  if (escalateOnValidationFailure) {
    throw new RewriteValidationFailure('Text')
  }

  return buildConservativeFallback({ sourceText: selectedText })
}

function finalizeTextBranchCandidate(sourceText: string, output: string): {
  text: string
  validation: ReturnType<typeof validateTextBranchRewrite>
} {
  const text = normalizeNoChangeOutput(repairTextBranchRewrite(sourceText, output), sourceText)
  return {
    text,
    validation: validateTextBranchRewrite(sourceText, text),
  }
}

function normalizeNoChangeOutput(output: string, sourceText: string): string {
  const withoutDiff = output.replace(/\[DIFF:[\s\S]*?\]/gi, '').trim()
  if (/^\[NO_CHANGE\]\b/i.test(withoutDiff)) {
    const body = withoutDiff.replace(/^\[NO_CHANGE\]\s*/i, '').trim()
    return body || sourceText.trim()
  }
  return withoutDiff
}

export async function handleContextEnhance(
  port: chrome.runtime.Port,
  msg: ContentMessage & { type: 'CONTEXT_ENHANCE' },
  signal: AbortSignal
): Promise<void> {
  console.info(
    { requestId: msg.requestId, selectionLength: msg.selectedText.length },
    '[PromptGod] Received text branch request'
  )

  supervisor.start(port)
  let stopHeartbeat: (() => void) | undefined

  try {
    sendMessage(port, { type: 'START' })
    stopHeartbeat = startSupervisorHeartbeat(port)

    const validation = validateContextSelection(msg.selectedText)
    if (!validation.ok) {
      sendMessage(port, {
        type: 'ERROR',
        message: validation.message,
        code: validation.code,
      })
      sendMessage(port, { type: 'SETTLEMENT', status: 'ERROR', message: validation.message })
      disconnectPortSoon(port)
      return
    }

    const { apiKey, provider, model, providerApiKeys } = await getSettings()

    if (!apiKey) {
      const message = 'Set your API key in PromptGod settings.'
      sendMessage(port, {
        type: 'ERROR',
        message,
        code: 'NO_API_KEY',
      })
      sendMessage(port, { type: 'SETTLEMENT', status: 'ERROR', message })
      disconnectPortSoon(port)
      return
    }
    assertActiveProvider(provider)

    const selectedText = validation.selectedText
    const promptWordCount = selectedText.trim().split(/\s+/).length
    const isFrozenGemmaPath = provider === 'google' && isGoogleGemmaModelId(model)
    const systemPrompt = isFrozenGemmaPath
      ? buildGemmaSelectedTextMetaPrompt(promptWordCount)
      : ''
    const userMessage = isFrozenGemmaPath
      ? buildContextUserMessage(selectedText)
      : ''

    console.info(
      { requestId: msg.requestId, provider, model, selectionLength: selectedText.length },
      '[PromptGod] Calling LLM API for text branch'
    )

    const cleanText = isFrozenGemmaPath
      ? cleanContextEnhancementOutput(
        await collectContextEnhancementText({
          apiKey,
          provider,
          model,
          systemPrompt,
          userMessage,
          promptWordCount,
          signal,
        }),
        selectedText
      )
      : await runTextBranchWithProviderFallback({
        apiKey,
        providerApiKeys,
        provider,
        model,
        selectedText,
        promptWordCount,
        signal,
      })
    if (!cleanText) {
      throw new Error('[ServiceWorker] Context enhancement returned no text output')
    }

    sendMessage(port, {
      type: 'RESULT',
      requestId: msg.requestId,
      text: cleanText,
    })
    sendMessage(port, { type: 'DONE' })
    sendMessage(port, { type: 'SETTLEMENT', status: 'DONE' })
    disconnectPortSoon(port)

    incrementCounter('totalEnhancements', 'context')

    console.info(
      { requestId: msg.requestId, resultLength: cleanText.length },
      '[PromptGod] Text branch complete'
    )
  } catch (error) {
    if (signal.aborted) {
      console.info({ requestId: msg.requestId }, '[PromptGod] Text branch aborted — port disconnected')
      return
    }

    incrementCounter('errorCount')

    console.error({ requestId: msg.requestId, cause: error }, '[PromptGod] Text branch failed')
    const errorMessage = formatErrorMessage(error)
    sendMessage(port, {
      type: 'ERROR',
      message: errorMessage,
    })
    sendMessage(port, { type: 'SETTLEMENT', status: 'ERROR', message: errorMessage })
    disconnectPortSoon(port)
  } finally {
    stopHeartbeat?.()
    supervisor.stop(port)
  }
}

type ContextProviderRequest = {
  apiKey: string
  provider?: string
  model?: string
  systemPrompt: string
  userMessage: string
  promptWordCount: number
  signal: AbortSignal
}

async function collectContextEnhancementText({
  apiKey,
  provider,
  model,
  systemPrompt,
  userMessage,
  promptWordCount,
  signal,
}: ContextProviderRequest): Promise<string> {
  if (provider === 'openrouter') {
    return await collectOpenRouterCompletionText(apiKey, systemPrompt, userMessage, model, promptWordCount, signal)
  }

  if (provider === 'groq') {
    return await callGroqCompletionAPI(apiKey, systemPrompt, userMessage, model ?? GROQ_PRIMARY_MODEL, 512)
  }

  if (provider === 'google') {
    return await callGoogleAPI(
      apiKey,
      systemPrompt,
      userMessage,
      model ?? GOOGLE_PRIMARY_MODEL,
      512
    )
  }

  throw new Error(`Unsupported provider: ${provider}. Use a Google, OpenRouter, or Groq key.`)
}

async function collectOpenRouterCompletionText(
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  model: string | undefined,
  promptWordCount: number,
  signal: AbortSignal
): Promise<string> {
  const accountStatus = await inspectOpenRouterAccountStatus(apiKey).catch((error) => {
    console.info({ cause: error }, '[PromptGod] Could not inspect OpenRouter account status')
    return null
  })
  if (accountStatus?.paused) {
    throw new Error('[ServiceWorker] OpenRouter daily limit reached; routing paused for today')
  }

  const requestedModel = normalizeOpenRouterModelId((model ?? '').trim() || OPENROUTER_PRIMARY_FREE_MODEL)
  const modelsToTry = await buildOpenRouterModelChain(requestedModel)

  const perModelFailures: Array<{ model: string; failure: string }> = []
  let lastError: unknown = null
  let rateLimitAttempt = 0

  for (let modelIndex = 0; modelIndex < modelsToTry.length; modelIndex++) {
    if (signal.aborted) {
      throw new Error('[ServiceWorker] Context enhancement aborted')
    }

    const currentModel = modelsToTry[modelIndex]
    const cooldownRemaining = getOpenRouterCooldownRemainingMs(currentModel)
    if (cooldownRemaining > 0) {
      perModelFailures.push({
        model: currentModel,
        failure: `model cooling down for ${Math.ceil(cooldownRemaining / 1000)}s`,
      })
      console.info({ currentModel, cooldownRemaining }, '[PromptGod] Skipping cooled OpenRouter model')
      continue
    }
    const maxTokens = getOpenRouterMaxTokens(currentModel, promptWordCount)

    try {
      return await callOpenRouterCompletionAPI(apiKey, systemPrompt, userMessage, currentModel, maxTokens)
    } catch (error) {
      lastError = error

      if (isOpenRouterDailyCapError(error)) {
        const dailyCapError = buildOpenRouterDailyCapError(error)
        lastError = dailyCapError
        perModelFailures.push({ model: currentModel, failure: summarizeProviderFailure(dailyCapError) })
        console.info({ currentModel }, '[PromptGod] OpenRouter free-models-per-day cap reached on context request')
        break
      }

      if (isOpenRouterRateLimitError(error)) {
        rateLimitAttempt++
        const backoffMs = computeOpenRouterRateLimitBackoffMs(error, rateLimitAttempt)
        setOpenRouterModelCooldown(currentModel, Math.max(OPENROUTER_MODEL_COOLDOWN_MS, backoffMs))
        console.info({ currentModel, backoffMs }, '[PromptGod] OpenRouter context request rate limited')
        await delay(backoffMs)
      }

      perModelFailures.push({ model: currentModel, failure: summarizeProviderFailure(error) })

      const hasFallbackModel = modelIndex < modelsToTry.length - 1
      if (hasFallbackModel && shouldTryNextOpenRouterModel(false, error)) {
        const fallbackModel = modelsToTry[modelIndex + 1]
        console.info({ currentModel, fallback: fallbackModel }, '[PromptGod] Retrying context request with fallback model')
        continue
      }

      break
    }
  }

  const failureSummary = perModelFailures.length > 0
    ? perModelFailures.map((entry) => `${entry.model}: ${entry.failure}`).join(' | ')
    : lastError instanceof Error ? lastError.message : 'no provider responded'

  throw new Error(
    `[ServiceWorker] OpenRouter curated chain exhausted (${modelsToTry.join(' -> ')}): ${failureSummary}`
  )
}

async function incrementCounter(key: 'totalEnhancements' | 'errorCount', platform?: string): Promise<void> {
  try {
    const data = await chrome.storage.local.get([key, 'enhancementsByPlatform'])
    const current = (data[key] as number) ?? 0
    const updates: Record<string, unknown> = { [key]: current + 1 }

    if (platform && key === 'totalEnhancements') {
      const byPlatform = (data.enhancementsByPlatform as Record<string, number>) ?? {}
      byPlatform[platform] = (byPlatform[platform] ?? 0) + 1
      updates.enhancementsByPlatform = byPlatform
    }

    await chrome.storage.local.set(updates)
  } catch {
    // Non-critical — don't break the enhancement flow
  }
}

function formatErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'Enhancement failed'
  const genericTranslated = 'Something went wrong while enhancing the prompt. Check your API key, model choice, and connection, then try again.'
  const legacyGenericTranslated = 'An unexpected error occurred. Please check your connection and API settings.'

  // Detect network-level blocks (Brave Shields, privacy extensions, etc.)
  if (error instanceof TypeError && /failed to fetch|network/i.test(error.message)) {
    return 'API request blocked — if you\'re using Brave or a privacy browser, allow requests from extensions in your shield/privacy settings'
  }

  if (/free-models-per-day|OpenRouter daily limit reached|OpenRouter free-models-per-day cap reached/i.test(error.message)) {
    const resetMatch = error.message.match(/resets at\s+([0-9T:\-Z.]+)/i)
    const resetSuffix = resetMatch ? ` Resets at ${resetMatch[1]}.` : ' Resets at the next OpenRouter daily reset (midnight UTC).'
    return `OpenRouter's free daily request cap is exhausted on this key.${resetSuffix} Switch to Google or save a paid OpenRouter model.`
  }

  if (error instanceof AllProvidersFailedError || /All providers failed/i.test(error.message)) {
    return 'No provider returned a usable rewrite. Retry once, or save an OpenRouter key/custom model and try again.'
  }

  if (error instanceof DirectGemmaNoChangeError || /Direct Gemma returned the prompt unchanged/i.test(error.message)) {
    return 'Gemma returned the prompt unchanged. Switch to Gemini 2.5 Flash or another model and try again.'
  }

  if (error instanceof DirectGemmaTimeoutError || /Direct Gemma timed out/i.test(error.message)) {
    return 'Gemma did not return a rewrite before timing out. Switch to Gemini 2.5 Flash and try again.'
  }

  if (/OpenRouter completion returned no text output|OpenRouter curated chain exhausted|ended before emitting tokens|timed out while waiting for tokens|stream stalled/i.test(error.message)) {
    return 'The OpenRouter free chain did not return usable text. Retry once, or switch to a saved custom model.'
  }

  if (/Google API returned unusable output|Google API returned no text output/i.test(error.message)) {
    return 'Google returned a partial or blocked rewrite. Retry once, or switch to Gemini 2.5 Flash.'
  }

  if (/Google API overall request budget exceeded|Request timed out after/i.test(error.message)) {
    return 'The provider took too long to return a rewrite. Please retry once, or switch to a faster model.'
  }

  if (/returned 400/i.test(error.message) && /credit|billing|paid|balance|insufficient|no tokens/i.test(error.message)) {
    return 'This model needs paid credits on the provider account. Pick a free model or add credits, then try again.'
  }

  if (/returned 400|returned 404/i.test(error.message) && /model|not found|does not exist/i.test(error.message)) {
    return 'The selected model is unavailable. Pick another model in PromptGod settings and save it again.'
  }

  if (/returned 400/i.test(error.message) && /invalid|malformed|unsupported|request/i.test(error.message)) {
    return 'The provider rejected the request format for that model. Switch to another model and try again.'
  }

  if (/returned 401|unauthorized|invalid api key|authentication/i.test(error.message)) {
    return 'The API key was rejected. Check the key, confirm you selected the right provider, and save again.'
  }

  if (/returned 403|permission|forbidden|access denied/i.test(error.message)) {
    return 'This account does not have access to the selected model. Choose another model or check the provider account permissions.'
  }

  if (/returned 429|rate limit|resource exhausted|quota/i.test(error.message)) {
    return 'The provider rate-limited the request. Wait a moment, then retry or switch to a less busy model.'
  }

  const translated = translateError(error)
  if (translated && translated !== genericTranslated && translated !== legacyGenericTranslated) {
    return translated
  }

  if (!/^\[(LLMClient|ServiceWorker)\]/.test(error.message) && !/[{}[\]]/.test(error.message)) {
    return error.message
  }

  return genericTranslated
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function disconnectPortSoon(port: chrome.runtime.Port, delayMs: number = 50): void {
  setTimeout(() => {
    try {
      port.disconnect()
    } catch {
      // no-op
    }
  }, delayMs)
}

export function sendMessage(port: chrome.runtime.Port, msg: ServiceWorkerMessage): void {
  try {
    supervisor.touch(port)
    port.postMessage(msg)
  } catch (error) {
    console.info({ cause: error }, '[PromptGod] Could not send message — port disconnected')
  }
}

