import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { extractConstraints } from '../../src/lib/rewrite-core/constraints'
import { repairRewrite } from '../../src/lib/rewrite-core/repair'
import { buildLlmBranchSpec } from '../../src/lib/rewrite-llm-branch/spec-builder'
import { validateLlmBranchRewrite } from '../../src/lib/rewrite-llm-branch/validator'
import { getOpenRouterFreeChainOptions } from '../../src/popup/model-options'
import { repairTextBranchRewrite } from '../../src/lib/rewrite-text-branch/repair'
import { buildTextBranchSpec } from '../../src/lib/rewrite-text-branch/spec-builder'
import { validateTextBranchRewrite } from '../../src/lib/rewrite-text-branch/validator'

type Branch = 'LLM' | 'Text'
type Provider = 'Google' | 'OpenRouter'
type Severity = 'regression-must-not-recur' | 'quality-target'

type RegressionEntry = {
  id: string
  branch: Branch
  source: string
  expected_violation_codes: string[]
  expected_preserved_constraints: string[]
  severity: Severity
  notes: string
}

const allowedBranches = new Set<Branch>(['LLM', 'Text'])
const allowedSeverities = new Set<Severity>(['regression-must-not-recur', 'quality-target'])
const allowedViolationCodes = new Set([
  'ANSWERED_INSTEAD_OF_REWRITING',
  'ASKED_FORBIDDEN_QUESTION',
  'DEBUG_TAG_LEAK',
  'DECORATIVE_MARKDOWN',
  'DROPPED_DELIVERABLE',
  'DUPLICATE_SUMMARY',
  'FIRST_PERSON_BRIEF',
  'GENERIC_SOFTENING',
  'INVENTED_DETAIL',
  'MERGED_SEPARATE_TASKS',
  'PLACEHOLDER_LEAK',
  'SOURCE_ECHO',
  'STAGED_WORKFLOW_COLLAPSE',
  'TEMPLATE_OUTPUT',
  'UNNECESSARY_CLARIFYING_QUESTION',
])

const runTargets: Array<{ branch: Branch; provider: Provider }> = [
  { branch: 'LLM', provider: 'Google' },
  { branch: 'LLM', provider: 'OpenRouter' },
  { branch: 'Text', provider: 'Google' },
  { branch: 'Text', provider: 'OpenRouter' },
]

const skippedGemmaTargets = [
  { branch: 'LLM', provider: 'Gemma', reason: 'Gemma is exempt by pipeline-isolation rule' },
  { branch: 'Text', provider: 'Gemma', reason: 'Gemma is exempt by pipeline-isolation rule' },
] as const

const entriesDir = fileURLToPath(new URL('./entries/', import.meta.url))

type LocalEvaluation = {
  passed: boolean
  errors: string[]
}

function loadEntries(): RegressionEntry[] {
  return readdirSync(entriesDir)
    .filter((fileName) => fileName.endsWith('.json'))
    .sort()
    .map((fileName) => {
      const raw = readFileSync(join(entriesDir, fileName), 'utf8')
      const parsed = JSON.parse(raw) as RegressionEntry
      expect(parsed.id).toBe(basename(fileName, '.json'))
      return parsed
    })
}

function validateEntry(entry: RegressionEntry): string[] {
  const errors: string[] = []

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id)) {
    errors.push('id must be stable kebab-case')
  }
  if (!allowedBranches.has(entry.branch)) {
    errors.push(`branch must be one of ${Array.from(allowedBranches).join(', ')}`)
  }
  if (typeof entry.source !== 'string' || entry.source.trim().length < 10) {
    errors.push('source must be a meaningful non-empty string')
  }
  if (!Array.isArray(entry.expected_violation_codes) || entry.expected_violation_codes.length === 0) {
    errors.push('expected_violation_codes must be a non-empty array')
  } else {
    for (const code of entry.expected_violation_codes) {
      if (!allowedViolationCodes.has(code)) {
        errors.push(`unknown expected_violation_code: ${code}`)
      }
    }
  }
  if (
    !Array.isArray(entry.expected_preserved_constraints) ||
    entry.expected_preserved_constraints.length === 0 ||
    entry.expected_preserved_constraints.some((constraint) => typeof constraint !== 'string' || constraint.trim().length < 3)
  ) {
    errors.push('expected_preserved_constraints must be a non-empty array of strings')
  }
  if (!allowedSeverities.has(entry.severity)) {
    errors.push(`severity must be one of ${Array.from(allowedSeverities).join(', ')}`)
  }
  if (typeof entry.notes !== 'string' || entry.notes.trim().length < 12) {
    errors.push('notes must record why the entry exists')
  }

  return errors
}

function evaluateEntryForTarget(entry: RegressionEntry, target: { branch: Branch; provider: Provider }): LocalEvaluation | null {
  if (entry.branch !== target.branch) {
    return null
  }

  const errors = [
    ...validateEntry(entry),
    ...evaluateLocalPipelineContract(entry, target),
  ]

  return {
    passed: errors.length === 0,
    errors,
  }
}

function formatTarget(target: { branch: Branch; provider: Provider }): string {
  return `${target.branch} + ${target.provider}`
}

function evaluateLocalPipelineContract(entry: RegressionEntry, target: { branch: Branch; provider: Provider }): string[] {
  const errors: string[] = []
  const provider = target.provider

  const built = entry.branch === 'LLM'
    ? buildLlmBranchSpec({
      sourceText: entry.source,
      provider,
      modelId: provider === 'Google' ? 'gemini-2.5-flash' : 'nvidia/nemotron-3-super-120b-a12b:free',
      platform: 'chatgpt',
      isNewConversation: true,
      conversationLength: 0,
    })
    : buildTextBranchSpec({
      sourceText: entry.source,
      provider,
      modelId: provider === 'Google' ? 'gemini-2.5-flash' : 'nvidia/nemotron-3-super-120b-a12b:free',
    })

  if (!built.systemPrompt.includes('Output only')) {
    errors.push('production spec must keep output-only contract')
  }
  if (!built.userMessage.includes(entry.source.trim())) {
    errors.push('production user message must carry the corpus source')
  }
  if (provider === 'OpenRouter' && getOpenRouterFreeChainOptions().some((model) => model.value === 'openrouter/free')) {
    errors.push('OpenRouter runtime projection must not include openrouter/free')
  }

  const constraints = extractConstraints(entry.source)
  for (const expectedCode of entry.expected_violation_codes) {
    if (!expectationCoveredByLocalGate(entry, expectedCode, built.systemPrompt, constraints)) {
      errors.push(`${expectedCode} is not covered by local validator, repair, or production contract`)
    }
  }

  return errors
}

function expectationCoveredByLocalGate(
  entry: RegressionEntry,
  code: string,
  systemPrompt: string,
  constraints: ReturnType<typeof extractConstraints>
): boolean {
  const source = entry.source
  const validate = (output: string): string[] => {
    const result = entry.branch === 'LLM'
      ? validateLlmBranchRewrite(source, output)
      : validateTextBranchRewrite(source, output)
    return result.issues.map((issue) => issue.code)
  }

  switch (code) {
    case 'DECORATIVE_MARKDOWN':
      return validate('**Rewritten prompt**\n\nUse the source material clearly.').includes('DECORATIVE_MARKDOWN')

    case 'FIRST_PERSON_BRIEF':
      return validate('My goal is to turn this into a clear project brief.').includes('FIRST_PERSON_BRIEF')

    case 'ANSWERED_INSTEAD_OF_REWRITING':
      return validate('The complaints suggest three root causes and two urgent fixes.').includes('ANSWERED_INSTEAD_OF_REWRITING') ||
        /do not answer/i.test(systemPrompt)

    case 'ASKED_FORBIDDEN_QUESTION':
    case 'UNNECESSARY_CLARIFYING_QUESTION':
      return entry.branch === 'Text'
        ? validate('Who is the recipient?').includes('ASKED_FORBIDDEN_QUESTION')
        : /Ask clarifying questions only/i.test(systemPrompt)

    case 'DROPPED_DELIVERABLE':
      return validate('Rewrite the source clearly.').includes('DROPPED_DELIVERABLE') ||
        /Preserve[^.\n]+deliverables/i.test(systemPrompt)

    case 'MERGED_SEPARATE_TASKS':
    case 'STAGED_WORKFLOW_COLLAPSE':
      return validate('Summarize the source and draft the response in one combined pass.').includes('MERGED_SEPARATE_TASKS') ||
        /Preserve staged workflows exactly|one consolidated rewrite/i.test(systemPrompt)

    case 'PLACEHOLDER_LEAK':
    case 'TEMPLATE_OUTPUT':
      return validate('Write a polite update to [recipient] about [project] by [date].').includes('DROPPED_DELIVERABLE')

    case 'SOURCE_ECHO':
      return entry.branch === 'Text'
        ? validate(`Rewrite this clearly.\n\nOriginal text: ${source}`).includes('ANSWERED_INSTEAD_OF_REWRITING')
        : validate(source).includes('UNCHANGED_REWRITE') || repairRewrite({ sourceText: source, output: `Rewrite this clearly.\n\nOriginal text: ${source}` }).changed

    case 'DUPLICATE_SUMMARY': {
      const duplicated = 'Analyze the notes and draft a team update.\n\nAnalyze the notes and draft a team update.'
      const repaired = entry.branch === 'Text'
        ? repairTextBranchRewrite(source, duplicated)
        : repairRewrite({ sourceText: source, output: duplicated }).output
      return repaired === 'Analyze the notes and draft a team update.'
    }

    case 'DEBUG_TAG_LEAK':
      return !repairRewrite({ sourceText: source, output: 'Use the source clearly.\n[DIFF: debug]' }).output.includes('[DIFF:')

    case 'INVENTED_DETAIL':
      return constraints.constraints.some((constraint) => constraint.kind === 'no-invention') ||
        /Do not invent facts/i.test(systemPrompt)

    case 'GENERIC_SOFTENING':
      return /Preserve the user's intent/i.test(systemPrompt) ||
        validate('My goal is to explore this topic in a generic way.').some((issue) =>
          issue === 'FIRST_PERSON_BRIEF' || issue === 'GENERIC_PROJECT_BRIEF'
        )

    default:
      return false
  }
}

describe('regression corpus schema', () => {
  const entries = loadEntries()

  it('contains at least 30 entries split across LLM and Text branches', () => {
    const branchCounts = entries.reduce<Record<Branch, number>>(
      (counts, entry) => {
        counts[entry.branch] += 1
        return counts
      },
      { LLM: 0, Text: 0 }
    )

    expect(entries.length).toBeGreaterThanOrEqual(30)
    expect(branchCounts.LLM).toBeGreaterThan(0)
    expect(branchCounts.Text).toBeGreaterThan(0)
  })

  it('validates every entry against the locked schema', () => {
    const failures = entries.flatMap((entry) =>
      validateEntry(entry).map((error) => `${entry.id}: ${error}`)
    )

    expect(failures).toEqual([])
  })

  it('covers every known Phase 1 violation category', () => {
    const emittedCodes = new Set(entries.flatMap((entry) => entry.expected_violation_codes))

    for (const code of allowedViolationCodes) {
      expect(emittedCodes.has(code), `missing corpus coverage for ${code}`).toBe(true)
    }
  })
})

describe('regression corpus target runner', () => {
  const entries = loadEntries()

  it('skips Gemma combinations explicitly', () => {
    for (const skipped of skippedGemmaTargets) {
      console.info(`Skipping ${skipped.branch} + ${skipped.provider}: ${skipped.reason}`)
    }

    expect(skippedGemmaTargets).toHaveLength(2)
  })

  it('reports per-branch and per-provider pass rates and enforces thresholds', () => {
    const report = runTargets.map((target) => {
      const applicable = entries.filter((entry) => entry.branch === target.branch)
      const evaluated = applicable.map((entry) => ({
        entry,
        result: evaluateEntryForTarget(entry, target),
      }))
      const passed = evaluated.filter(({ result }) => result?.passed === true).map(({ entry }) => entry)
      const bySeverity = {
        'regression-must-not-recur': applicable.filter((entry) => entry.severity === 'regression-must-not-recur'),
        'quality-target': applicable.filter((entry) => entry.severity === 'quality-target'),
      }
      const passedBySeverity = {
        'regression-must-not-recur': bySeverity['regression-must-not-recur'].filter((entry) => evaluateEntryForTarget(entry, target)?.passed === true),
        'quality-target': bySeverity['quality-target'].filter((entry) => evaluateEntryForTarget(entry, target)?.passed === true),
      }
      const failures = evaluated
        .filter(({ result }) => result && !result.passed)
        .map(({ entry, result }) => `${entry.id}: ${result?.errors.join('; ')}`)
      const regressionRate =
        bySeverity['regression-must-not-recur'].length === 0
          ? 1
          : passedBySeverity['regression-must-not-recur'].length / bySeverity['regression-must-not-recur'].length
      const qualityRate =
        bySeverity['quality-target'].length === 0
          ? 1
          : passedBySeverity['quality-target'].length / bySeverity['quality-target'].length

      return {
        target: formatTarget(target),
        total: applicable.length,
        passed: passed.length,
        passRate: passed.length / applicable.length,
        regressionRate,
        qualityRate,
        failures,
      }
    })

    for (const row of report) {
      console.info(
        `${row.target}: ${row.passed}/${row.total} entries pass; regression=${Math.round(
          row.regressionRate * 100
        )}%; quality=${Math.round(row.qualityRate * 100)}%`
      )
      expect(row.total, `${row.target} has no applicable corpus entries`).toBeGreaterThan(0)
      expect(row.failures, `${row.target} local pipeline contract failures`).toEqual([])
      expect(row.regressionRate, `${row.target} regression-must-not-recur rate`).toBe(1)
      expect(row.qualityRate, `${row.target} quality-target rate`).toBeGreaterThanOrEqual(0.9)
    }
  })
})

