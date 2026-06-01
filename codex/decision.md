# PromptGod — Provider / Model Decision Record

Created: 2026-05-31
Status: **open — deciding between "personal/demo" and "cheap-paid daily tool"**
Owner: Aaryan

This file exists so the core direction decision is not lost between sessions. It captures **what is true**, **what the budget is**, **the options on the table**, and **what still has to be tested/decided**. Update it when a decision is made.

---

## The decision being made

> Is PromptGod a **personal/demo project** (free-tier LLMs, accept the rate-limit wall), or do we move to a **cheap-paid / credit-backed model** so it can be a real daily tool for ~10 people on a ~10 CAD budget?

Trigger: free-tier Google Flash turned out to be far more rate-limited than the docs claimed, making free Flash unusable as a daily driver. The quality of the rewrites is **not** the blocker — throughput/economics is.

---

## Hard facts (verified this session)

### Quotas
- **Free Gemini 2.5 Flash: ~20 requests/day** (observed `quota value: 20`, quota id `GenerateRequestsPerDayPerProjectPerModel-FreeTier`). The previously-recorded 250/day was a stale docs figure — corrected in `productvision.md`.
  - At 1–2 Flash requests per enhance → **~10–15 enhances/day**. Demo budget only.
  - Also a 10 requests/minute burst cap.
- **Free OpenRouter `:free` models** (account-level, shared across all free models):
  - **50/day** if the account has bought < $10 of credits.
  - **1,000/day** if the account has bought ≥ $10 of credits (one-time).
  - 20 requests/minute burst.

### Pricing (OpenRouter, from live catalog 2026-05-31)
- **Nemotron 3 Super 120B — free** (`...super-120b-a12b:free`): live, **1,000,000 context**.
- **Nemotron 3 Super 120B — paid** (`...super-120b-a12b`): **$0.09 / 1M prompt tokens, $0.45 / 1M completion tokens** ≈ **~$0.00024 per enhance**.

### Volatility (the real risk for any free-primary plan)
- OpenRouter free models churn. Confirmed live this session: the curated fallback `nvidia/nemotron-3-nano-30b-a3b:free` **was removed** from the catalog and replaced by `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` (a reasoning variant). Earlier, Ling models vanished/expired the same way.
- A free-OpenRouter **primary** can break when a provider renames/pulls a model. Paid models are far more stable.

---

## Budget math (~10 CAD ≈ ~$7–10 USD, ≥10 people daily)

- **Paid Nemotron Super:** ~$0.00024/enhance → **~$10 ≈ ~41,000 enhances**. For 10 people doing ~20 enhances/day that is **~7 months** of runway. Cost is *not* the constraint.
- **$10 one-time OpenRouter credit:** unlocks **1,000 free requests/day** on the key (≈ 100/person/day across 10 people) *and* leaves the $10 available for paid models. Best blended option.

Conclusion: ~10 CAD comfortably covers 10 daily users. The limiting factors are **key distribution** and **model choice**, not money.

---

## Options

1. **Personal / demo (free).** Free Flash (~15/day) or free OpenRouter Nemotron (~50/day). Accept the wall and the model churn. Zero cost, not a real product.
2. **Free-but-fragile daily ($10 one-time OpenRouter credit → 1,000/day).** Genuinely usable, but built on `:free` models that churn — needs robust auto-curation to survive model removals.
3. **Real product, ~free (paid).** Paid Nemotron Super (pennies, stable) or a billing-enabled Google key. Stable and uncapped. Best fit for "10 people daily, reliable."

Current lean: **test toward option 2/3** — price/performance across Nemotron vs Flash vs new models, then pick the best under the budget.

---

## What to test next

- **Nemotron Super vs Gemini Flash vs new models** on the same prompt set (vague-expand, already-strong, messy-triage, constraint-heavy, message conservation) — score conservation + sharpness, and note cost per enhance.
- Run the **OpenRouter Primary Eval Gate** (still never passed — blocked by the 50/day cap; needs a $10-credit key or a 1000/day bucket).
- Evaluate the new fallback `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` — it is a **reasoning** model (CoT-budget-burn risk); confirm the guard stack (reasoning disabled) keeps it usable before trusting it.
- How to test in-browser today: popup → provider **OpenRouter** → **Nemotron Super** → run enhances (hits 50/day without credits).

---

## Open questions (must resolve before "10 people daily")

- **Key distribution.** One shared key embedded in the build for 10 trusted people is simplest and fits the budget, but the key is extractable from the bundle and could be drained/abused. Mitigations: OpenRouter spend cap on the key, or each person brings their own free key, or a tiny key-holding proxy (the old `server/` was removed in legacy Phase 16, so this means new infra).
- **Which model wins** on price/performance for our prompt types.
- **Churn mitigation** if we stay on `:free` (auto-curation must demote dead ids and promote live ones without shipping a build).

---

## Status: quality vs throughput

- **Quality work is done.** Conservation and sharpness both pass across vague-expand, already-strong, messy-triage, constraint-heavy, staged-workflow, and message inputs (see session work: few-shot examples, mode-aware strategy, fuller retry feedback, thinking-budget revert, daily-quota retry fix).
- **The remaining blocker is throughput/economics**, which is exactly the decision above. No code change raises a free-tier cap.

---

## Code changes made this session (for future-me)

- Flash quality: few-shot examples + input-mode-aware strategy (incl. thin-input expansion) + anti-invented-context tightening in `rewrite-llm-branch/spec-builder.ts`; fuller retry substrings in `rewrite-llm-branch/retry.ts` + naming span in `rewrite-core/validate.ts`.
- Reverted the Flash `thinkingBudget` to 0 (a positive budget collided with `maxOutputTokens` → `MAX_TOKENS` empty output; see `rewrite-google/request-policy.ts`).
- Added `isGoogleDailyQuotaError` → daily-cap 429s skip the same-model retry (`rewrite-google/retry-policy.ts`, `llm-client.ts`).
- Repointed the dead curated fallback `nvidia/nemotron-3-nano-30b-a3b:free` → `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` (`rewrite-openrouter/curation.ts`, `popup.ts`, tests).
- Corpus + doc updates: 4 new regression entries; `productvision.md` quota correction.
- All changes uncommitted in the working tree; full suite green (259 pass / 1 skipped), build clean.
