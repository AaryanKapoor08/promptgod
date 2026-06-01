export const GOOGLE_MAX_ATTEMPTS_PER_MODEL = 2

export type GoogleEscalationReason =
  | 'rate-limit'
  | 'server-error'
  | 'model-unavailable'
  | 'empty-output'
  | 'unusable-output'
  | 'malformed-response'

export function extractHttpStatus(error: unknown): number | null {
  if (!(error instanceof Error)) return null
  const match = error.message.match(/returned (\d{3})/)
  return match ? Number.parseInt(match[1], 10) : null
}

export function shouldRetryGoogleSameModel(status: number | null, attempt: number): boolean {
  return status !== null
    && isGoogleRetryableStatus(status)
    && attempt < GOOGLE_MAX_ATTEMPTS_PER_MODEL
}

export function isGoogleRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599)
}

// A Google free-tier daily-cap 429 surfaces as RESOURCE_EXHAUSTED whose quota id
// contains "PerDay" (e.g. GenerateRequestsPerDayPerProjectPerModel-FreeTier).
// Retrying the same model cannot succeed and just burns another daily request,
// so these should skip the same-model retry and go straight to provider fallback.
// Per-minute 429s ("PerMinute") are genuinely transient and stay retryable.
export function isGoogleDailyQuotaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return /per[\s-]?day/i.test(message)
}

export function classifyGoogleEscalation(error: unknown): GoogleEscalationReason | null {
  if (!(error instanceof Error)) return null

  const status = extractHttpStatus(error)
  if (status === 429) return 'rate-limit'
  if (status !== null && status >= 500 && status <= 599) return 'server-error'
  if (status === 404 || /model.*(?:not found|unavailable|does not exist)|not found.*model/i.test(error.message)) {
    return 'model-unavailable'
  }
  if (/Google API returned no text output/i.test(error.message)) return 'empty-output'
  if (/Google API returned unusable output/i.test(error.message)) return 'unusable-output'
  if (/malformed|could not parse|invalid json/i.test(error.message)) return 'malformed-response'

  return null
}

export function shouldEscalateGoogleToFallback(error: unknown): boolean {
  return classifyGoogleEscalation(error) !== null
}
