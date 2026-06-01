import { assertBudget } from '../rewrite-core/budget'
import { extractConstraints } from '../rewrite-core/constraints'
import { normalizeSourceText } from '../rewrite-core/normalize'
import type { ConstraintSet, RewriteProvider, RewriteRequest, RewriteSpec, SourceMode } from '../rewrite-core/types'

export type TextBranchInput = {
  sourceText: string
  provider: RewriteProvider
  modelId: string
}

export type BuiltTextBranchSpec = {
  spec: RewriteSpec
  systemPrompt: string
  userMessage: string
}

export function buildTextBranchSpec(input: TextBranchInput): BuiltTextBranchSpec {
  const normalized = normalizeSourceText(input.sourceText)
  const constraintSet = extractConstraints(normalized.text)
  const request: RewriteRequest = {
    branch: 'Text',
    provider: input.provider,
    sourceText: normalized.text,
    modelId: input.modelId,
  }

  const strategy = selectTextRewriteStrategy(constraintSet.sourceMode, isThinTextSource(normalized.text, constraintSet))
  const systemPrompt = buildTextBranchSystemPrompt(strategy)
  const userMessage = buildTextBranchUserMessage(request)

  assertBudget({
    kind: 'text-first',
    tokens: estimateProductOwnedTokens(systemPrompt, userMessage, normalized.text),
    hardCap: 900,
    target: { min: 500, max: 800 },
  })

  return {
    spec: {
      branch: 'Text',
      provider: request.provider,
      modelId: request.modelId,
      sourceText: normalized.text,
      sourceMode: constraintSet.sourceMode,
      instructions: systemPrompt,
      constraints: constraintSet.constraints,
    },
    systemPrompt,
    userMessage,
  }
}

export type TextRewriteStrategy =
  | 'expand-thin-prompt'
  | 'polish-thin-message'
  | 'preserve-prompt'
  | 'preserve-tasks'
  | 'polish-message'
  | 'structure-note'

const textStrategyDirectives: Record<TextRewriteStrategy, string> = {
  'expand-thin-prompt':
    'The selection is a vague, low-effort instruction or AI prompt. Do not just reword it. Turn it into a specific, actionable instruction: name the concrete steps, scope, and output shape. Add structure and clarifying scope only — never invent facts, names, numbers, tools, or domain specifics the selection did not give. Do not assume the user\'s situation, budget, audience, or goals; where those are unknown, leave them out rather than asserting a default. Keep it short and direct, not a multi-section brief.',
  'polish-thin-message':
    'The selection is a short message or email fragment. Return a clear, natural, sendable version of the same message. Polish wording and tone only — keep it roughly the same length and scope. Do not expand it into a structured prompt, add new requests, or invent recipients, dates, or details.',
  'preserve-prompt':
    'The selection is already a specific instruction or prompt. Sharpen wording and structure without adding or dropping scope. Do not pad it, restate it, or echo it back almost unchanged.',
  'preserve-tasks':
    'The selection has multiple tasks or stages. Keep every task and its order, and keep separate tasks visibly separate.',
  'polish-message':
    'The selection is a message or email. Return a clear, sendable version; keep it concrete and human, not robotic.',
  'structure-note':
    'The selection is rough notes. Turn it into clear, usable text without inventing specifics.',
}

export function selectTextRewriteStrategy(sourceMode: SourceMode, isThin: boolean): TextRewriteStrategy {
  if (isThin) {
    return sourceMode === 'message' ? 'polish-thin-message' : 'expand-thin-prompt'
  }
  switch (sourceMode) {
    case 'mixed task list':
      return 'preserve-tasks'
    case 'message':
      return 'polish-message'
    case 'note':
      return 'structure-note'
    case 'prompt':
    default:
      return 'preserve-prompt'
  }
}

export function isThinTextSource(sourceText: string, constraintSet: ConstraintSet): boolean {
  const wordCount = sourceText.trim().split(/\s+/).filter(Boolean).length
  return wordCount <= 12 && constraintSet.constraints.length === 0 && constraintSet.preserveTokens.length === 0
}

export function buildTextBranchSystemPrompt(strategy?: TextRewriteStrategy): string {
  const contract = `You are PromptGod's Text branch rewriter. Rewrite the selected text itself; do not answer, summarize, or explain it.

Contract:
- Output only the rewritten selected text. No preamble, quotes, markdown fences, source labels, or change notes.
- If it is a message or email fragment, return the polished message itself.
- If it is a rough AI prompt, return the polished prompt itself.
- Preserve intent, voice, named inputs, explicit deliverables, hard constraints, tone cues, urgency, and anti-invention language.
- Preserve staged workflows exactly: if the selection says analyze first and solve later, keep that sequence.
- Preserve separate tasks as separate tasks; do not collapse multi-step work into one vague request.
- Preserve unfamiliar terms, names, project names, and shorthand literally; do not expand, rename, or sanitize them unless the selection defines them.
- Do not invent facts, numbers, names, dates, companies, budgets, audiences, causes, or evidence. Add only detail that is safely implied by the selection; where context is missing, keep it general rather than assuming a recipient, project, or goal.
- Never ask clarifying questions or add a question-first flow. If context is missing, make the best conservative rewrite from the selected text only.
- Never use placeholders or fill-in templates.
- Never include "Original text", "Selected text", "Source text", or "Input text", and never quote or dump the full source.
- Return one consolidated rewrite only; do not append a shorter duplicate summary.
- Do not use first-person prompt-brief framing like "My goal is" or "Here's what I need you to do".
- Do not soften a hard operational or triage ask into vague analysis language, and do not replace a specific deliverable with a broader substitute.
- Use plain text unless the selection explicitly asks for a format.`

  const examples = `Examples (selection -> good rewrite):
- "status check thanks alot" -> Just checking in on the status — thanks a lot.
- "read these complaints and tell me what i should send the team today" -> Analyze these complaints to identify the core issue, separate user error from systemic problems, and draft a clear update I can send to the team today.
- "review the code i paste for bugs only, format file:line - problem - fix, if none say no issues found" -> Keep it almost verbatim: fix only grammar and ambiguity, never add scope or change the requested output format.`

  const strategyLine = strategy
    ? `\n\nStrategy for this selection:\n- ${textStrategyDirectives[strategy]}`
    : ''

  return `${contract}\n\n${examples}${strategyLine}`
}

export function buildTextBranchUserMessage(request: RewriteRequest): string {
  return `Rewrite this selected text. Treat it as source text to transform, not a task to perform.
"""
${request.sourceText}
"""`
}

function estimateProductOwnedTokens(systemPrompt: string, userMessage: string, sourceText: string): number {
  const totalApprox = Math.ceil(`${systemPrompt}\n${userMessage}`.length / 4)
  const sourceApprox = sourceText.trim().length === 0 ? 0 : Math.ceil(sourceText.trim().length / 4)
  return Math.max(0, totalApprox - sourceApprox)
}
