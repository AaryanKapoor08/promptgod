export type Provider = 'openai' | 'anthropic' | 'google' | 'openrouter' | 'groq'

export interface ProviderPolicy {
  keyRegex: RegExp
  supportedModels: string[]
}

export interface ApiKeyAnalysis {
  detectedProvider: Provider | null
  recognizedFormat: boolean
  saveable: boolean
}

export const PROVIDER_POLICIES: Record<Provider, ProviderPolicy> = {
  openai: {
    keyRegex: /^sk-[a-zA-Z0-9-]+$/,
    supportedModels: ['gpt-4o-mini', 'gpt-4o'],
  },
  anthropic: {
    keyRegex: /^sk-ant-[a-zA-Z0-9/-]+$/,
    supportedModels: ['claude-3-5-haiku-20241022', 'claude-sonnet-4-20250514'],
  },
  google: {
    keyRegex: /^AIza[a-zA-Z0-9_-]+$/,
    supportedModels: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemma-4-26b-a4b-it'],
  },
  openrouter: {
    keyRegex: /^sk-or-[a-zA-Z0-9-]+$/,
    supportedModels: [],
  },
  groq: {
    keyRegex: /^gsk_[A-Za-z0-9]+$/,
    supportedModels: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
  },
}

export function detectProviderFromApiKey(key: string): Provider | null {
  const trimmed = key.trim()
  if (!trimmed) return null

  const order: Provider[] = ['anthropic', 'openrouter', 'groq', 'google', 'openai']
  for (const provider of order) {
    if (PROVIDER_POLICIES[provider].keyRegex.test(trimmed)) {
      return provider
    }
  }

  return null
}

export function analyzeApiKey(key: string): ApiKeyAnalysis {
  const trimmed = key.trim()
  if (!trimmed) {
    return {
      detectedProvider: null,
      recognizedFormat: false,
      saveable: false,
    }
  }

  const detectedProvider = detectProviderFromApiKey(trimmed)

  return {
    detectedProvider,
    recognizedFormat: detectedProvider !== null,
    saveable: true,
  }
}
