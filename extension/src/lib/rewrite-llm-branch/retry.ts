import { assertBudget, measureTokens } from '../rewrite-core/budget'
import type { ValidationIssue } from '../rewrite-core/types'

const issueSeverityOrder = [
  'UNCHANGED_REWRITE',
  'NEAR_ECHO_REWRITE',
  'ANSWERED_INSTEAD_OF_REWRITING',
  'DROPPED_DELIVERABLE',
  'DROPPED_PRESERVE_TOKEN',
  'GENERIC_PROJECT_BRIEF',
  'FIRST_PERSON_BRIEF',
  'MERGED_SEPARATE_TASKS',
  'ASKED_FORBIDDEN_QUESTION',
  'DECORATIVE_MARKDOWN',
]

export type LlmRetryPayloadBudget = {
  productOwnedTokens: number
  sourceTokens: number
  totalTokens: number
}

export function buildLlmRetryUserMessage(sourceText: string, failedOutput: string, issues: ValidationIssue[]): string {
  const topIssues = [...issues]
    .sort((left, right) => issueSeverityOrder.indexOf(left.code) - issueSeverityOrder.indexOf(right.code))
    .slice(0, 3)
  const issueText = topIssues
    .map((issue) => `${issue.code}${extractFailingSubstring(failedOutput, issue)}`)
    .join('; ')

  const retryMessage = `Retry the rewrite only. Fix these validator failures: ${issueText}. Preserve the source constraints and output only the corrected prompt.
Source:
"""
${sourceText}
"""`

  const budget = measureLlmRetryPayloadBudget(retryMessage, sourceText)
  assertBudget({
    kind: 'llm-retry',
    tokens: budget.productOwnedTokens,
    hardCap: 220,
  })

  return retryMessage
}

function extractFailingSubstring(output: string, issue: ValidationIssue): string {
  if ((issue.code === 'DROPPED_PRESERVE_TOKEN' || issue.code === 'DROPPED_DELIVERABLE') && issue.span?.text) {
    return ` (${issue.span.text.slice(0, 30)})`
  }

  const patterns: Record<string, RegExp> = {
    FIRST_PERSON_BRIEF: /\b(?:my goal is|here'?s what i need you to do|deliverables include)\b.{0,30}/i,
    DECORATIVE_MARKDOWN: /(?:\*\*[^*\n]{1,30}\*\*|```|<instruction>)/i,
    ANSWERED_INSTEAD_OF_REWRITING: /^(?:summary|analysis|findings|root causes?|recommendations?|the complaints suggest|based on the evidence|the most likely)\b.{0,30}/i,
    ASKED_FORBIDDEN_QUESTION: /\b(?:who is the recipient|what is the project|please provide|please share|can you provide|could you provide|tell me more)\b.{0,30}/i,
    GENERIC_PROJECT_BRIEF: /\b(?:explore|assess|evaluate)\s+(?:the\s+feasibility|building)\b.{0,30}/i,
  }
  const pattern = patterns[issue.code]
  if (!pattern) {
    return ''
  }
  const match = output.match(pattern)
  return match ? ` (${match[0].slice(0, 30)})` : ''
}

export function measureLlmRetryPayloadBudget(message: string, sourceText: string): LlmRetryPayloadBudget {
  const totalTokens = measureTokens(message)
  const sourceTokens = measureTokens(sourceText)
  return {
    productOwnedTokens: Math.max(0, totalTokens - sourceTokens),
    sourceTokens,
    totalTokens,
  }
}

