---
name: product-acceptance
description: Use when a product is approaching completion and needs testing as a finished thing rather than as code — chartered sessions that drive the real product, find promises it does not keep, and produce evidence matrices plus remediation issues. Also use to decide WHICH sessions to run now and which to defer until after a planned rework. Complements code review and gates; never replaces them.
title: 'Product acceptance (chartered session testing)'
doc_version: '1.1.0'
status: active
last_review: '2026-09-05'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal', 'kind/analysis', 'kind/process']
related: ['tabletop', 'verification', 'refutation', 'visual-verification', 'gold-audit', 'codebase-audit']
---

# Product acceptance (chartered session testing)

**Goal:** find what the product promises and does not keep, and what a person actually
experiences using it — the two things code review structurally cannot see, because it
reads what exists rather than what was expected.

**Relation to the existing skills.** This skill is the *planner and the debriefer*, not a
replacement for the walkers. The promises-versus-reality session **is** `tabletop`, run
per scenario. Verifying a serious finding before acting on it **is** `verification`, and
trying to kill it **is** `refutation`. Rendered-UI checks **are** `visual-verification`.
What this skill adds: which sessions to run, in what order, at which moment in the
product's life, and how their outputs become one reviewable body of evidence.

**Execution shape:** session-based test management (Bach & Bach, 2000) — *charter*,
*session*, *session sheet*, *debrief*. In an agent setting a session is one subagent lane,
the charter is its brief, the session sheet is a result matrix plus a findings file, and
the debrief is the orchestrator judging what lands.

---

## 1. Decide *when* before deciding *what*

A session run at the wrong moment wastes the finding, not just the time. Four tests, in
order.

### Shelf-life against the biggest pending change

Ask: *will a change already on the roadmap invalidate this finding?* Durability differs
sharply, and a planned rework is the usual invalidator:

| Session | Survives a rework of the surface? | Why |
|---|---|---|
| Promises vs reality (`tabletop`) | Yes | Wiring, not presentation |
| Journeys and flow | Mostly | Step order and dead ends outlive their skin |
| Semantics: names, roles, ordering, structure | Yes | Structure, not appearance |
| Contrast, focus visibility, spacing | No | Design decisions, by definition |
| Rendered-surface defects (clipping, overflow, wrapping) | No | Dies with the rework that caused it |
| Wording in context | No | Text moves; truncation changes |
| Scale and data realism | Yes | Pagination, empty states, degradation are structural |

Run the durable sessions before a rework; run the perishable ones **once, as a baseline**
— capture the state, do not open a fix list — so that afterwards you diff instead of
re-deriving.

**Order by the finding's lifetime, never by the technique that found it.** These are two
axes, and fusing them is the mistake this table invites. A rendering pass produces
perishable findings *and* durable ones: panels present in the DOM but starved to zero
height inside a viewport-locked shell; every list item in every embedded document
rendering blank because of one wrong capture group. Both survive any restyle. Both had
already passed adversarial code review and a battery of structural predicates, because
they are invisible in source by construction.

So the perishable-baseline rule applies to the **polish sweep** — contrast, spacing,
wording — not to the first pass that renders the thing at all. The photograph you diff
against is the *last* rendering pass before the rework, not the only one.

### Detectability

Before deferring a technique, ask: **is there any other technique that reaches this class
of finding at all?** If the answer is no, the perishability of the *other* findings that
technique also produces is not a reason to defer it.

Two measured cases, from different products. A keyboard-driving session found focus landing
on `<body>` when a modal closed — invisible with a mouse, a dead end from the keyboard, and
missed by the automated accessibility scan running beside it. A screenshot matrix found the
zero-height panel above; every DOM assertion stayed green, because `scrollHeight ===
clientHeight`. Neither is reachable by reading code. Neither dies with a restyle.

A technique with no substitute earns an early, cheap run for its durable half, whatever
else it also produces.

### Cost asymmetry

- **Wiring gaps** (a promised capability connected to nothing) are cheapest early. Near
  completion they stop being a fix and become a decision: connect it, or withdraw the
  promise. So run `tabletop` at every milestone, not at the end.
- **Verification breadth** (does every promise have a passing check on *this* build) is
  cheapest late, once the surface stops moving. Running it early just means running it
  twice.

### Yield decay

Run one lens until its yield per session drops — and watch *new categories* per session,
not raw counts. A lens producing only variants of what you already know is finished even
while its numbers look healthy. Switching lens beats squeezing the current one.

### Prerequisites

A session whose prerequisite is missing produces noise: driving sessions need a
**runnable product** (§3), scale sessions need **realistic volumes**, wording sessions
need **settled wording**, journey sessions need **datasets that represent real users,
including the awkward ones**.

A missing prerequisite does not always degrade loudly, and the quiet failure is the
dangerous one. A check that cannot see the data it is meant to reconcile does not report
uncertainty — it reports a **confident green over a false claim**, and nothing signals that
the question went unasked. So when a prerequisite is absent, the session says so in its
sheet; a pass it could not actually perform is `NOT COVERED`, never `OK`.

---

## 2. Session catalogue

One charter per session. Keep them file-disjoint so they run in parallel, and allow **at
most one session per round to write to the product** — the rest report. That single rule
removes merge conflicts and simplifies the debrief.

| Session | Charter | Instantiation for a CLI or API | Writes? |
|---|---|---|---|
| **Harness** | Make the product runnable with no external dependencies | Fixture projects + a sandbox working copy | Tooling only |
| **Promises** | Walk N scenarios end to end; find what the docs claim and the code does not do | `tabletop`, one scenario per session | No |
| **Journeys** | Drive the product as a person would; find dead ends, invisible next steps, unhelpful errors | Run the real commands in order; read the terminal as a newcomer would | No |
| **Semantics** | Structure a machine or an assistive tool must understand | Exit codes, `--help` completeness, machine-readable output, error taxonomy | Mechanical fixes |
| **Surface** | The rendered result across every context | Terminal width, colour off, non-TTY pipes, locale | Baseline only |
| **Scale and data** | Realistic volumes, old data, empty state | A large repository, a fresh one, a corrupt one | No |
| **Wording** | The text as delivered, per language and register | Help text, error strings, log lines | No |
| **Consolidation** | Merge matrices, dedupe against open issues, open remediation issues | — | No |

---

## 3. The harness is the unlocking prerequisite

Driving sessions are usually skipped because "we cannot run it here". Test that claim
before believing it. The questions that decide it:

1. **Can authentication or privileged setup be bypassed honestly?** Products often already
   support a mode that trusts an upstream proxy or a local identity, alongside the real
   one. That mode needs no identity server.
2. **Can dependencies be mocked from a contract you already have?** An API description
   gives the surface; the client's own validation schemas are the stricter authority on
   shape — a mock whose response fails client validation is a mock bug, and wiring that
   check in keeps the harness honest.
3. **Is the runtime already present?** Sandboxes frequently ship the browser or toolchain
   you assumed was missing; a pinned version mismatch is a config line, not a blocker.
4. **What does the product do before it does anything useful?** A bootstrap call on a
   hardcoded origin, or a config file it refuses to start without, is the usual last
   obstacle — solve it in the harness, not by editing the product.

Then test the opposite claim, because "we must build a harness" is just as often wrong.
Survey what exists first. A product with an integration or end-to-end suite usually already
has most of the parts — fixture projects, a runner that stages a throwaway copy and
executes the real commands, captured output. What is missing is typically not machinery but
a **mode**: an existing suite asserts against committed snapshots, so any deviation is a
failure, while a chartered session needs the inverse — run, capture stdout, exit code and
files written, report, assert nothing. That is a thin adapter over what you have, not a
second harness, and most codebases have a reuse rule that requires the survey anyway.

Build what is genuinely missing as **tooling in its own directory**, with its own server and
test configuration, never by editing the product's build files. Make every port and path
configurable by environment variable *before* launching parallel sessions; discovering a
collision afterwards costs a whole round.

Ship at least three datasets: **rich and specific** (a real-looking instance of the
central use case), **thin or ambiguous** (external data unavailable), and **empty** (first
run). Most interesting findings come from the last two.

State the harness's boundary in its README: which paths are proven, and which merely do
not crash. A harness that overstates coverage manufactures false confidence.

---

## 4. Charter template

A brief missing any of these produces a session that drifts:

- **Mission** — one or two sentences: what is tested, and what problems you are hunting.
- **Area** — the coverage label this session counts against, so "sessions per area"
  becomes a real coverage metric over time.
- **Boundary** — which paths this session may write to, and which belong to a session
  running in parallel.
- **Prerequisite check** — the session's first act is proving its environment works (run
  the existing smoke check) before writing anything of its own.
- **Method** — how to measure, not only what to look at. Prefer programmatic assertions
  (measured values, rule ids, status codes), then ask for the human judgement *as well*:
  "this screen is confusing" is a real finding no assertion produces.
- **Output contract** — matrix path, findings schema, where evidence goes, no binaries
  committed.
- **Honesty rules**, stated explicitly — what could not be covered and why; a clean result
  is a valid result; never report what you did not measure; distinguish a harness
  limitation from a product defect.
- **Cap** — how many fixes this session may apply before stopping and reporting the rest.

---

## 5. Session sheet

Two artefacts per session. The fields marked **(SBTM)** are the ones that make sessions
comparable and plannable rather than a pile of prose; do not drop them.

**Result matrix** — `<area>/<date>-matrix.md`: the session's dimensions crossed (scenario ×
step, route × context, table × operation) with one verdict per cell — `OK` / a short
defect code / `NOT COVERED` — then findings ranked by severity. The matrix makes coverage
and gaps visible at a glance; the ranked list is what gets acted on.

**Findings** — `<area>/findings.jsonl`, one object per finding:

```
id, session, area, subject, severity (P1|P2|P3),
claim_or_expectation, observed, user_impact (one plain sentence),
evidence (file:line, capture path, or measured numbers),
proposed_fix, applied (bool), duplicate_of (issue ref or null),
confidence (verified|unverified)
```

**Session metadata (SBTM)**, reported in the debrief:

- **Effort split** — share of the session spent on *finding* versus *investigating a
  single finding* versus *environment setup*. Setup consistently above a third means the
  harness is the problem, not the product; that is a fix to make once and recover every
  round afterwards.
- **Charter versus opportunity** — how much of the session followed the brief, and how
  much was unplanned exploration. Consistently high opportunity means charters are too
  narrow; consistently zero means they are too prescriptive and the session has stopped
  looking. Some of the best findings arrive as opportunity — mark them, do not suppress
  them.
- **Obstacles and outlook** — what blocked the session, and what remains uncovered in this
  area. These convert directly into the next round's scope.
- **Confidence** — where the session is unsure. An honest "unverified" is worth more than
  a confident guess, and tells the debriefer exactly what to check first.

---

## 6. Debrief

The debrief is the orchestrator's work and where most value is added or lost.

1. **Verify the serious findings yourself** before acting — use `verification`, and
   `refutation` when a claim is strong. A session reporting a security or privacy defect
   is a hypothesis until someone reads the code. This catches both false alarms and, more
   often, a correct finding the session then mis-scoped.
2. **Split by decision-maker.** Anything that changes what the product *promises* is the
   owner's call: it becomes an issue with options, never a silent patch. Anything plainly
   defective against an existing promise is fixed now.
3. **Dedupe against open issues** before filing; carry `duplicate_of` in the findings.
4. **Fix in a dedicated session**, not in the measuring ones. Measuring sessions stay
   read-only so they can run in parallel; one remediation session afterwards applies fixes
   without conflicts.
5. **Record the clean results.** A scenario that came out clean, with its evidence, is what
   makes the next scope decision possible.

---

## 7. Cadence

- **Continuously**, on changed areas: code review and gates. Their yield does not decay
  while code is being written.
- **Every milestone**: one `tabletop`. Wiring gaps found here are still fixable.
- **Before a planned rework**: the durable sessions, plus one baseline of the perishable
  ones.
- **After the rework**: the perishable sessions again, as a diff against that baseline.
- **Release candidate**: every session against the exact build being shipped, plus the
  promise-to-check mapping. Breadth matters more than depth at this one moment, and the
  checks must have passed on *that* build, not an earlier one.

---

## 8. Failure modes seen in practice

- **Starting the programme before showing it.** Even under a mandate to decide, the owner
  needs a moment to redirect. Present the plan, then start.
- **Parallel sessions writing the same files.** One writer per round.
- **Port or path collisions** between parallel harness sessions. Parameterise first.
- **Ordinal collisions** in append-only sequences (migrations, numbered steps) between a
  long-lived integration branch and a branch stacked on it. Fix the rule once — the
  integration branch stays contiguous, the stacked branch takes the next free slot — and
  re-check it on every merge, because it recurs.
- **Accepting a baseline instead of zero.** When a session proposes recording dozens of
  known violations rather than fixing them, send it back. Baselines that grow stop being
  gates.
- **Treating perishable findings as a fix list.** See §1.
- **Waiting on a background monitor.** A session that parks itself waiting for a
  notification that never arrives is stalled, not working: brief it to run verification
  synchronously and report immediately.

---

## Sources

Session-based test management, the charter/session/sheet/debrief structure, the effort
split and the charter-versus-opportunity metric:
[Session-based testing](https://en.wikipedia.org/wiki/Session-based_testing),
[An Exploratory Tester's Notebook — Bolton](https://www.developsense.com/presentations/2007-10-PNSQC-AnExploratoryTestersNotebook.pdf).
Release-readiness criteria and the exact-build rule:
[Release Readiness Review](https://devsecopsschool.com/blog/release-readiness-review/),
[QA release-readiness practices](https://www.frugaltesting.com/blog/best-practices-for-qa-release-readiness-a-complete-pre-launch-testing-guide).
