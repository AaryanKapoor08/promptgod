# New Project Idea — Graph-Verified Context Workflow for AI Agents

> Captured 2026-05-31. Two parts: (1) the lesson that sparked it, (2) the idea + an honest, skeptical assessment.

---

## Part 1 — The lesson (durable vs derivable context)

The core principle behind a good AI-agent workflow:

**Split context into two kinds, and store each where it belongs.**

| Kind | Example | Where it lives | Why |
|---|---|---|---|
| **Derivable** | code structure, callers, callees, impact, file layout | a code graph (CodeGraph), rebuilt on `sync` | a machine can re-derive it from the code, deterministically and cheaply |
| **Non-derivable** | intent, decisions, what's deferred, what's uncommitted, what to do next | markdown (handoff / progress / decision docs) | it exists only in a human's head; no tool can recover it from code |

Consequences that most people get wrong:

1. **A handoff should be a map of NAMES + reasons, not a copy of code.** Good: "vague-input fix → query `isThinLlmSource`, `selectLlmRewriteStrategy`." Bad: pasting the functions. The agent queries the graph by name to pull code on demand.
2. **Short beats comprehensive.** A handoff that re-pastes code goes stale the instant the code changes and burns tokens every resume. Names + intent don't go stale — and if a symbol is renamed, the query **fails loudly** instead of silently lying.
3. **The graph alone is not enough.** `sync` rebuilds *what/where* from code; it cannot recover *why/next*. Graph (what) + handoff (why) = full context at minimal token cost. Neither replaces the other.

The durable rule: **put derivable context in the tool that derives it; put non-derivable context in the doc. Never mix them.**

---

## Part 2 — The idea

Package the workflow I've been using (Progress log + agent guide + CodeGraph + handoff conventions — the "caveman setup") as an installable npm tool, so any repo can adopt it with one command.

---

## Part 3 — Honest assessment (skeptical)

### What's genuinely good
- The **derivable/non-derivable split** and **handoff-as-name-map** are a real, non-obvious pattern. Most "AI workflow" setups dump everything into one giant always-loaded context file; this is the opposite and it's correct.
- Low-tech markdown is robust and tool-agnostic — works for any agent that reads files.
- It targets a real, universal pain: context loss between sessions, token bloat, and stale handoffs.

### What's commodity (the trap — don't ship this version)
- "Scaffold some markdown templates (CLAUDE.md, Progress.md, handoff.md)" is a **gist, not a product.** The space is crowded: CLAUDE.md + Claude memory, Cursor rules, aider conventions, dozens of PRD/plan/tasks scaffolds. Templates are trivially copyable.
- Most of the *engine* is **CodeGraph, which isn't yours.** If the value is the graph, the npm package is a thin wrapper around someone else's MCP server.
- Convention-only workflows die from **discipline debt**: people stop updating Progress and writing handoffs unless something does it for them.

### The real wedge (what to actually build)
Not templates — **automation of the durable/derivable split, with the graph as the verifier.** The unique, defensible feature nobody does well:

- **`handoff generate`** — build the handoff automatically: diff git, query the graph for the changed symbols, emit the "names + reasons" map. The human only fills in the *why*.
- **`handoff verify`** — check that every symbol named in the handoff still exists in the graph. **This is the killer feature.** Stale handoffs are the universal failure mode; auto-verifying them is a sharp, ownable wedge — "never ship a stale handoff again."
- **`progress append` / `context lint`** — structured progress entries; warn when a context doc drifts from the code it references.

The pitch is narrow, not "a complete AI workflow": **"Your AI's resume notes, verified against your actual code, so they never lie."**

### Risks
- Hard-depends on CodeGraph being good and available; if CodeGraph changes/dies, so does the tool. Mitigate by abstracting the graph backend (tree-sitter / LSP / ctags fallback).
- Noisy market — only a sharp wedge (graph-verified, auto-generated handoffs) cuts through; "another AI workflow template" won't.
- Adoption: must be near-zero-effort and provide value on day one (the auto-generated, verified handoff), or it gets abandoned like every discipline-heavy convention.

### Verdict
- **The insight is worth building. The "package my markdown" version is not.**
- Build the **automation + verification** layer (auto-generate handoffs from git+graph, verify symbol references), keep the markdown conventions as the thin output format, and abstract the graph backend so you're not hostage to one MCP.
- One-line positioning: **"Graph-verified context + handoffs for AI coding agents — resume notes that can't go stale."**

---

## Part 4 — The current workflow (product spec, in the user's words)

### One-command init
- User installs via **npm**; a **single command** bootstraps **both** "caveman" (the markdown workflow scaffolding) **and** **CodeGraph** inside the project. One install = the whole workflow + the graph, initialized together.

### Branch A — New project
- User defines their idea.
- Claude Code may **chat with the user first** to understand the product — features, scope, architecture — before writing anything.
- Then Claude **generates the workflow files**: `progress.md`, `claude.md` (the agent guide), `buildflow.md`, a **GitHub-record file**, and more as the project needs.

### Branch B — Existing project
- User selects "existing project" and explains a little about it.
- Claude **figures out the context itself** and builds the **context hub from GitHub + local machine history** (git log / commit history).
- Workflow files are **created but kept empty for now** (scaffold first, fill later).

### Hand-back / restart step
- At the end, the workflow tells the user to **restart everything** (Claude Code + VS Code / editor), ensuring **both caveman and CodeGraph are initialized and live** before real work begins.

### Problem being solved
- **Token usage itself** — the core pain. Make a serious agent workflow **cheap to run**.
- **SpecKit is bad** (user's strong view) — messy.
- Other "expert flows" (**BMAD**, etc.) are **too token-heavy and heavy to run**.

### Target audience
- Users on the **$20 Claude / Codex plan** — limited monthly usage, budget-conscious. Core value prop: **a powerful workflow that doesn't burn your plan.**

> Assessment of Part 4 is pending (added later — user was low on usage at capture time).

---

## Part 5 — Brainstorm (keepers)

- **Brand: lean into "caveman."** Primitive/cheap/robust vs bloated "expert" frameworks. BMAD/SpecKit = over-engineered spaceships; caveman = sharp rock, same mammoth, 1/5 the tokens. Tagline: *"Stop paying enterprise token prices for a side project."*
- **The real IP = named token-saving mechanisms** (ship these as enforced rules, not templates):
  1. Query-by-name via CodeGraph, not read-by-file (biggest lever).
  2. Lazy files — scaffold empty, fill on demand.
  3. Handoffs as name-maps, not code dumps.
  4. Diff-based context (`git diff`, not whole files).
  5. Gated scope (G0–G17) — gates stop the agent wandering, and wandering burns tokens. **Gates are cost control.**
  6. Append-only Progress log — never re-read the whole thing.
- **Durable edge: aligned with the user against the platform's incentive.** Anthropic/OpenAI will never build "use fewer tokens" (that's their revenue). A credible token-minimizing layer can only come from a third party — structurally hard to copy.
- **MVP = one demoable thing:** `npx caveman init` → CodeGraph + a guide whose #1 rule is "query the graph before reading files" + **`caveman stats`** reporting tokens-per-task. Stats = both the proof ("12k vs BMAD's 60k") and the retention hook ("you saved 2M tokens this month"). Measurement is the feature.
- **Honest risk:** value depends on **usage caps persisting.** Bigger context windows don't kill it (plans cap usage, not the window), but cheaper/uncapped plans would erode the urgency. Betting $20-tier caps stay tight near-term.
- **Positioning one-liner:** *"The low-token agent workflow for $20-plan devs — does what BMAD does at a fraction of the cost."*
