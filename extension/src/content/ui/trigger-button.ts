// Trigger button — injected next to the send button on supported platforms

import type { PlatformAdapter } from '../adapters/types'
import type { EnhanceMessage, ServiceWorkerMessage } from '../../lib/types'
import { shouldSkipEnhancement } from '../../lib/smart-skip'
import { mergeStreamChunk } from '../../lib/stream-merge'
import { cleanEnhancedPromptOutput, normalizeText } from '../../lib/text-utils'
import { showToast } from './toast'
import { showUndoButton, removeUndoButton } from './undo-button'

let isEnhancing = false
let injectedButton: HTMLButtonElement | null = null
const ENHANCEMENT_PROGRESS_TIMEOUT_MS = 90000

type ContentSettings = {
  includeConversationContext: boolean
  model?: string
}

type ContentSettingsResponse = {
  type?: 'CONTENT_SETTINGS'
  includeConversationContext?: boolean
  model?: unknown
}

type TooltipStateResponse = {
  type?: 'TOOLTIP_STATE'
  hasSeenTooltip?: boolean
}

// Track original prompt across re-enhance clicks
let storedOriginal: string | null = null
let lastEnhancedText: string | null = null

function stripDiffTag(text: string): { cleanText: string; diffLabel: string | null } {
  const match = text.match(/\n?\[DIFF:\s*([^\]]*)\]\s*$/)
  if (!match) return { cleanText: text.trimEnd(), diffLabel: null }
  return {
    cleanText: text.slice(0, match.index).trimEnd(),
    diffLabel: match[1].trim() || null,
  }
}

function isExtensionContextInvalidated(error: unknown): boolean {
  return error instanceof Error && /extension context invalidated/i.test(error.message)
}

function hasRuntimeContext(): boolean {
  try {
    return Boolean(chrome?.runtime?.id && chrome?.runtime?.connect)
  } catch {
    return false
  }
}

function shouldSkipNormalCleanup(model: unknown): boolean {
  return typeof model === 'string' && /\bgemma\b/i.test(model)
}

async function loadContentSettings(): Promise<ContentSettings> {
  if (!hasRuntimeContext() || !chrome.runtime.sendMessage) {
    return { includeConversationContext: false }
  }

  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_CONTENT_SETTINGS' }) as ContentSettingsResponse | undefined
    return {
      includeConversationContext: response?.includeConversationContext === true,
      model: typeof response?.model === 'string' ? response.model : undefined,
    }
  } catch {
    return { includeConversationContext: false }
  }
}

async function getHasSeenTooltip(): Promise<boolean> {
  if (!hasRuntimeContext() || !chrome.runtime.sendMessage) {
    return true
  }

  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_TOOLTIP_STATE' }) as TooltipStateResponse | undefined
    return response?.hasSeenTooltip !== false
  } catch {
    return true
  }
}

async function markTooltipSeen(): Promise<void> {
  if (!hasRuntimeContext() || !chrome.runtime.sendMessage) {
    return
  }

  try {
    await chrome.runtime.sendMessage({ type: 'SET_TOOLTIP_SEEN' })
  } catch {
    // best-effort persistence only
  }
}

export function shouldUseProgressiveComposerRender(platform: string, model: unknown): boolean {
  void platform
  void model
  return false
}

// Reasoning-effort labels ChatGPT shows on the Plus/Pro composer mode pill.
const CHATGPT_MODE_LABEL = /^(Auto|Instant|Thinking|Standard|Extended|Pro|Fast|Light|Legacy)\b/i

/**
 * Locate the ChatGPT reasoning-mode pill ("Extended", "Auto", "Thinking", ...).
 *
 * The pill only exists on Plus/Pro accounts and can live in a toolbar that is a
 * sibling of the <form> rather than inside it, so we search a region a couple of
 * levels above the form — but stay scoped to the composer so we never match an
 * unrelated "Pro"/"Legacy" button elsewhere on the page. Returns null on free
 * accounts (no pill), which the caller treats as the "not Plus" branch.
 */
function findChatGPTModePill(
  form: HTMLElement | null | undefined,
  sendButton: HTMLElement
): HTMLElement | null {
  const searchRoot =
    form?.parentElement?.parentElement ?? form?.parentElement ?? form ?? null
  if (!searchRoot) {
    return null
  }

  const candidates = Array.from(
    searchRoot.querySelectorAll<HTMLElement>('button, [role="button"]')
  )
  for (const candidate of candidates) {
    if (
      candidate.id === 'promptgod-trigger' ||
      candidate === sendButton ||
      candidate.contains(sendButton) ||
      sendButton.contains(candidate)
    ) {
      continue
    }
    const text = candidate.textContent?.trim() ?? ''
    if (text.length > 0 && text.length < 24 && CHATGPT_MODE_LABEL.test(text)) {
      return candidate
    }
  }
  return null
}

export function injectTriggerButton(adapter: PlatformAdapter): boolean {
  // Don't double-inject
  if (injectedButton && document.body.contains(injectedButton)) {
    return true
  }

  // Input must be present before we can anchor the button to the composer.
  // Returning false lets the caller keep retrying while the platform hydrates.
  if (!adapter.getInputElement()) {
    return false
  }

  const sendButton = adapter.getSendButton()
  if (!sendButton) {
    console.info('[PromptGod] Send button not found, cannot inject trigger button')
    return false
  }

  const button = document.createElement('button')
  button.id = 'promptgod-trigger'
  button.type = 'button'
  button.className = 'promptgod-trigger-btn'
  button.title = 'Run LLM branch'
  button.setAttribute('aria-label', 'Run LLM branch')

  // Brand icon loaded via chrome.runtime.getURL (requires web_accessible_resources)
  const iconUrl = chrome.runtime.getURL('assets/icon-48.png')
  button.innerHTML = `
    <img class="promptgod-trigger-icon" src="${iconUrl}" alt="PromptGod" />
    <svg class="promptgod-trigger-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10" stroke-dasharray="31.4 31.4" stroke-dashoffset="0"/>
    </svg>
  `

  button.addEventListener('click', (e) => {
    if (e.shiftKey) {
      handlePreviewEnhance(adapter)
    } else {
      handleEnhanceClick(adapter)
    }
  })

  // Platform-specific insertion. Wrapped because insertBefore throws a
  // NotFoundError when the platform (notably Gemini's Angular composer)
  // re-parents the toolbar between us computing the anchor and inserting —
  // an unhandled throw here used to abort the bootstrap retry chain, which is
  // what left Gemini needing a manual refresh.
  const platform = adapter.getPlatform()
  try {
  if (platform === 'claude') {
    button.classList.add('promptgod-trigger-btn--claude')
    const input = adapter.getInputElement()
    const composer = input?.closest('fieldset') ?? input?.closest('form') ?? input?.parentElement?.parentElement?.parentElement

    const buttons = Array.from(composer?.querySelectorAll('button') ?? [])
    const modelButton = buttons.find((btn) => {
      const text = btn.textContent?.trim() ?? ''
      return text.includes('Sonnet') || text.includes('Haiku') || text.includes('Opus')
    }) as HTMLElement | undefined

    if (modelButton) {
      let container = modelButton.parentElement
      while (container && container !== composer && !container.contains(sendButton)) {
        container = container.parentElement
      }
      if (container) {
        let directChild: HTMLElement | null = modelButton
        while (directChild && directChild.parentElement !== container) {
          directChild = directChild.parentElement
        }
        if (directChild) {
          container.insertBefore(button, directChild)
        } else {
          sendButton.parentElement?.insertBefore(button, sendButton)
        }
      } else {
        sendButton.parentElement?.insertBefore(button, sendButton)
      }
    } else {
      sendButton.parentElement?.insertBefore(button, sendButton)
    }
  } else if (platform === 'gemini') {
    button.classList.add('promptgod-trigger-btn--gemini')
    const input = adapter.getInputElement()
    const composer = input?.closest('form, [class*="input-area"], [class*="composer"]')
      ?? input?.parentElement?.parentElement?.parentElement

    const allEls = Array.from(composer?.querySelectorAll('*') ?? [])
    const fastEl = allEls.find((el) => {
      const text = (el as HTMLElement).textContent?.trim() ?? ''
      return (text === 'Fast' || text === '1.5 Flash' || text === 'Flash' || text === '2.0 Flash')
        && el.children.length === 0
    }) as HTMLElement | undefined

    if (fastEl) {
      const fastButton = fastEl.closest('button, [role="button"]') as HTMLElement ?? fastEl.parentElement as HTMLElement
      let container = fastButton?.parentElement
      while (container && container !== composer && !container.contains(sendButton)) {
        container = container.parentElement
      }
      if (container) {
        let directChild: HTMLElement | null = fastButton
        while (directChild && directChild.parentElement !== container) {
          directChild = directChild.parentElement
        }
        if (directChild) {
          container.insertBefore(button, directChild)
        } else {
          sendButton.parentElement?.insertBefore(button, sendButton)
        }
      } else {
        sendButton.parentElement?.insertBefore(button, sendButton)
      }
    } else {
      sendButton.parentElement?.insertBefore(button, sendButton)
    }
  } else if (platform === 'perplexity') {
    button.classList.add('promptgod-trigger-btn--perplexity')
    const input = adapter.getInputElement()
    const composer = input?.closest('form, [class*="input"], [class*="composer"]')
      ?? input?.parentElement?.parentElement?.parentElement

    const searchRoot = composer ?? document.body
    const allEls = Array.from(searchRoot.querySelectorAll('*'))
    const modelEl = allEls.find((el) => {
      const text = (el as HTMLElement).textContent?.trim() ?? ''
      return (
        el.children.length === 0 &&
        (text === 'Model' ||
          text.includes('Sonnet') ||
          text.includes('Haiku') ||
          text.includes('Opus') ||
          text.includes('GPT') ||
          text.includes('Sonar') ||
          text.includes('o1') ||
          text.includes('o3'))
      )
    }) as HTMLElement | undefined

    if (modelEl) {
      const modelButton = (modelEl.closest('button, [role="button"]') as HTMLElement)
        ?? (modelEl.parentElement as HTMLElement)
      let container = modelButton?.parentElement
      while (container && !container.contains(sendButton)) {
        container = container.parentElement
      }
      if (container) {
        let directChild: HTMLElement | null = modelButton
        while (directChild && directChild.parentElement !== container) {
          directChild = directChild.parentElement
        }
        if (directChild) {
          container.insertBefore(button, directChild)
        } else {
          sendButton.parentElement?.insertBefore(button, sendButton)
        }
      } else {
        sendButton.parentElement?.insertBefore(button, sendButton)
      }
    } else {
      sendButton.parentElement?.insertBefore(button, sendButton)
    }
  } else if (platform === 'chatgpt') {
    button.classList.add('promptgod-trigger-btn--chatgpt')
    const input = adapter.getInputElement()
    const form = input?.closest('form')

    // ChatGPT Plus/Pro accounts render a reasoning-effort mode pill ("Extended",
    // "Auto", "Thinking", ...) at the right edge of the composer — exactly the
    // space a free account leaves empty. Free accounts never render this pill, so
    // its presence is our DOM-only "is this account Plus?" signal.
    //
    //  - Plus/Pro: seat our button immediately to the LEFT of the pill so the two
    //    never overlap.
    //  - Free: no pill, so float the button in the (empty) bottom-right corner.
    const modePill = findChatGPTModePill(form, sendButton)

    if (modePill?.parentElement) {
      // Plus/Pro account: insert directly before the pill (to its left).
      button.classList.add('promptgod-trigger-btn--chatgpt-inline')
      modePill.parentElement.insertBefore(button, modePill)
    } else if (form) {
      // Free account (no mode pill): absolute-position bottom-right of the form.
      button.classList.add('promptgod-trigger-btn--chatgpt-floating')
      const formPosition = getComputedStyle(form).position
      if (formPosition === 'static') {
        form.style.position = 'relative'
      }
      form.appendChild(button)
    } else {
      sendButton.parentElement?.insertBefore(button, sendButton)
    }
  } else {
    sendButton.parentElement?.insertBefore(button, sendButton)
  }
  } catch (error) {
    console.warn({ cause: error, platform }, '[PromptGod] Anchored insertion failed, using fallback')
    if (!button.isConnected) {
      try {
        sendButton.parentElement?.insertBefore(button, sendButton)
      } catch {
        // Verified below — leaving the button unconnected makes us return false.
      }
    }
  }

  // A DOM race can leave the button uninserted (the anchor was re-parented mid
  // insertion). Don't claim success unless it actually landed: returning false
  // keeps the bootstrap poll and the MutationObserver retrying until it sticks.
  if (!button.isConnected) {
    return false
  }

  injectedButton = button
  console.info({ platform: adapter.getPlatform() }, '[PromptGod] Trigger button injected')
  return true
}

async function handleEnhanceClick(adapter: PlatformAdapter): Promise<void> {
  // Double-click guard
  if (isEnhancing) {
    return
  }

  const promptText = adapter.getPromptText()

  // Smart skip check
  if (shouldSkipEnhancement(promptText)) {
    showToast({ message: 'Prompt too short to enhance', variant: 'info' })
    return
  }

  const platform = adapter.getPlatform()
  const context = adapter.getConversationContext()
  let shouldProgressivelyRender = false

  // Re-enhance logic: if text matches last enhanced output, use stored original
  // If user has edited the text, treat current text as new original
  let effectivePrompt = promptText
  if (storedOriginal !== null && lastEnhancedText !== null) {
    if (promptText === lastEnhancedText) {
      effectivePrompt = storedOriginal
    } else {
      storedOriginal = promptText
    }
  } else {
    storedOriginal = promptText
  }

  console.info(
    { platform, promptLength: effectivePrompt.length, context },
    '[PromptGod] Enhance triggered'
  )

  // Cache original prompt for undo — must happen before any DOM modification
  const originalPrompt = storedOriginal!

  // Remove any existing undo button from a previous enhancement
  removeUndoButton()

  // Set loading state
  setLoading(true)

  // Guard against stale content script after extension reload
  if (!hasRuntimeContext()) {
    showToast({ message: 'Extension was updated — please refresh the page', variant: 'warning' })
    setLoading(false)
    return
  }

  // Wake up the service worker with a ping before opening the port.
  // Chrome MV3 service workers go idle and onConnect alone doesn't reliably wake them.
  try {
    await chrome.runtime.sendMessage({ type: 'PING' })
  } catch (error) {
    if (isExtensionContextInvalidated(error) || !hasRuntimeContext()) {
      showToast({ message: 'Extension was updated — please refresh the page', variant: 'warning' })
      setLoading(false)
      return
    }

    // Service worker might not have a sendMessage listener yet — that's fine,
    // the ping itself wakes it up. Ignore errors.
  }

  // Open port to service worker for streaming
  let port: chrome.runtime.Port
  try {
    port = chrome.runtime.connect({ name: 'enhance' })
  } catch (error) {
    if (isExtensionContextInvalidated(error) || !hasRuntimeContext()) {
      showToast({ message: 'Extension was updated — please refresh the page', variant: 'warning' })
    } else {
      console.error({ cause: error }, '[PromptGod] Failed to open port to service worker')
      showToast({ message: 'Could not reach extension service worker', variant: 'error' })
    }
    setLoading(false)
    return
  }

  // Gather recent conversation context if toggle is on
  let recentContext: string | undefined
  let selectedModel: string | undefined
  try {
    const settings = await loadContentSettings()
    selectedModel = settings.model
    shouldProgressivelyRender = shouldUseProgressiveComposerRender(platform, selectedModel)
    if (settings.includeConversationContext && !context.isNewConversation) {
      const scraped = adapter.getRecentMessages(500)
      if (scraped) recentContext = scraped
    }
  } catch {
    // storage access failed — proceed without context
    shouldProgressivelyRender = false
  }

  // Send ENHANCE message
  const message: EnhanceMessage = {
    type: 'ENHANCE',
    rawPrompt: effectivePrompt,
    platform,
    context,
    recentContext,
  }
  try {
    port.postMessage(message)
  } catch (error) {
    if (isExtensionContextInvalidated(error) || !hasRuntimeContext()) {
      showToast({ message: 'Extension was updated — please refresh the page', variant: 'warning' })
    } else {
      console.error({ cause: error }, '[PromptGod] Failed to send ENHANCE message')
      showToast({ message: 'Failed to start enhancement', variant: 'error' })
    }
    try {
      port.disconnect()
    } catch {
      // no-op
    }
    setLoading(false)
    return
  }

  // Service-worker output is finalized before insertion, so commit it once at
  // DONE. Repeated contenteditable writes caused visible flicker and append
  // duplication on rich editors.
  let accumulatedText = ''
  let renderedIndex = 0
  let fieldCleared = false
  let renderFrameId: number | null = null
  let streamDone = false
  let settled = false
  let acknowledged = false
  let receivedToken = false
  let undoShown = false
  let pendingDiffLabel: string | null = null
  let finalOutputCommitted = false

  const ackTimeout = window.setTimeout(() => {
    if (settled) {
      return
    }

    showToast({
      message: 'Service worker did not respond. Refresh the page and try again.',
      variant: 'error',
    })
    try {
      port.disconnect()
    } catch {
      // no-op
    }
  }, 10000)

  let progressTimeout: number | null = window.setTimeout(() => {
    if (settled) {
      return
    }

    showToast({
      message: 'Enhancement timed out. Try again with a shorter prompt.',
      variant: 'error',
    })
    try {
      port.disconnect()
    } catch {
      // no-op
    }
  }, ENHANCEMENT_PROGRESS_TIMEOUT_MS)

  function resetProgressTimeout(): void {
    if (progressTimeout !== null) {
      window.clearTimeout(progressTimeout)
    }
    progressTimeout = window.setTimeout(() => {
      if (settled) {
        return
      }

      showToast({
        message: 'Enhancement timed out. Try again with a shorter prompt.',
        variant: 'error',
      })
      try {
        port.disconnect()
      } catch {
        // no-op
      }
    }, ENHANCEMENT_PROGRESS_TIMEOUT_MS)
  }

  function settle(): void {
    if (settled) {
      return
    }
    settled = true
    if (renderFrameId !== null) {
      cancelAnimationFrame(renderFrameId)
      renderFrameId = null
    }
    window.clearTimeout(ackTimeout)
    if (progressTimeout !== null) {
      window.clearTimeout(progressTimeout)
      progressTimeout = null
    }
    cleanupPort()
  }

  function scheduleRenderLoop(): void {
    if (renderFrameId === null && !settled) {
      renderFrameId = requestAnimationFrame(renderLoop)
    }
  }

  function commitFinalOutput(): void {
    if (finalOutputCommitted) {
      return
    }
    finalOutputCommitted = true

    const normalizedText = shouldSkipNormalCleanup(selectedModel)
      ? normalizeText(accumulatedText)
      : cleanEnhancedPromptOutput(accumulatedText, effectivePrompt)
    if (normalizedText.startsWith('[NO_CHANGE]') || normalizeText(normalizedText) === normalizeText(originalPrompt)) {
      showToast({ message: 'Model returned the prompt unchanged. Try another model or shorten the prompt.', variant: 'warning' })
      try {
        adapter.setPromptText(originalPrompt)
      } catch {
        // best-effort restore
      }
      return
    }

    try {
      if (normalizeText(adapter.getPromptText()) !== normalizedText) {
        adapter.setPromptText(normalizedText)
      }
      lastEnhancedText = adapter.getPromptText() || normalizedText
      console.info(
        { enhancedLength: accumulatedText.length, diffLabel: pendingDiffLabel },
        '[PromptGod] Enhancement complete'
      )
      ensureUndoButton(pendingDiffLabel)
    } catch (error) {
      console.error({ cause: error }, '[PromptGod] Final text sync failed')
      if (adapter.getPlatform() === 'perplexity') {
        void handlePerplexityWriteFallback(adapter, normalizedText)
      } else {
        showToast({ message: 'Could not write the enhanced prompt into the page', variant: 'error' })
      }
    }
  }

  /** Rendering loop — drips one word per frame from accumulatedText into the DOM. */
  function renderLoop(): void {
    renderFrameId = null
    if (settled) return

    const pending = accumulatedText.length - renderedIndex
    if (pending <= 0) {
      if (streamDone) {
        // accumulatedText was already stripped of [DIFF:] in the DONE handler;
        // pendingDiffLabel holds the extracted label.
        commitFinalOutput()
        settle()
        return
      }
      return
    }

    // Clear field on first render — user's prompt stays visible until tokens arrive
    if (!fieldCleared) {
      try {
        adapter.clearInput()
        adapter.getInputElement()?.focus()
        fieldCleared = true
      } catch (error) {
        console.error({ cause: error }, '[PromptGod] Failed to clear input field')
        showToast({ message: 'Input field disappeared during enhancement', variant: 'error' })
        try { port.disconnect() } catch { /* no-op */ }
        ensureUndoButton()
        settle()
        return
      }
    }

    // Find render ceiling: never render into a [DIFF: ...] tag region
    let ceiling = accumulatedText.length
    const diffStart = accumulatedText.indexOf('[DIFF:')
    if (diffStart !== -1 && diffStart >= renderedIndex) {
      // Also skip any preceding newline(s)
      ceiling = diffStart
      while (ceiling > renderedIndex && (accumulatedText[ceiling - 1] === '\n' || accumulatedText[ceiling - 1] === '\r')) {
        ceiling--
      }
    } else if (!streamDone) {
      // Guard against partial [DIFF: arriving across token boundaries.
      // If the tail of the buffer looks like the start of a DIFF tag, hold back.
      const DIFF_MARKER = '\n[DIFF:'
      const tail = accumulatedText.slice(Math.max(0, accumulatedText.length - DIFF_MARKER.length))
      for (let len = 1; len <= tail.length; len++) {
        if (DIFF_MARKER.startsWith(tail.slice(tail.length - len))) {
          ceiling = accumulatedText.length - len
          break
        }
      }
    }

    if (renderedIndex >= ceiling) {
      // We've reached the [DIFF:] region — wait for DONE to strip and finalize
      scheduleRenderLoop()
      return
    }

    // Find next word boundary: advance past current word + trailing whitespace.
    let end = renderedIndex
    while (end < ceiling && !isRenderBoundary(accumulatedText[end])) {
      end++
    }
    while (end < ceiling && isRenderBoundary(accumulatedText[end])) {
      end++
    }

    const slice = accumulatedText.slice(renderedIndex, end)
    if (slice.length === 0) {
      scheduleRenderLoop()
      return
    }

    try {
      const ok = adapter.appendChunk(slice)
      if (!ok) {
        // Fallback for platforms where chunk append doesn't work (shouldn't happen
        // now, but safety net) — set the full text rendered so far
        adapter.setPromptText(accumulatedText.slice(0, end))
      }
      renderedIndex = end
    } catch (error) {
      console.error({ cause: error }, '[PromptGod] Failed to update input field')
      showToast({ message: 'Input field disappeared during enhancement', variant: 'error' })
      try { port.disconnect() } catch { /* no-op */ }
      ensureUndoButton()
      settle()
      return
    }

    ensureUndoButton()
    scheduleRenderLoop()
  }

  function isRenderBoundary(char: string | undefined): boolean {
    return char === ' ' || char === '\n' || char === '\r' || char === '\t'
  }

  function ensureUndoButton(diffLabel?: string | null): void {
    if (undoShown) {
      return
    }

    showUndoButton(adapter, originalPrompt, () => {
      settle()
      try {
        port.disconnect()
      } catch {
        // no-op
      }
    }, diffLabel ?? undefined)
    undoShown = true
  }

  // Listen for TOKEN, DONE, ERROR from service worker
  port.onMessage.addListener((msg: ServiceWorkerMessage) => {
    if (!acknowledged) {
      acknowledged = true
      window.clearTimeout(ackTimeout)
    }
    resetProgressTimeout()

    if (msg.type === 'START') {
      console.info('[PromptGod] Service worker acknowledged request')
    } else if (msg.type === 'TOKEN') {
      receivedToken = true
      // Remove "Enhancing..." status on first token
      removeEnhancingStatus()

      accumulatedText = mergeStreamChunk(accumulatedText, msg.text)

      // Perplexity's composer duplicates content when we rewrite it during the stream.
      // Buffer tokens there and only commit once at the end.
      if (shouldProgressivelyRender) {
        scheduleRenderLoop()
      }
    } else if (msg.type === 'DONE') {
      if (progressTimeout !== null) {
        window.clearTimeout(progressTimeout)
        progressTimeout = null
      }
      // Strip [DIFF: ...] tag immediately so the render loop never types it into the DOM
      const { cleanText, diffLabel } = stripDiffTag(accumulatedText)
      accumulatedText = cleanText
      pendingDiffLabel = diffLabel
      // Clamp renderedIndex in case the render loop already passed the new boundary
      if (renderedIndex > accumulatedText.length) {
        renderedIndex = accumulatedText.length
      }
      streamDone = true
      if (!shouldProgressivelyRender && accumulatedText.length > 0) {
        commitFinalOutput()
      } else if (shouldProgressivelyRender && accumulatedText.length > 0) {
        scheduleRenderLoop()
      }
    } else if (msg.type === 'ERROR') {
      console.error({ message: msg.message, code: msg.code }, '[PromptGod] Enhancement error')
      showToast({ message: msg.message, variant: 'error' })
      settle()
    } else if (msg.type === 'SETTLEMENT') {
      if (progressTimeout !== null) {
        window.clearTimeout(progressTimeout)
        progressTimeout = null
      }

      if (msg.status === 'DONE') {
        streamDone = true

        if (!receivedToken) {
          showToast({ message: 'Model returned no rewrite text. Try Gemini 2.5 Flash or another model.', variant: 'warning' })
          settle()
        } else if (shouldProgressivelyRender && accumulatedText.length > 0) {
          scheduleRenderLoop()
        } else if (accumulatedText.length > 0) {
          commitFinalOutput()
          settle()
        } else {
          settle()
        }
      }

      if (msg.status === 'ERROR' && msg.message) {
        showToast({ message: msg.message, variant: 'error' })
        settle()
      }
    }
  })

  // Handle unexpected disconnection
  port.onDisconnect.addListener(() => {
    if (settled) {
      return
    }

    if (streamDone) {
      if (shouldProgressivelyRender && accumulatedText.length > renderedIndex) {
        scheduleRenderLoop()
        return
      }
      if (!receivedToken && accumulatedText.length === 0) {
        showToast({
          message: 'The selected model finished without returning rewrite text. Try Gemini 2.5 Flash or a different Gemma model.',
          variant: 'warning',
        })
      } else if (accumulatedText.length > 0) {
        commitFinalOutput()
      }
      settle()
      return
    }

    const error = chrome.runtime.lastError
    if (error) {
      const errorMessage = error.message ?? ''
      const invalidated = /extension context invalidated/i.test(errorMessage)
      if (invalidated || !hasRuntimeContext()) {
        showToast({ message: 'Extension was updated — please refresh the page', variant: 'warning' })
      } else {
        console.error({ cause: error }, '[PromptGod] Port disconnected with error')
        showToast({ message: 'Connection to service worker lost', variant: 'error' })
      }
    } else if (!receivedToken && accumulatedText.length === 0) {
      showToast({
        message: 'The selected model finished without returning rewrite text. Try Gemini 2.5 Flash or a different Gemma model.',
        variant: 'warning',
      })
    }
    settle()
  })
}

async function handlePreviewEnhance(adapter: PlatformAdapter): Promise<void> {
  if (isEnhancing) return

  const promptText = adapter.getPromptText()
  if (shouldSkipEnhancement(promptText)) {
    showToast({ message: 'Prompt too short to enhance', variant: 'info' })
    return
  }

  const platform = adapter.getPlatform()
  const context = adapter.getConversationContext()
  setLoading(true)

  if (!hasRuntimeContext()) {
    showToast({ message: 'Extension was updated — please refresh the page', variant: 'warning' })
    setLoading(false)
    return
  }

  try { await chrome.runtime.sendMessage({ type: 'PING' }) } catch { /* wake-up */ }

  let port: chrome.runtime.Port
  try {
    port = chrome.runtime.connect({ name: 'enhance' })
  } catch {
    showToast({ message: 'Could not reach extension service worker', variant: 'error' })
    setLoading(false)
    return
  }

  let recentContext: string | undefined
  let selectedModel: string | undefined
  try {
    const settings = await loadContentSettings()
    selectedModel = settings.model
    if (settings.includeConversationContext && !context.isNewConversation) {
      const scraped = adapter.getRecentMessages(500)
      if (scraped) recentContext = scraped
    }
  } catch { /* proceed without context */ }

  const message: EnhanceMessage = {
    type: 'ENHANCE',
    rawPrompt: promptText,
    platform,
    context,
    recentContext,
  }

  try { port.postMessage(message) } catch {
    setLoading(false)
    return
  }

  let accumulated = ''
  let receivedToken = false

  port.onMessage.addListener((msg: ServiceWorkerMessage) => {
    if (msg.type === 'TOKEN') {
      receivedToken = true
      removeEnhancingStatus()
      accumulated = mergeStreamChunk(accumulated, msg.text)
    } else if (msg.type === 'DONE') {
      setLoading(false)
      if (!receivedToken) {
        showToast({ message: 'Model returned no rewrite text. Try Gemini 2.5 Flash or another model.', variant: 'warning' })
        return
      }
      const { cleanText } = stripDiffTag(accumulated)
      const normalizedText = shouldSkipNormalCleanup(selectedModel)
        ? normalizeText(cleanText)
        : cleanEnhancedPromptOutput(cleanText, promptText)
      if (normalizedText.startsWith('[NO_CHANGE]')) {
        showToast({ message: 'Your prompt is already strong', variant: 'info' })
        return
      }
      showPreviewOverlay(adapter, normalizedText)
    } else if (msg.type === 'ERROR') {
      setLoading(false)
      showToast({ message: msg.message, variant: 'error' })
    } else if (msg.type === 'SETTLEMENT') {
      setLoading(false)
      if (msg.status === 'ERROR' && msg.message) {
        showToast({ message: msg.message, variant: 'error' })
      }
    }
  })

  port.onDisconnect.addListener(() => {
    setLoading(false)
  })
}

function showPreviewOverlay(adapter: PlatformAdapter, enhancedText: string): void {
  // Remove existing overlay if any
  document.querySelector('.promptgod-preview-overlay')?.remove()

  const overlay = document.createElement('div')
  overlay.className = 'promptgod-preview-overlay'

  const content = document.createElement('div')
  content.className = 'promptgod-preview-content'

  const textEl = document.createElement('pre')
  textEl.className = 'promptgod-preview-text'
  textEl.textContent = enhancedText

  const actions = document.createElement('div')
  actions.className = 'promptgod-preview-actions'

  const useBtn = document.createElement('button')
  useBtn.textContent = 'Use this'
  useBtn.className = 'promptgod-preview-btn promptgod-preview-btn--primary'
  useBtn.addEventListener('click', () => {
    try {
      adapter.setPromptText(enhancedText)
      overlay.remove()
    } catch (error) {
      console.error({ cause: error }, '[PromptGod] Preview insertion failed')
      void copyTextToClipboard(enhancedText).then((copied) => {
        showToast({
          message: copied
            ? 'Could not write into this page. LLM branch result copied — paste it manually.'
            : 'Could not write into this page. Select the preview text and copy it manually.',
          variant: copied ? 'warning' : 'error',
        })
      })
    }
  })

  const copyBtn = document.createElement('button')
  copyBtn.textContent = 'Copy'
  copyBtn.className = 'promptgod-preview-btn'
  copyBtn.addEventListener('click', () => {
    void copyTextToClipboard(enhancedText).then((copied) => {
      showToast({
        message: copied ? 'LLM branch result copied' : 'Could not copy automatically',
        variant: copied ? 'info' : 'error',
      })
    })
  })

  const dismissBtn = document.createElement('button')
  dismissBtn.textContent = 'Dismiss'
  dismissBtn.className = 'promptgod-preview-btn'
  dismissBtn.addEventListener('click', () => {
    overlay.remove()
  })

  actions.appendChild(useBtn)
  actions.appendChild(copyBtn)
  actions.appendChild(dismissBtn)
  content.appendChild(textEl)
  content.appendChild(actions)
  overlay.appendChild(content)
  document.body.appendChild(overlay)
}

async function handlePerplexityWriteFallback(adapter: PlatformAdapter, enhancedText: string): Promise<void> {
  void adapter
  void enhancedText
  showToast({ message: 'Could not write the enhanced prompt into Perplexity', variant: 'error' })
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the textarea copy fallback.
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()

  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}

let enhancingStatusEl: HTMLElement | null = null

function cleanupPort(): void {
  setLoading(false)
  removeEnhancingStatus()
}

function setLoading(loading: boolean): void {
  isEnhancing = loading
  if (injectedButton) {
    injectedButton.classList.toggle('promptgod-trigger-btn--loading', loading)
    injectedButton.disabled = loading
  }

  if (loading) {
    showEnhancingStatus()
  } else {
    removeEnhancingStatus()
  }
}

function showEnhancingStatus(): void {
  // Intentionally a no-op: the spinner state on the trigger button itself
  // (promptgod-trigger-btn--loading) is the only loading indicator we show.
  // The previous "Running LLM branch..." text label was removed by request.
  removeEnhancingStatus()
}

function removeEnhancingStatus(): void {
  if (enhancingStatusEl) {
    enhancingStatusEl.remove()
    enhancingStatusEl = null
  }
}

export function showFirstRunTooltip(): void {
  void (async () => {
    if (await getHasSeenTooltip()) return
    if (!injectedButton) return

    const tooltip = document.createElement('div')
    tooltip.className = 'promptgod-tooltip'
    tooltip.textContent = 'Click to run the LLM branch'

    injectedButton.style.position = injectedButton.style.position || 'relative'
    injectedButton.appendChild(tooltip)

    requestAnimationFrame(() => {
      tooltip.classList.add('promptgod-tooltip--visible')
    })

    let dismissed = false
    const dismiss = () => {
      if (dismissed) return
      dismissed = true
      tooltip.classList.remove('promptgod-tooltip--visible')
      setTimeout(() => tooltip.remove(), 200)
      void markTooltipSeen()
    }

    injectedButton!.addEventListener('click', dismiss, { once: true })
    setTimeout(dismiss, 5000)
  })()
}

// Re-inject button when platform re-renders the composer (SPA navigation)
// Debounced at 200ms to avoid burst re-injection from rapid DOM mutations
export function observeComposer(adapter: PlatformAdapter): void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  const tryInject = (): void => {
    if (injectedButton && document.body.contains(injectedButton)) {
      return
    }
    injectedButton = null
    try {
      injectTriggerButton(adapter)
    } catch (error) {
      // Never let a transient DOM race tear down the observer — the next
      // mutation or navigation event will retry.
      console.warn({ cause: error }, '[PromptGod] Re-injection attempt threw, will retry')
    }
  }

  const observer = new MutationObserver(() => {
    if (debounceTimer) return
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      tryInject()
    }, 200)
  })

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  })

  // SPA route changes (e.g. Gemini's gemini.google.com → /app hand-off) swap the
  // whole composer without a document reload. The MutationObserver usually sees
  // this, but hooking navigation directly guarantees a prompt re-inject pass so
  // the button shows up on first load instead of after a manual refresh.
  const onNavigate = (): void => {
    // Burst a few attempts: the composer for the new route hydrates a beat
    // after the URL changes.
    let pass = 0
    const tick = (): void => {
      tryInject()
      if (++pass < 10 && (!injectedButton || !document.body.contains(injectedButton))) {
        setTimeout(tick, 300)
      }
    }
    tick()
  }

  const wrapHistory = (method: 'pushState' | 'replaceState'): void => {
    const original = history[method]
    history[method] = function (this: History, ...args: Parameters<History['pushState']>) {
      const result = original.apply(this, args)
      window.dispatchEvent(new Event('promptgod:navigation'))
      return result
    }
  }
  wrapHistory('pushState')
  wrapHistory('replaceState')
  window.addEventListener('promptgod:navigation', onNavigate)
  window.addEventListener('popstate', onNavigate)
}

// Keyboard shortcut: Ctrl+Shift+G
export function registerShortcut(adapter: PlatformAdapter): void {
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'G') {
      e.preventDefault()
      handleEnhanceClick(adapter)
    }
  })
}
