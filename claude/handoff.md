# PromptGod — Session Handoff (2026-05-31)

> Designed to be read WITH CodeGraph, not instead of it. This file carries only what the
> graph cannot know (intent, decisions, state, next steps) and names the symbols to query.
> Resume = run `codegraph sync` → `codegraph_context` on the named symbols → read the two
> docs below. Do **not** re-read whole files.

## Resume in 30 seconds
- **Standpoint:** rewrite-quality work is DONE and verified; the open question is throughput/economics (free tier ≈ ~15 enhances/day, not viable for daily use).
- **Read first:** `codex/decision.md` (the free-vs-paid direction) and `codex/testing.md` (the Nemotron-vs-Flash battery).
- **Then:** `codegraph sync`, and `codegraph_context` the symbols named under "What changed."

## Where things stand
- Non-Gemma (Flash + OpenRouter) rewrite pipeline: quality passes on conservation, sharpness, tone, vague-expand, staged-workflow, constraint-heavy. `npm test` = 259 pass / 1 skip; `npm run build` clean.
- **Nemotron 3 Super scored 10/10 across the C1–C4 battery** (`codex/testing.md`). Flash head-to-head is **pending** the Google daily-quota reset.
- Decision still open: **personal/demo (free)** vs **cheap-paid OpenRouter Nemotron** (~$10 → 1000/day or pennies paid). See `codex/decision.md`.

## What changed today — intent → symbols to query in CodeGraph
(Query these by name; the graph holds the code, this holds the why.)
1. **Flash vague-input no-op fix** → `isThinLlmSource`, `selectLlmRewriteStrategy`, `buildLlmBranchSystemPrompt` (`rewrite-llm-branch/spec-builder.ts`). Why: thin/vague inputs were reworded, not expanded. Added few-shot examples + per-`sourceMode` strategy + an anti-invented-context rule (don't assume budget/audience).
2. **Thinking-budget revert** → `GOOGLE_REWRITE_THINKING_BUDGET` (=0), `buildGoogleGenerationConfig` (`rewrite-google/request-policy.ts`). Why: a positive budget collides with `maxOutputTokens` in Gemini 2.5 → `MAX_TOKENS` empty output → every Flash call failed to Gemma. Keep at 0 unless output cap is raised first.
3. **Daily-cap 429 retry fix** → `isGoogleDailyQuotaError` (`rewrite-google/retry-policy.ts`) + call site in `callGoogleAPI` (`llm-client.ts`). Why: daily-cap 429s were wastefully retried (2 requests/cap-hit); now skip retry → provider fallback. Per-minute 429s stay retryable.
4. **Fuller retry feedback** → `extractFailingSubstring` (`rewrite-llm-branch/retry.ts`); `firstMissingDeliverable` + DROPPED_DELIVERABLE span (`rewrite-core/validate.ts`). Why: retry payload only named 2 of 6 issue codes.
5. **Dead OpenRouter fallback repointed** → `OPENROUTER_CURATED_FREE_MODELS`, `normalizeOpenRouterModelId` (`rewrite-openrouter/curation.ts`) + `normalizeModelId` (`popup.ts`). Why: `nvidia/nemotron-3-nano-30b-a3b:free` was removed from the live catalog → repointed to `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`. **UNPROVEN — it's a reasoning variant; eval before trusting.**
6. **Corpus** → 4 new entries in `test/regression/entries/` (`llm-vague-expand-system-design`, `llm-already-strong-code-reviewer`, `llm-messy-checkout-500s`, `llm-constraint-heavy-cover-letter`).
7. **Docs** → `productvision.md` quota correction (Flash ~20 RPD, not 250); new `codex/decision.md`.

## Next steps (in order)
1. After Google quota reset (~12:30 PM IST / midnight PT): run C1–C4 on **Flash**, fill the `Gemini Flash:` slots + Flash column in `codex/testing.md`, pick per-prompt winners.
2. **Eval the omni-reasoning fallback** (#5) against C1–C4 before it ships — reasoning models echo/burn budget; if it cracks on C3, swap it.
3. Make the direction call in `codex/decision.md` (free demo vs $10-credit Nemotron primary). Key open Q: API key distribution for ~10 users.
4. **Commit** — everything below is uncommitted.

## State
- Branch `main`. Working tree: **all of today's work is uncommitted.** Suggested commit split is in `codex/decision.md` (code-changes section).
- Reload `extension/dist` before any browser test.

## Why this file is short (the CodeGraph division of labor)
- CodeGraph re-derives structure/callers/callees/impact from code deterministically and cheaply. Restating that here = wasted tokens + guaranteed staleness.
- The graph cannot know **intent, decisions, what's deferred, what's uncommitted, or what to do next** — that is exactly what this file holds.
- So the handoff names entry-point **symbols**; CodeGraph turns those names into code on demand. Handoff (why) + graph (what/where) = full context at minimal token cost.
