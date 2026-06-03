import type { Provider } from '../lib/provider-policy'
import type { OpenRouterAccountStatus } from '../lib/rewrite-openrouter/account-status'
import { GOOGLE_GEMMA_FALLBACK_MODEL } from '../lib/rewrite-google/models'
import { GROQ_CURATED_MODELS, GROQ_PRIMARY_MODEL } from '../lib/rewrite-groq/models'
import {
  OPENROUTER_CURATED_FREE_MODELS,
  buildCuratedOpenRouterChain,
  isExcludedOpenRouterModel,
  type OpenRouterCurationTier,
} from '../lib/rewrite-openrouter/curation'

export interface ModelOption {
  label: string
  value: string
  cost: string
  tier: 'free' | 'paid'
  curationTier?: OpenRouterCurationTier
}

export interface VisibleChainItem {
  label: string
  value: string
}

export interface CustomModelValidation {
  valid: boolean
  message: string
}

export interface AccountStatusView {
  message: string
  className: string
}

const PROVIDER_MODEL_OPTIONS: Record<Exclude<Provider, 'openrouter'>, ModelOption[]> = {
  anthropic: [
    { label: 'Claude Haiku 3.5', value: 'claude-3-5-haiku-20241022', cost: 'Low cost', tier: 'paid' },
    { label: 'Claude Sonnet 4', value: 'claude-sonnet-4-20250514', cost: 'Higher quality, higher cost', tier: 'paid' },
  ],
  openai: [
    { label: 'GPT-4o-mini', value: 'gpt-4o-mini', cost: '~$0.001/enhance', tier: 'paid' },
    { label: 'GPT-4o', value: 'gpt-4o', cost: '~$0.01/enhance', tier: 'paid' },
  ],
  google: [
    { label: 'Gemini 2.5 Flash', value: 'gemini-2.5-flash', cost: 'Free tier available', tier: 'free' },
    { label: 'Gemma 4 26B A4B IT', value: GOOGLE_GEMMA_FALLBACK_MODEL, cost: 'API access, availability varies', tier: 'free' },
    { label: 'Gemini 2.5 Flash Lite', value: 'gemini-2.5-flash-lite', cost: 'Manual option, free tier available', tier: 'free' },
  ],
  groq: GROQ_CURATED_MODELS.map((m) => ({
    label: m.label,
    value: m.id,
    cost: 'Free tier, high rate limits',
    tier: 'free' as const,
  })),
}

// Provider priority for the runtime fallback chain. Each provider contributes two models;
// the chain runs every provider's primary first (in this order), then every secondary, so the
// strongest model from each saved key is tried before any backstop. The two most reliable models
// are Groq 70B and Nemotron Super, so Groq leads and OpenRouter sits ahead of Gemini:
// e.g. Groq + OpenRouter + Gemini => Llama 70B -> Nemotron Super -> Flash -> Llama 8B -> Nano -> Gemma.
const FALLBACK_PROVIDER_PRIORITY: Array<'groq' | 'google' | 'openrouter'> = ['groq', 'openrouter', 'google']

const FALLBACK_PROVIDER_MODELS: Record<'groq' | 'google' | 'openrouter', { primary: string; secondary: string }> = {
  groq: { primary: 'Llama 3.3 70B', secondary: 'Llama 3.1 8B' },
  google: { primary: 'Gemini 2.5 Flash', secondary: 'Gemma' },
  openrouter: { primary: 'Nemotron Super', secondary: 'Nemotron Nano' },
}

// Builds the visible fallback chain from the providers the user has saved a key for. With no keys
// saved we show the full three-provider chain as guidance. Interleaving is primaries-then-secondaries
// so the popup text matches the order the runtime escalates through.
export function buildVisibleFallbackChain(savedProviders: string[]): string[] {
  const available = FALLBACK_PROVIDER_PRIORITY.filter((provider) => savedProviders.includes(provider))
  const ordered = available.length > 0 ? available : FALLBACK_PROVIDER_PRIORITY
  const primaries = ordered.map((provider) => FALLBACK_PROVIDER_MODELS[provider].primary)
  const secondaries = ordered.map((provider) => FALLBACK_PROVIDER_MODELS[provider].secondary)
  return [...primaries, ...secondaries]
}

export const RECOMMENDED_MODELS: VisibleChainItem[] = [
  { label: 'Llama 3.3 70B (Groq)', value: GROQ_PRIMARY_MODEL },
  { label: 'Nemotron 3 Super 120B', value: 'nvidia/nemotron-3-super-120b-a12b:free' },
  { label: 'Gemini 2.5 Flash', value: 'gemini-2.5-flash' },
]

export function getOpenRouterFreeChainOptions(liveModelIds?: string[]): ModelOption[] {
  const curatedById = new Map(OPENROUTER_CURATED_FREE_MODELS.map((model) => [model.id, model]))
  return buildCuratedOpenRouterChain(undefined, liveModelIds)
    .filter((modelId) => !isExcludedOpenRouterModel(modelId))
    .map((modelId) => {
      const curated = curatedById.get(modelId)
      return {
        label: curated?.label ?? modelId,
        value: modelId,
        cost: curated?.tier ?? 'stable free',
        tier: 'free' as const,
        curationTier: curated?.tier ?? 'stable free',
      }
    })
}

export function getModelOptions(provider: Provider, openRouterLiveModelIds?: string[]): ModelOption[] {
  if (provider === 'openrouter') {
    return [
      ...getOpenRouterFreeChainOptions(openRouterLiveModelIds),
      { label: 'GPT-4o-mini', value: 'openai/gpt-4o-mini', cost: '~$0.001/enhance', tier: 'paid' },
    ]
  }

  return PROVIDER_MODEL_OPTIONS[provider]
}

export function validateCustomOpenRouterModelId(value: string): CustomModelValidation {
  const trimmed = value.trim()
  if (!trimmed) return { valid: true, message: '' }
  if (!trimmed.includes('/')) {
    return { valid: false, message: 'Custom model IDs must look like org/model-name.' }
  }
  return { valid: true, message: 'Custom model will be saved for OpenRouter.' }
}

export function formatOpenRouterAccountStatus(status: OpenRouterAccountStatus | undefined): AccountStatusView {
  if (!status) return { message: '', className: 'status' }

  if (status.paused) {
    return {
      message: `OpenRouter ${status.bucket} cap reached. Routing is paused today.`,
      className: 'status status--warning',
    }
  }

  if (status.bucket === 'unknown' && status.remaining === null) {
    return { message: '', className: 'status' }
  }

  const remaining = status.remaining === null ? '' : `, ${status.remaining} remaining`
  const className = status.remaining !== null && status.remaining <= 5
    ? 'status status--warning'
    : 'status'

  return {
    message: `OpenRouter bucket: ${status.bucket}${remaining}.`,
    className,
  }
}
