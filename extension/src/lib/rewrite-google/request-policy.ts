import { isGoogleGemmaModel, normalizeGoogleModelName } from './models'

export const GOOGLE_REWRITE_TEMPERATURE = 0.2
export const GOOGLE_DEFAULT_OUTPUT_TOKENS = 512

export function supportsGoogleThinkingConfig(model: string): boolean {
  return normalizeGoogleModelName(model).toLowerCase().startsWith('gemini-2.5-flash')
}

export function supportsGoogleSystemInstruction(model: string): boolean {
  const normalized = normalizeGoogleModelName(model).toLowerCase()
  return !isGoogleGemmaModel(normalized) || normalized.startsWith('gemma-4-')
}

export function buildGoogleGenerationConfig(model: string, maxTokens: number): Record<string, unknown> {
  const config: Record<string, unknown> = {
    temperature: GOOGLE_REWRITE_TEMPERATURE,
    maxOutputTokens: maxTokens,
  }

  if (supportsGoogleThinkingConfig(model)) {
    config.thinkingConfig = { thinkingBudget: 0 }
  }

  return config
}

export function buildGoogleRequestBody(
  model: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number
): Record<string, unknown> {
  const normalizedModel = normalizeGoogleModelName(model)
  const body: Record<string, unknown> = {
    contents: [
      {
        role: 'user',
        parts: [{
          text: supportsGoogleSystemInstruction(normalizedModel)
            ? userMessage
            : `Instruction:\n${systemPrompt}\n\nTask:\n${userMessage}`,
        }],
      },
    ],
    generationConfig: buildGoogleGenerationConfig(normalizedModel, maxTokens),
  }

  if (systemPrompt.trim() && supportsGoogleSystemInstruction(normalizedModel)) {
    body.systemInstruction = {
      parts: [{ text: systemPrompt }],
    }
  }

  return body
}
