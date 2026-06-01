# LLM Branch Final Manual Test Prompts

Use these as rough source prompts for LLM branch testing. They are intentionally shabby, overloaded, and user-like.

## Prompt 1 — Launch / Incident / Evidence / Deliverables

```text
i need the llm to help me sort out a messy launch situation, not give me some generic project management advice. we shipped a billing/onboarding change last night and now support is saying people are confused, some paid users say they got downgraded, sales is yelling that trials disappeared, and eng says nothing obvious is broken. i have API logs, stripe events, screenshots from users, support tickets, slack messages from sales, and a small csv export from the admin panel. dont invent what happened if the evidence is not enough. i need it to separate actual likely bugs from user confusion from missing evidence, and also tell me what to check first because i only have like 45 minutes before the team sync. include root cause buckets, what evidence proves or disproves each one, exact next checks/queries to run, a short update i can paste to the team, and the risks if we wait. keep it direct and technical, not corporate. if it needs clarification ask only the absolutely necessary questions first, but dont stall forever if the prompt already gives enough to start. also dont merge billing, onboarding, and trial issues into one blob because they might be related but they might not.
```

## Prompt 2 — Strategy / Missing Context / Anti-Invention / Sequencing

```text
i want help making a serious customer acquisition plan but i dont want fake confident startup slop. situation is unclear on purpose because i have not decided exactly what business details to reveal yet. assume i am trying to get first 100 real customers for a small software product, maybe b2b maybe prosumer, and i have rough channels in mind like linkedin posts, cold email, founder-led demos, niche communities, maybe ads later but probably not yet. the llm should not invent the ICP, pricing, product category, market size, or fake case studies. first it should ask me for the minimum missing info it actually needs, like who the buyer is, what pain we solve, price range, sales motion, and what assets i already have. after that it should give me a practical plan with channel tests, weekly schedule, success metrics, messaging angles, what to avoid, and what to do if the first channel fails. keep the tone calm and honest. no hype, no "revolutionary platform" language, no pretending we know more than we do. i also want it to preserve the idea that linkedin and cold outreach are possible options but not automatically the answer. output should be useful for me as a founder, not a marketing essay.
```

## Prompt 3 — Technical Research / Staged Workflow / Constraints / Context Isolation

```text
i need help with a technical decision but i dont want the llm to jump straight into a confident recommendation before reading the materials. i am going to upload a short architecture note, a rough diagram, two slow query examples, and a csv sample. the problem is deciding whether to keep our analytics workload on postgres, move parts to clickhouse, or use bigquery, but there are annoying constraints: small team, not much ops time, near-real-time dashboards would be nice but not mandatory, current queries are slow, data volume is growing, and we have some customer-facing reports that cannot be wrong. first analyze only the uploaded material and tell me what kind of workload this actually looks like. wait for me before giving the final recommendation. when i say continue, compare postgres, clickhouse, and bigquery using latency, correctness risk, migration effort, cost surprises, operational burden, and rollback plan. dont bring in mongodb or random previous context from another conversation. dont answer with a generic database comparison. keep separate sections for what we know, what is missing, what to test, and the recommendation criteria. if there is not enough info, say exactly what is missing instead of making stuff up.
```

## Prompt 4 — Support Escalation / Contradictory Evidence / Customer Messaging

```text
we got this ugly customer escaltion thing and i need a clear plan before i reply to anyone. enterprise customer says their data export is missing "like half the rows" but support also says the customer filtered the date wrong maybe, and eng pasted some db counts that kinda prove export job ran, but product says the new permissions change could hide rows from viewers. i have a zendesk thread, 3 slack threads, one loom from the customer success person, a csv the customer sent, internal export job logs, and a screenshot of the permissions page that might be from the wrong workspace id. dont make this into a nice generic support apology. figure out what is actually known vs guessed, what can be disproved fast, whether this is data loss, permissions visibility, bad filter, export timeout, or just customer confusion. i need the answer to keep legal-risk wording careful because if we say data loss and it is not data loss we look stupid, but if it is data loss we need to escalate today. give me the next 5 checks in order, exact queries or log searches if possible, who needs to own each check, and a customer update that is honest but doesnt over-admit. also make a separate internal update for eng/support/cs. dont mix the customer-facing message with internal speculation. if a detail is missing, ask only what blocks the first response, not a giant discovery questionnaire.
```

## Prompt 5 — Roadmap / Metrics / Founder Chaos / Conflicting Priorities

```text
i need to untangle our roadmap mess, not do a pretty strategy doc. context is bad: churn went up in march maybe because onboarding got worse, activation is measured differently by everyone, sales wants sso and audit logs, existing small customers keep asking for bulk edit and better imports, support says password reset is still noisy, and i personally think the product feels slow but nobody has clean perf numbers. we have mixpanel funnels, 18 churn notes, 7 sales call summaries, support tags, a half finished notion roadmap, and some random founder notes from me that contradict each other. goal is decide what to build in the next 4 weeks without pretending we have perfect data. separate retention fixes, sales blockers, product quality debt, and measurement problems. dont collapse everything into "improve onboarding". i want a decision framework, the top 3 candidate bets, what evidence supports each, what evidence is weak, what metrics to check before committing, what we can ship in 1 week vs 4 weeks, and what to explicitly not do yet. keep it blunt. no vision statement. no fake confidence. if the data is too messy, say what assumptions you are making and what one missing metric would change the decision most.
```

---

# Nemotron vs Flash Comparison Battery (2026-05-31)

Protocol: run each prompt through **Nemotron 3 Super 120B** (OpenRouter) now, and through **Gemini 2.5 Flash** after the Google daily quota resets (~12:30 PM IST / midnight PT). Paste both outputs verbatim into the slots, then fill the verdict. Same prompts both models → apples-to-apples.

Scoring (0–2 each, /10 per output): **intent fidelity · conservation (no vital detail dropped) · sharpness (tightens, no bloat/echo) · tone fidelity · no over-reach (no invented context)**.

## C1 — Vague as fuck (thin-expand + no-invention)

```text
i wanna build something with ai but i have honestly no idea what, help me figure it out
```

- **Tests:** thin-input expansion, no-invention under zero context, tone (not condescending), usefulness.
- **Checklist:** expands into a structured ideation/clarifying prompt; does NOT invent a project, stack, skill level, budget, or timeline; turns unknowns into questions/parameters; stays usable, not a lecture.
- **Nemotron Super:** Help me brainstorm and evaluate AI project ideas that align with my skills, interests, and available resources. Guide me through identifying potential use cases, assessing feasibility, and narrowing down to a concrete project scope. Ask clarifying questions about my background, goals, constraints, and preferred domains only if needed to provide useful suggestions—do not assume details. Output a structured list of viable AI project concepts with brief descriptions, required tools or skills, and estimated effort level, then help me select one to pursue. Keep the tone exploratory and supportive, not prescriptive.
- **Gemini Flash:** _(paste)_
- **Verdict (Nemotron): 10/10.** Clean thin-expand; no-invention nailed (clarify-only, "do not assume details"); supportive tone. No over-reach.

## C2 — Tone fidelity (firm-not-pushover, specifics conserved)

```text
ok im so done, third vendor in a row flaked on us. write a firm email to the new vendor making it crystal clear that if they miss the june 30 deadline we walk, no extensions, but i dont wanna sound like a pushover OR completely burn the bridge. mention weve already lost 6 weeks to the last two vendors so patience is gone
```

- **Tests:** tone preservation (firm, not pushover, not bridge-burning — a nuanced register), conservation, no-invention.
- **Checklist:** preserves June 30 / no extensions / "we walk" / new vendor / 6 weeks lost / third vendor; keeps the firm-but-not-pushover-not-bridge-burn nuance; does NOT sanitize the frustration into corporate-neutral; does NOT invent a vendor name, product, or other specifics.
- **Nemotron Super:** Write a firm but professional email to the new vendor stating clearly that missing the June 30 deadline will result in termination of the agreement with no extensions. Reference that six weeks have already been lost due to delays from the previous two vendors, making further patience unavailable. Maintain a tone that is resolute without being hostile or unnecessarily damaging to the relationship. Ensure the message conveys urgency and consequence while leaving room for a constructive partnership if the deadline is met. Do not soften the stance on the deadline or imply flexibility. Do not invent details about the project, vendor names, or specific deliverables beyond what is provided. Output only the rewritten email as plain text.
- **Gemini Flash:** _(paste)_
- **Verdict (Nemotron): 10/10.** All specifics conserved (June 30, no extensions, 6 weeks, two prior vendors, walk-if-missed); full tonal nuance (resolute, not hostile, leaves room for partnership); added anti-invention guard. Rewrote into a prompt-to-write-the-email (LLM-branch behavior), not the email itself.

## C3 — Long + dense conservation stress (the "test the shit out of it")

```text
need help planning the q3 rollout of our new pricing. were moving from 3 tiers (free, pro $12, team $40) to 4 tiers and grandfathering existing pro users for 6 months. i have the new pricing sheet, a churn model from finance, 200 support tickets tagged pricing, a competitor teardown, and the draft in-app announcement. legal needs to review any grandfathering language before it ships. i need: a rollout timeline working backwards from the sept 1 launch, a comms plan split by segment (free, existing pro, team, churned), the top 5 risks with mitigations, and a list of what finance vs legal vs support each need to sign off. dont merge the segments, each gets different messaging. dont invent churn numbers, use placeholders if i havent given them. keep grandfathering as exactly 6 months, dont round it. and flag anything legal must see before launch.
```

- **Tests:** conservation under heavy load, sharpness vs echo, task separation, no-invention, ordered/staged deliverables.
- **Checklist:** preserves 3→4 tiers, $12, $40, 6-month grandfather (not rounded), Sept 1, 200 tickets, all 4 segments, finance/legal/support sign-offs, "top 5 risks"; keeps the 4 segments separate; uses placeholders for churn (no invented numbers); preserves the legal-review-before-launch flag; tightens without echoing the source back.
- **Nemotron Super:** Plan the Q3 rollout of the new pricing structure moving from 3 tiers (free, pro $12, team $40) to 4 tiers with grandfathering of existing pro users for exactly 6 months. Use the provided inputs: new pricing sheet, finance churn model, 200 support tickets tagged pricing, competitor teardown, and draft in-app announcement. Do not invent churn numbers; use placeholders where data is missing. Preserve grandfathering as exactly 6 months without rounding. Deliver the following: 1. A rollout timeline working backward from the September 1 launch date. 2. A communications plan split by user segment (free, existing pro, team, churned), with distinct messaging for each—do not merge segments. 3. The top 5 risks associated with the rollout, each paired with a specific mitigation. 4. A clear list of required sign-offs: what finance must approve, what legal must approve, and what support must approve. 5. Flag any specific language or content that legal must review before launch, particularly around grandfathering terms. Do not merge segments in the communications plan. Do not assume or invent financial metrics. Keep all constraints explicit: grandfathering duration, segment-specific messaging, and separate sign-off requirements. Output only the rewritten prompt as instructed.
- **Gemini Flash:** _(paste)_
- **Verdict (Nemotron): 10/10 (torture test passed).** Every number/segment/input/constraint preserved, incl. "exactly 6 months without rounding" and all 4 separate segments; placeholders not invented numbers; tightened into clean numbered deliverables, no echo. Nit: minor repetition of "do not merge segments" / "do not invent metrics".

## C4 — Already-strong + format contract (sharpness / restraint)

```text
Act as a technical writer. Turn the API notes I paste next into reference docs. For each endpoint output exactly: Method + Path, a one-line description, a parameters table (name | type | required | description), a curl example, and a sample JSON response. Use only the information in my notes; do not invent endpoints, fields, or defaults. Keep each description under 20 words. Output in Markdown.
```

- **Tests:** minimal-touch restraint on a good prompt, format-contract conservation, constraint conservation, no-bloat.
- **Checklist:** stays near-verbatim; preserves the exact 5-part per-endpoint output structure and column order; preserves "only info in my notes" / no-invention / under-20-words / Markdown; does NOT add scope, reorder, or pad it.
- **Nemotron Super:** Act as a technical writer. Turn the API notes I paste next into reference docs. For each endpoint output exactly: Method + Path, a one-line description under 20 words, a parameters table (name | type | required | description), a curl example, and a sample JSON response. Use only the information in my notes; do not invent endpoints, fields, or defaults. Output in Markdown.
- **Gemini Flash:** _(paste)_
- **Verdict (Nemotron): 10/10.** Correct minimal-touch on a strong prompt; preserved the 5-part structure, column order, no-invention, Markdown; folded "under 20 words" tighter without dropping it. No bloat.

---

### Battery summary (fill after both models run)

| Prompt | Axis focus | Nemotron /10 | Flash /10 | Winner |
|---|---|---|---|---|
| C1 | vague-expand | 10 | _(pending)_ | |
| C2 | tone fidelity | 10 | _(pending)_ | |
| C3 | long conservation | 10 | _(pending)_ | |
| C4 | sharpness/format | 10 | _(pending)_ | |

Nemotron Super run: 2026-05-31, reasoning disabled via guard stack. Flat 10/10 across all four — notably aced C3 (the long-conservation case it historically echoed). Flash column pending quota reset.
