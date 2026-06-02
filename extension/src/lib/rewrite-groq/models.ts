// Groq provider model constants.
// Groq exposes an OpenAI-compatible chat-completions endpoint with a generous free
// tier, so it slots into the existing OpenAI-compatible request path. The primary is
// Llama 3.3 70B (a non-reasoning model that holds conservation well on the battery's
// hard cases); the 8B instant model is offered as a faster, lighter option.

export type GroqModel = {
  id: string
  label: string
}

export const GROQ_PRIMARY_MODEL = 'llama-3.3-70b-versatile'

// Backstop model for the Groq chain. The 8B instant model sits in a separate, far more
// generous free-tier bucket (14,400 RPD / 500K TPD vs the 70B's 1,000 RPD / 100K TPD) on
// the SAME Groq key, so it serves as the "can't fully run out" net after the 70B primary
// and the OpenRouter-Nemotron fallback are exhausted.
export const GROQ_FALLBACK_MODEL = 'llama-3.1-8b-instant'

export const GROQ_CURATED_MODELS: GroqModel[] = [
  { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (versatile)' },
  { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (instant)' },
]

export const GROQ_COMPLETIONS_URL = 'https://api.groq.com/openai/v1/chat/completions'

export function normalizeGroqModelId(modelId: string | undefined): string {
  const trimmed = modelId?.trim() ?? ''
  return trimmed || GROQ_PRIMARY_MODEL
}
