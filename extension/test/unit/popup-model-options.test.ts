import { describe, expect, it } from 'vitest'
import { OPENROUTER_CURATED_FREE_MODELS } from '../../src/lib/rewrite-openrouter/curation'
import {
  RECOMMENDED_MODELS,
  buildVisibleFallbackChain,
  formatOpenRouterAccountStatus,
  getModelOptions,
  getOpenRouterFreeChainOptions,
  validateCustomOpenRouterModelId,
} from '../../src/popup/model-options'

describe('popup model options', () => {
  it('recommends the strongest free model from each provider before the compact fallback chain', () => {
    expect(RECOMMENDED_MODELS.map((item) => item.label)).toEqual([
      'Llama 3.3 70B (Groq)',
      'Nemotron 3 Super 120B',
      'Gemini 2.5 Flash',
    ])
  })

  it('keeps the Google dropdown on current Gemini API models', () => {
    expect(getModelOptions('google').map((model) => model.value)).toEqual([
      'gemini-2.5-flash',
      'gemma-4-26b-a4b-it',
      'gemini-2.5-flash-lite',
    ])
  })

  it('builds the dynamic fallback chain per saved key, primaries before secondaries', () => {
    expect(buildVisibleFallbackChain(['groq'])).toEqual(['Llama 3.3 70B', 'Llama 3.1 8B'])
    expect(buildVisibleFallbackChain(['openrouter'])).toEqual(['Nemotron Super', 'Nemotron Nano'])
    expect(buildVisibleFallbackChain(['google'])).toEqual(['Gemini 2.5 Flash', 'Gemma'])
    expect(buildVisibleFallbackChain(['google', 'openrouter'])).toEqual([
      'Nemotron Super',
      'Gemini 2.5 Flash',
      'Nemotron Nano',
      'Gemma',
    ])
    expect(buildVisibleFallbackChain(['groq', 'openrouter'])).toEqual([
      'Llama 3.3 70B',
      'Nemotron Super',
      'Llama 3.1 8B',
      'Nemotron Nano',
    ])
    expect(buildVisibleFallbackChain(['groq', 'google'])).toEqual([
      'Llama 3.3 70B',
      'Gemini 2.5 Flash',
      'Llama 3.1 8B',
      'Gemma',
    ])
  })

  it('shows the full three-provider chain when no keys are saved yet', () => {
    expect(buildVisibleFallbackChain([])).toEqual([
      'Llama 3.3 70B',
      'Nemotron Super',
      'Gemini 2.5 Flash',
      'Llama 3.1 8B',
      'Nemotron Nano',
      'Gemma',
    ])
  })

  it('renders the OpenRouter free chain in curation order', () => {
    expect(getOpenRouterFreeChainOptions().map((model) => model.value)).toEqual(
      OPENROUTER_CURATED_FREE_MODELS.map((model) => model.id)
    )
  })

  it('keeps the popup OpenRouter options aligned with the live-aware runtime projection', () => {
    const options = getModelOptions('openrouter', [
      'nvidia/nemotron-3-super-120b-a12b:free',
      'openai/gpt-oss-20b:free',
      'inclusionai/ling-2.6-flash:free',
      'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
      'openrouter/free',
    ])

    expect(options.map((model) => model.value)).toEqual([
      'nvidia/nemotron-3-super-120b-a12b:free',
      'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
      'openai/gpt-4o-mini',
    ])
    expect(options.map((model) => model.value)).not.toContain('openrouter/free')
    expect(options.map((model) => model.value)).not.toContain('openai/gpt-oss-20b:free')
    expect(options.map((model) => model.value)).not.toContain('inclusionai/ling-2.6-flash:free')
  })

  it('keeps custom OpenRouter model validation permissive but format-aware', () => {
    expect(validateCustomOpenRouterModelId('').valid).toBe(true)
    expect(validateCustomOpenRouterModelId('bad-model')).toEqual({
      valid: false,
      message: 'Custom model IDs must look like org/model-name.',
    })
    expect(validateCustomOpenRouterModelId('custom/model')).toEqual({
      valid: true,
      message: 'Custom model will be saved for OpenRouter.',
    })
  })

  it('formats OpenRouter account status and cap pause states for the popup', () => {
    expect(formatOpenRouterAccountStatus(undefined)).toEqual({
      message: '',
      className: 'status',
    })
    expect(formatOpenRouterAccountStatus({
      bucket: '50/day',
      limit: 50,
      usage: 50,
      remaining: 0,
      paused: true,
      checkedAt: 1,
    })).toEqual({
      message: 'OpenRouter 50/day cap reached. Routing is paused today.',
      className: 'status status--warning',
    })
    expect(formatOpenRouterAccountStatus({
      bucket: '1000/day',
      limit: 1000,
      usage: 4,
      remaining: 996,
      paused: false,
      checkedAt: 1,
    })).toEqual({
      message: 'OpenRouter bucket: 1000/day, 996 remaining.',
      className: 'status',
    })
  })
})
