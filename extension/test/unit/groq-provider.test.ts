import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { analyzeApiKey, detectProviderFromApiKey, PROVIDER_POLICIES } from '../../src/lib/provider-policy'
import { callGroqCompletionAPI } from '../../src/lib/llm-client'
import { getModelOptions } from '../../src/popup/model-options'
import { GROQ_CURATED_MODELS, GROQ_COMPLETIONS_URL } from '../../src/lib/rewrite-groq/models'

describe('Groq provider policy', () => {
  it('validates gsk_ keys and rejects others', () => {
    expect(PROVIDER_POLICIES.groq.keyRegex.test('gsk_' + 'a'.repeat(48))).toBe(true)
    expect(PROVIDER_POLICIES.groq.keyRegex.test('sk-or-v1-abc')).toBe(false)
    expect(PROVIDER_POLICIES.groq.keyRegex.test('AIzaSyA123')).toBe(false)
  })

  it('detects a Groq key by prefix', () => {
    expect(detectProviderFromApiKey('gsk_' + 'a'.repeat(48))).toBe('groq')
  })

  it('does not misclassify other providers as Groq', () => {
    expect(detectProviderFromApiKey('sk-or-v1-abc123')).toBe('openrouter')
    expect(detectProviderFromApiKey('AIzaSyA123-abc')).toBe('google')
  })

  it('marks a Groq key as recognized + saveable', () => {
    expect(analyzeApiKey('gsk_' + 'a'.repeat(48))).toEqual({
      detectedProvider: 'groq',
      recognizedFormat: true,
      saveable: true,
    })
  })
})

describe('Groq model options', () => {
  it('exposes the curated Groq models in the popup', () => {
    const options = getModelOptions('groq')
    expect(options.map((o) => o.value)).toEqual(GROQ_CURATED_MODELS.map((m) => m.id))
    expect(options.every((o) => o.tier === 'free')).toBe(true)
  })
})

describe('callGroqCompletionAPI', () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('posts to the Groq OpenAI-compatible endpoint and extracts text', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: 'Rewrite this prompt more clearly.' } }],
    }), { status: 200 }))

    const text = await callGroqCompletionAPI('gsk_test', 'system', 'user', 'llama-3.3-70b-versatile')

    expect(text).toBe('Rewrite this prompt more clearly.')
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(GROQ_COMPLETIONS_URL)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gsk_test')
    const body = JSON.parse(String(init.body))
    expect(body.stream).toBe(false)
    expect(body.model).toBe('llama-3.3-70b-versatile')
  })

  it('falls back to the primary model when none is given', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' } }],
    }), { status: 200 }))

    await callGroqCompletionAPI('gsk_test', 'system', 'user', '')
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body)).model).toBe('llama-3.3-70b-versatile')
  })

  it('throws when the response has no usable text', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{}] }), { status: 200 }))
    await expect(callGroqCompletionAPI('gsk_test', 'system', 'user')).rejects.toThrow('Groq completion returned no text output')
  })

  it('throws with status detail on an API error', async () => {
    mockFetch.mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
    await expect(callGroqCompletionAPI('gsk_test', 'system', 'user')).rejects.toThrow('Groq API returned 429')
  })
})
