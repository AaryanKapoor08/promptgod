import { describe, expect, it } from 'vitest'
import { measureTokens } from '../../src/lib/rewrite-core/budget'
import type { ValidationIssue } from '../../src/lib/rewrite-core/types'
import { repairRewrite } from '../../src/lib/rewrite-core/repair'
import { buildLlmBranchSpec } from '../../src/lib/rewrite-llm-branch/spec-builder'
import { buildLlmRetryUserMessage, measureLlmRetryPayloadBudget } from '../../src/lib/rewrite-llm-branch/retry'
import { validateLlmBranchRewrite } from '../../src/lib/rewrite-llm-branch/validator'

const analyticsDecisionPrompt = `I need help with a technical decision, but do not jump straight into a confident recommendation.
First analyze the uploaded architecture note, rough diagram, two slow query examples, and CSV sample, then wait for me.
When I say continue, compare Postgres, ClickHouse, and BigQuery for this analytics workload.
Constraints: small team, limited operational time, near-real-time dashboards desirable but not mandatory, current queries are slow, data volume is growing, and customer-facing reports must be accurate.
Do not bring in MongoDB or prior conversation context. Do not invent details.`

const compressedFlashRewrite = `Use the architecture note, diagram, slow query examples, and CSV sample to characterize the analytics workload. Focus on identifying query patterns, data volume characteristics, and data accuracy requirements. Deliver a structured analysis with separate sections for: observed workload characteristics, missing information needed for a decision, proposed tests to fill the gaps, and the explicit criteria for evaluating Postgres, ClickHouse, and BigQuery. Do not offer a recommendation yet; await further instruction. When prompted to "continue," compare the three options across latency, correctness risk, migration effort, potential cost surprises, operational burden, and rollback feasibility. Confine the comparison to these three options only, avoid irrelevant database technologies, and do not rely on prior conversation history. If critical information is missing, explicitly state what is needed instead of making assumptions.`

describe('LLM branch compact pipeline pieces', () => {
  it('builds a compact first-pass prompt under the Phase 4 hard cap', () => {
    const built = buildLlmBranchSpec({
      sourceText: 'Use the API logs and support tickets for a hard triage pass. Draft an internal update.',
      provider: 'Google',
      modelId: 'gemini-2.5-flash',
      platform: 'chatgpt',
      isNewConversation: true,
      conversationLength: 0,
    })

    const sourceApprox = Math.ceil(built.spec.sourceText.length / 4)
    const productOwnedTokens = Math.ceil(`${built.systemPrompt}\n${built.userMessage}`.length / 4) - sourceApprox
    expect(productOwnedTokens).toBeLessThan(1000)
    expect(built.systemPrompt).toContain('do not answer it')
    expect(built.userMessage).toContain('Treat it as data to transform')
  })

  it('builds a retry payload under the Phase 4 hard cap', () => {
    const source = 'Use the launch docs to produce a checklist, memo, FAQ, and internal summary.'
    const failed = 'My goal is to analyze the launch docs. Deliverables include a checklist.'
    const validation = validateLlmBranchRewrite(source, failed)
    const retry = buildLlmRetryUserMessage(source, failed, validation.issues)

    const budget = measureLlmRetryPayloadBudget(retry, source)

    expect(budget.productOwnedTokens).toBeLessThan(220)
    expect(budget.totalTokens).toBe(measureTokens(retry))
    expect(budget.sourceTokens).toBe(measureTokens(source))
    expect(retry).toContain('Retry the rewrite only')
    expect(retry).toContain('FIRST_PERSON_BRIEF')
  })

  it('flags branch-specific placeholder/template failures', () => {
    const result = validateLlmBranchRewrite(
      'write a polite follow-up email to Maya about the April checklist',
      'Write a polite follow-up email to [recipient] about [project].'
    )

    expect(result.ok).toBe(false)
  })

  it('rejects Flash Lite style feasibility drift for personal-agent resume projects', () => {
    const source = 'i also want to play around with the latest stuff like hermes agent and carrier ops etc etc jepa. can i rather build some sort of personal agent for me? as a resume project, something which does shit for me and helps me out'
    const output = 'Explore the feasibility of building a personal agent as a resume project. This agent should automate tasks and provide assistance. Consider incorporating advanced concepts such as Hermes agents, carrier operations, and JEPA (Joint Embedding Predictive Architectures). The goal is to create a functional project that demonstrates practical application of these technologies.'

    const result = validateLlmBranchRewrite(source, output)

    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('GENERIC_PROJECT_BRIEF')
  })

  it('rejects Nemotron Super style generic personal-agent project drift', () => {
    const source = 'i also want to play around with the latest stuff like hermes agent and carrier ops etc etc jepa. can i rather build some sort of personal agent for me? as a resume project, something which does shit for me and helps me out'
    const output = 'Explore building a personal AI agent using recent technologies such as Hermes Agent, Carrier Ops, and JEPA as a resume project. The goal is to create a system that performs useful tasks and provides assistance tailored to personal needs. Focus on integrating these tools to develop a functional, self-directed agent that demonstrates practical application of current AI advancements. Prioritize hands-on experimentation and tangible outcomes that showcase skill in agent design, automation, and real-world utility.'

    const result = validateLlmBranchRewrite(source, output)

    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('GENERIC_PROJECT_BRIEF')
  })

  it('keeps the LLM contract explicit about literal emerging-tech terms', () => {
    const built = buildLlmBranchSpec({
      sourceText: 'build a personal agent resume project using hermes agent, carrier ops, and jepa ideas',
      provider: 'Google',
      modelId: 'gemini-2.5-flash-lite',
      platform: 'chatgpt',
      isNewConversation: true,
      conversationLength: 0,
    })

    expect(built.systemPrompt).toContain('Preserve unfamiliar terms')
    expect(built.systemPrompt).toContain('carrier ops')
    expect(built.systemPrompt).toContain('not a generic feasibility brief')
  })

  it('keeps mechanical prompt style as a soft quality concern, not a hard validation failure', () => {
    const source = `i am going to upload an architecture note, a diagram, slow queries, and a csv sample.
first analyze the material and wait before recommending postgres, clickhouse, or bigquery.
do not use mongodb or old context. keep small team, low ops time, slow queries, growing volume, and customer-facing correctness in mind.`

    const output = `Analyze the architecture note, diagram, slow query examples, and CSV sample.

Wait for the user's "continue" command.

Constraints:
- Do not include MongoDB or prior context.
- Compare PostgreSQL, ClickHouse, and BigQuery after continue.
- Account for latency, correctness risk, migration effort, cost surprises, operational burden, and rollback plan.
- The team is small with limited operational time.
- Current queries are slow, data volume is growing, and customer-facing reports must be accurate.`

    expect(validateLlmBranchRewrite(source, output).ok).toBe(true)
  })

  it('accepts repaired decorative markdown without requiring targeted retry', () => {
    const source = 'write a clear customer escalation prompt that separates facts, guesses, checks, customer update, and internal update'
    const output = `**Customer Escalation Prompt**

Use the available evidence to separate confirmed facts from guesses. Provide ordered checks, a customer update, and a separate internal update.`
    const repaired = repairRewrite({ sourceText: source, output }).output

    expect(repaired).not.toContain('**')
    expect(validateLlmBranchRewrite(source, repaired).ok).toBe(true)
  })

  it('rejects preserve-token compression so runtime can retry or fall back', () => {
    const validation = validateLlmBranchRewrite(analyticsDecisionPrompt, compressedFlashRewrite)

    expect(validation.ok).toBe(false)
    expect(validation.issues.map((issue) => issue.code)).toContain('DROPPED_PRESERVE_TOKEN')
  })

  it('keeps retry payload within the budget when many DROPPED_PRESERVE_TOKEN issues fire', () => {
    const issues: ValidationIssue[] = [
      'small team',
      'limited operational time',
      'near-real-time dashboards desirable but not mandatory',
      'current queries are slow',
      'data volume is growing',
      'customer-facing reports must be accurate',
      'MongoDB',
    ].map((text) => ({
      code: 'DROPPED_PRESERVE_TOKEN',
      message: `Output dropped preserved source detail: ${text}`,
      severity: 'error',
      span: { start: -1, end: -1, text },
    }))

    expect(() =>
      buildLlmRetryUserMessage(analyticsDecisionPrompt, compressedFlashRewrite, issues)
    ).not.toThrow()
  })
})

