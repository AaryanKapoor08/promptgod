import { describe, expect, it } from 'vitest'
import { measureTokens } from '../../src/lib/rewrite-core/budget'
import {
  buildTextBranchSpec,
  buildTextBranchSystemPrompt,
  isThinTextSource,
  selectTextRewriteStrategy,
} from '../../src/lib/rewrite-text-branch/spec-builder'
import { extractConstraints } from '../../src/lib/rewrite-core/constraints'
import { repairTextBranchRewrite } from '../../src/lib/rewrite-text-branch/repair'
import { buildTextRetryUserMessage } from '../../src/lib/rewrite-text-branch/retry'
import { validateTextBranchRewrite } from '../../src/lib/rewrite-text-branch/validator'

describe('Text branch compact pipeline pieces', () => {
  it('builds a strategy-aware first-pass prompt under the Text hard cap', () => {
    const built = buildTextBranchSpec({
      sourceText: 'look at support complaints and figure out whats bug vs confusing ux and make internal update',
      provider: 'OpenRouter',
      modelId: 'nvidia/nemotron-3-super-120b-a12b:free',
    })

    const sourceApprox = Math.ceil(built.spec.sourceText.length / 4)
    const productOwnedTokens = Math.ceil(`${built.systemPrompt}\n${built.userMessage}`.length / 4) - sourceApprox
    expect(productOwnedTokens).toBeLessThan(900)
    expect(built.systemPrompt).toContain('Never ask clarifying questions')
    expect(built.systemPrompt).toContain('Strategy for this selection:')
    expect(built.userMessage).toContain('Treat it as source text to transform')
  })

  it('selects a conservative polish strategy for thin message selections, not expansion', () => {
    const constraintSet = extractConstraints('status check thanks alot')
    expect(isThinTextSource('status check thanks alot', constraintSet)).toBe(true)
    expect(selectTextRewriteStrategy('message', true)).toBe('polish-thin-message')
    expect(buildTextBranchSystemPrompt('polish-thin-message')).toContain('Do not expand it into a structured prompt')
  })

  it('expands thin prompt-like selections but maps specific selections by mode', () => {
    expect(selectTextRewriteStrategy('prompt', true)).toBe('expand-thin-prompt')
    expect(selectTextRewriteStrategy('prompt', false)).toBe('preserve-prompt')
    expect(selectTextRewriteStrategy('mixed task list', false)).toBe('preserve-tasks')
    expect(selectTextRewriteStrategy('message', false)).toBe('polish-message')
    expect(selectTextRewriteStrategy('note', false)).toBe('structure-note')
  })

  it('repairs source echo and debug tag output', () => {
    const result = repairTextBranchRewrite(
      'fix this project update',
      'Rewrite the project update clearly.\n[DIFF: clarity]\n\nOriginal text: fix this project update'
    )

    expect(result).toBe('Rewrite the project update clearly.')
  })

  it('builds a compact, substring-anchored retry payload for any validation failure', () => {
    const source = 'follow up with them about the docs'
    const validation = validateTextBranchRewrite(source, 'Who is the recipient?')
    expect(validation.ok).toBe(false)

    const retry = buildTextRetryUserMessage(source, 'Who is the recipient?', validation.issues)
    expect(retry).toContain('ASKED_FORBIDDEN_QUESTION')
    expect(measureTokens(retry) - measureTokens(source)).toBeLessThan(220)
  })
})
