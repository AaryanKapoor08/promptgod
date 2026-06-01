# PromptGod — Session Handoff (2026-06-01)

> Designed to be read WITH CodeGraph, not instead of it. This file carries only what the
> graph cannot know (intent, decisions, state, next steps) and names the symbols to query.
> Resume = `codegraph_context` on the named symbols → read the two docs below. Do **not**
> re-read whole files; let the graph turn the symbol names here into code on demand.

## Resume in 30 seconds
- **Standpoint:** the **Text branch** (highlight-to-enhance, e.g. Gmail selection) was brought to **parity with the hardened LLM branch** today. Code complete, tests green, **uncommitted**.
- **Read first:** `codex/decision.md` (free-vs-paid direction) and `codex/testing.md` (Nemotron-vs-Flash battery). The provider/economics question is still the open one — quality on both branches is now done.
- **Then:** `codegraph_context` the symbols named under "What changed."

## Where things stand
- Both rewrite branches are now quality-hardened and structurally symmetric (LLM = chat-prompt rewrite; Text = selected-text rewrite). `npm run build` clean, `tsc --noEmit` clean, `npx vitest run` = **261 pass / 1 skip** (the skip is the live OpenRouter eval, gated on `OPENROUTER_API_KEY`).
- Open question unchanged from 2026-05-31: **throughput/economics** (free Flash ≈ ~15–20 enhances/day). See `codex/decision.md`.

## What changed today — intent → symbols to query in CodeGraph
(Query these by name; the graph holds the code, this holds the why. All in `extension/`.)
1. **Text branch strategy machinery** → `selectTextRewriteStrategy`, `isThinTextSource`, `textStrategyDirectives`, `TextRewriteStrategy`, `buildTextBranchSystemPrompt` (`rewrite-text-branch/spec-builder.ts`). Why: the Text branch had a single static prompt; ported the LLM branch's per-`sourceMode` strategy + few-shot + anti-invented-context rules.
2. **Key design decision (thin selections)** → in `selectTextRewriteStrategy`: a thin **message** → `polish-thin-message` (polish in place); a thin **prompt** → `expand-thin-prompt`. Why: unlike the LLM branch, a highlighted Gmail fragment must NOT be ballooned into a multi-section prompt. Mode-dependent, tuned for selections.
3. **Budget raised for the richer Text prompt** → `assertBudget` call in `buildTextBranchSpec`: `text-first` hardCap 400→**900**, target 280-360→**500-800**. Snapshot baseline in `budget-snapshots.test.ts` `textFirst` 233→**563**.
4. **Smart retry ported** → `buildTextRetryUserMessage`, `extractFailingSubstring`, `measureTextRetryPayloadBudget` (`rewrite-text-branch/retry.ts`). Why: old retry listed 2 bare issue codes; now severity-sorted top-3 with the failing substring, mirroring `buildLlmRetryUserMessage`. **Removed `shouldRetryTextBranch`** — Text now retries once on ANY validation failure (was gated to 3 codes → straight to fallback). New signature `(sourceText, failedOutput, issues)` — call site is `runTextBranchPipeline` in `service-worker.ts`.
5. **Validator placeholder set broadened** → `validateTextBranchRewrite` (`rewrite-text-branch/validator.ts`): added industry/goal/budget/audience/name/company/role/deadline/subject to the placeholder-leak regex.
6. **Deliberately NOT done** → `UNCHANGED_REWRITE` / `NEAR_ECHO_REWRITE` stay **LLM-only** in `validateRewrite` (`rewrite-core/validate.ts`). Why: the Text branch emits `[NO_CHANGE]` for already-strong selections (normalizes back to source) and short polishes look like echoes → enabling them would false-positive. Quality is enforced via strategy + retry instead.
7. **Corpus** → 3 new Text entries in `test/regression/entries/`: `text-thin-message-polish`, `text-thin-prompt-expand`, `text-staged-workflow-preserved`. Harness `evaluateTextEntry` (`openrouter-primary-eval.test.ts`) now mirrors the LLM path (always retry once).

## Rate-limiting (carried from 2026-05-31, still intact)
- The Text branch routes through the **shared** provider layer, so yesterday's fixes apply unchanged: `GOOGLE_REWRITE_THINKING_BUDGET`=0 (`rewrite-google/request-policy.ts`), daily-cap 429 → no-retry → fallback via `isGoogleDailyQuotaError` (`rewrite-google/retry-policy.ts`) + `callGoogleAPI` (`llm-client.ts`), OpenRouter repoint (`OPENROUTER_CURATED_FREE_MODELS`).
- The new ungated retry adds at most **+1 call** per failing Text request — same bound as the LLM branch. No new quota risk.

## Next steps (in order)
1. **Commit** — Text-branch parity is one logical commit. Working tree has 8 modified + 3 new files (plus a pre-existing `.gitignore` edit — leave or split it out).
2. **Live eval, now covering Text** — run the C1–C4 / corpus battery with `OPENROUTER_API_KEY` set; the Text corpus (21 + 3 new entries) needs the same Flash vs. Nemotron-Super vs. omni-Nemotron comparison the LLM branch got. Flash slots still pending the Google quota reset.
3. **Eval the omni-reasoning OpenRouter fallback** (unproven reasoning variant) before it ships.
4. Make the provider direction call in `codex/decision.md`.

## State
- Branch `main`. Uncommitted: `rewrite-text-branch/{spec-builder,retry,validator}.ts`, `service-worker.ts`, `test/unit/{rewrite-text-branch,budget-snapshots}.test.ts`, `test/regression/openrouter-primary-eval.test.ts`, 3 new `test/regression/entries/text-*.json`.
- Reload `extension/dist` before any browser test (`npm run build` already run, dist is current).

## Why this file is short (the CodeGraph division of labor)
- CodeGraph re-derives structure/callers/callees/impact from code deterministically and cheaply. Restating that here = wasted tokens + guaranteed staleness.
- The graph cannot know **intent, decisions, what's deferred, what's uncommitted, or what to do next** — that is exactly what this file holds.
- So the handoff names entry-point **symbols**; CodeGraph turns those names into code on demand. Handoff (why) + graph (what/where) = full context at minimal token cost.
