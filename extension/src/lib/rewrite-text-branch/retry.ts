import { assertBudget, measureTokens } from '../rewrite-core/budget'
import type { ValidationIssue } from '../rewrite-core/types'

const issueSeverityOrder = [
  'ANSWERED_INSTEAD_OF_REWRITING',
  'ASKED_FORBIDDEN_QUESTION',
  'FIRST_PERSON_BRIEF',
  'DROPPED_DELIVERABLE',
  'DROPPED_PRESERVE_TOKEN',
  'MERGED_SEPARATE_TASKS',
  'GENERIC_PROJECT_BRIEF',
  'DECORATIVE_MARKDOWN',
  'UNCHANGED_REWRITE',
  'NEAR_ECHO_REWRITE',
]

export type TextRetryPayloadBudget = {
  productOwnedTokens: number
  sourceTokens: number
  totalTokens: number
}

export function buildTextRetryUserMessage(sourceText: string, failedOutput: string, issues: ValidationIssue[]): string {
  const topIssues = [...issues]
    .sort((left, right) => issueSeverityOrder.indexOf(left.code) - issueSeverityOrder.indexOf(right.code))
    .slice(0, 3)
  const issueText = topIssues
    .map((issue) => `${issue.code}${extractFailingSubstring(failedOutput, issue)}`)
    .join('; ')

  const anchor = sourceText.length > 220 ? `${sourceText.slice(0, 220)}...` : sourceText
  const retryMessage = `Retry the Text branch rewrite only. Fix these validator failures: ${issueText}. No questions, source echo, duplicate summary, placeholders, or answering — output only the corrected rewritten text.
Source:
"""
${anchor}
"""`

  const budget = measureTextRetryPayloadBudget(retryMessage, anchor)
  assertBudget({
    kind: 'text-retry',
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

export function measureTextRetryPayloadBudget(message: string, sourceText: string): TextRetryPayloadBudget {
  const totalTokens = measureTokens(message)
  const sourceTokens = measureTokens(sourceText)
  return {
    productOwnedTokens: Math.max(0, totalTokens - sourceTokens),
    sourceTokens,
    totalTokens,
  }
}
