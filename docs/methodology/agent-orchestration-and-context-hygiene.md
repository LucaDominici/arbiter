---
title: 'Agent Orchestration and Context Hygiene — Operating Standard'
doc_version: '1.0.0'
status: active
last_review: '2026-08-16'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'audience/agent', 'kind/governance']
related:
  [
    'docs/CONCEPTS.md',
    'docs/design/anti-context-rot-enforcers.md',
    'docs/REFERENCE/wave-drain.md',
    'docs/internal/ADR/054-phase-3-5-handoff-modeled-as-status-json-fields.md',
    '103-worktree-parallel-carveout',
  ]
---

# Agent Orchestration and Context Hygiene — Operating Standard

**Scope:** how WE run coding agents — on every repo, not only arbiter. Arbiter is the
carrier: it applies the standard to itself (self-governance) and propagates it into every
governed project (scaffolded gates, hooks, skills, templates). This document is the METHOD;
the appendix maps every measure to the arbiter mechanism that enforces it today or must be
built next.

**Status of this document:** normative. Where a measure has no enforcer yet, that is
declared as **TO-CREATE** debt with a target mechanism — never left as silent prose.

---

## 0. Doctrine (why every measure must be code)

Four axioms, already operative in arbiter, govern everything below:

1. **Beyoncé rule** — a rule without an automated check does not exist. Prose decays;
   only gates persist. (Applied to arbiter's own CANON via the §T4 dogfood-closure
   tranche, `docs/design/anti-context-rot-enforcers.md`: prose-only rules are
   promoted to machine gates or deleted.)
2. **Paved road / pit of success** — the correct way must be the pre-built default. A
   measure that requires remembering is already failing.
3. **Normalization of deviance** — an unenforced or routinely-bypassed rule trains
   everyone to ignore all rules. The bypass-log is the confession
   (305 bypasses of one gate = not a gate).
4. **IRON LAW of proof** — nothing is done until it is **WIRED** (invoked, `file:line`),
   **TESTED** (a red-path/flip test proves it BLOCKS, not only passes) and **WORKING**
   (dogfooded on real input). (`docs/design/anti-context-rot-enforcers.md` §0 — every
   enforcer names its wiring `file:line`, its red-path proof, and its dogfood split.)

Corollary for this standard: each measure below carries an **Enforcement** row. Legend:

| Level    | Meaning                                                                   |
| -------- | ------------------------------------------------------------------------- |
| **HARD** | hook/gate blocks the violation mechanically                               |
| **SOFT** | advisory check or structural default; promotion to HARD is dated debt     |
| **DOC**  | prose only — by axiom 1 this is a defect, listed with its target enforcer |

And a **Self / Governed** row: what arbiter does _for itself_ vs what it _generates and
enforces_ in governed projects. The two sides must converge (CANON-14: self-config ⊇
template at equal governance level; `scripts/check-self-dogfood.mjs`).

---

## 1. Threat model: context rot and drift

The failure modes this standard exists to kill — each observed for real, not hypothesized:

| #   | Failure mode                                                                                                                             | Real incident                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **Volatile-context loss** — findings/decisions live only in the model's window; compaction or `/clear` destroys them                     | Mid-task compactions losing multi-phase state (countered by the 3-layer protocol in `.claude/skills/context-rot-management/SKILL.md`) |
| R2  | **Fake green / unverified claims** — agent reports success without exercising the change                                                 | Majority of observed real agent errors (5 of 8) were success claims never exercised (`AGENTS.md` §Verification-Before-Victory)        |
| R3  | **Shared-tree parallel corruption** — concurrent agents editing one working tree corrupt index/lockfiles/diffs                           | Real incident 2026-03-01: parallel agents without worktrees produced accidental edits on `main`; codified as Iron Law in `AGENTS.md`  |
| R4  | **False structural claims** — an agent asserts an architectural fact from vibes, not code                                                | Real false alarm: "hexagonal architecture is fiction" refuted by cross-checking 113 ArchUnit rules in the actual codebase             |
| R5  | **Context pollution** — research dumps (file listings, greps, long reads) rot the orchestrator's window and degrade every later judgment | Structural; the reason read-only sub-agents exist (`.claude/agents/codebase-scanner.md`)                                              |
| R6  | **Ceremony drift** — gates bypassed until the bypass is the process                                                                      | 332 logged bypasses, 305 on one gate                                                                                                  |
| R7  | **Expensive-model burn** — top-tier models spent on mechanical execution                                                                 | #1817 gold-rebaseline pattern A8: ~90% of implementation belongs on a cheap model executing a worked-out plan                         |

---

## 2. The measures

### M1 — Model pyramid: deterministic task-class → model routing

**What.** Every unit of work is classified before dispatch and routed to the cheapest
model tier that can own it:

| Tier           | Model class                 | Owns                                                                                      |
| -------------- | --------------------------- | ----------------------------------------------------------------------------------------- |
| Judgment       | **Fable** (top reasoning)   | design, architecture decisions, plan review, verdicts, brainstorming, keep-or-kill triage |
| Verification   | **Opus** (strong reasoning) | red-team, adversarial verify, dogfood, safety re-grep before destructive ops              |
| Implementation | **Sonnet**                  | mechanical-plus coding: implement a reviewed plan, wiring, migrations, guarded deletion   |
| Mechanical     | **Haiku**                   | checklist leaf work: pattern search, leaf-file deletion, link sweeps, formatting          |

Routing is **deterministic by declaration**, not by runtime machinery: the task's model
tier is written into the plan/handoff (`src/templates/HANDOFF.template.md` "Suggested
tier" per task) and the tier table of the enforcer design driving the work
(`docs/design/anti-context-rot-enforcers.md` §0). Per-agent model assignments live in
`.claude/AGENT_REGISTRY.md` (model + effort + cost rationale per sub-agent) and the
tier→review-vertical floor in `.claude/agent-dispatch-matrix.json`.

**Rule of thumb (Iron Law, `AGENTS.md` §Model-Pyramid):** if the expensive model spends
its turn executing rather than judging, the _plan_ handed to it was the defect — fix the
task spec, not the model tier. Arbiter deliberately does **not** select or gate on model
tier at runtime (that machinery is deprecated and stays deprecated); enforcement is on
the _declarations_ and their parity, not on a runtime selector.

**Why.** Kills R7 (token burn) and reduces R5: cheap short-lived executors read only
their task slice; the expensive model's window stays reserved for judgment.

**Enforcement.** HARD on declaration parity: `scripts/check-agent-dispatch.mjs` asserts
the declared dispatch matrix matches the compiled derivation in
`src/commands/task-ship.ts::verticalsForTier` (the "dispatch oracle", jewel J2).
SOFT on the pyramid itself: registry + handoff-template defaults (paved road).
TO-CREATE: a handoff-lint that flags a handoff doc whose tasks carry no tier suggestion.

**Self / Governed.** Self: registry, matrix, playbook legends. Governed: arbiter
scaffolds the agents + registry conventions (`src/generators/skills.ts`,
`src/templates/claude/agents/*.ejs`) and the HANDOFF template.

**Tier.** All tiers. Solo gets the same pyramid — it is a cost rule, not a team rule.

---

### M2 — Short-lived agents, one task per session

**What.** An agent session owns exactly one task and dies after its verdict/deliverable.
No agent accumulates state across tasks; continuity lives in files (M4), never in a
long-running session. Orchestrators direct; they do not implement
(`.claude/skills/wave-drain/SKILL.md`: "the orchestrator directs parallel agents — it
never implements"). Corollary (#2098): before dispatching a fresh agent whose purpose is
relaying new information into another agent's in-progress task, check the live-agent
roster first — a live agent plus new information is resumed via message, not relayed to
via a cold-start agent. Corollary 2 (#2098): under concurrency, an unscoped identifier is
not a signal — a `pgrep -f <command>` liveness check can match a _different_ concurrent
agent's identical process, and a generic output-redirect path (e.g. `gate-run1.log`) can
collide with another agent's identical choice and read back a corrupted interleave.
Always track the specific spawned PID and give every redirect target something
invocation-unique (PID, worktree name, or timestamp+random suffix).

**Why.** Long sessions are where rot compounds (R1, R5). A short-lived agent's context
is by construction fresh, scoped, and disposable.

**Enforcement.** SOFT: session discipline is structural in `/ship` (each phase's work is
dispatched, the phase machine holds state) and in wave-drain (one agent per group per
worktree, closed at harvest). HARD at the boundary: the phase machine
(`arbiter task advance`) refuses to move on red, so a dead agent's unfinished work
cannot silently pass to the next. TO-CREATE: a dispatch-manifest check that an agent
prompt references exactly one task id.

**Self / Governed.** Both — the `/ship` + wave-drain machinery is scaffolded to targets.

**Tier.** All.

---

### M3 — Mesocycle handover: context reset between phases, state carried by file

**What.** The task lifecycle (plan → red → green → verify → ship) is cut into
_mesocycles_. At each phase boundary the context is reset (`/clear` or fresh sub-agent)
and the next phase starts **cold** from a handover artifact, never from residual window
content. The handover contract:

- **Handoff doc** — `src/templates/HANDOFF.template.md`: written for "a COLD model with
  zero prior context", every task with its own AC + exact verification command + tier.
- **Phase state** — `status.json` fields (`handoffStrategy`, `planningHandoffReady`,
  `postClearResumed`), not a new phase enum (ADR-054); resumed via
  `arbiter ship #NNN --advance --post-clear`.
- **Clear strategy** — computed, not vibed: `src/commands/task.ts::decideClearStrategy`
  (≤10 units inline, ≤20 sub-agent, else stop-and-/clear) and
  `::buildHandoffBanner` prints the exact resume command (jewel J4).
- **Compaction resilience** — `.claude/hooks/pre-compact.mjs` persists context before
  auto-compaction and re-grounds the model (branch/task/phase) after it; the 3-layer
  durable-redundancy protocol (BACKLOG file + task cursor + phase-boundary git commits)
  in `.claude/skills/context-rot-management/SKILL.md` makes context loss a non-event.

**Why.** Directly kills R1. A phase that can only be resumed from a file is a phase
whose state is, by construction, persisted (feeds M4).

**Enforcement.** HARD: the handoff gate throws on the `red-team-review → red` transition
until the handoff fields are satisfied (`checkHandoffGate`, `src/commands/task.ts`);
`Stop` hook blocks completion claims regardless (M11). SOFT: banner + skill protocol.

**Self / Governed.** Both. The hooks, skill, and task engine are emitted to targets
(`src/generators/claude.ts`, `src/generators/skills.ts`).

**Tier.** Handoff file + `/clear` discipline: all tiers. The full 3-layer protocol
activates only for Standard-tier tasks with >5 units (right-sized by its own skill).

> Transitional note: the §T2.B tranche (playbook context now carried by
> `docs/design/anti-context-rot-enforcers.md`) cuts the `arbiter mark` cursor
> _command_ (danger cluster D2). The cursor survives as `status.json` fields (INV-113,
> ADR-054); skills referencing `arbiter mark` must be repointed when T2 lands.

---

### M4 — Persist everything to file: findings, decisions, evidence — never context-only

**What.** Anything an agent finds or decides is written to a durable, append-friendly
artifact **at the moment of discovery**, not summarized at session end:

| Artifact class        | Canonical home                                                                           | Mechanism                                                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Incidental findings   | `.arbiter/findings/` JSONL spool                                                         | `arbiter note` → `src/commands/task-note.ts::FindingEntry` (ts, kind, severity, file:line, sha, fingerprint; parallel-safe shards) |
| Decisions             | `docs/internal/ADR/`                                                                     | INV-107 (unique numbers, index in sync, `scripts/check-adr-index.mjs`)                                                             |
| Evidence per phase    | `.arbiter/evidence/<task>/…` (`tdd/`, `plan-review/`, `redteam/`, `review/`, `dogfood/`) | INV-90 schema (`schemas/evidence-bundle.schema.json`, `scripts/check-evidence-bundle.mjs`); INV-27 evidence for all gate runs      |
| Task state            | `.claude/.task/status.json` + append-only log                                            | INV-113 single authoritative phase doc (`scripts/check-phase-doc-consistency.mjs`)                                                 |
| Plan                  | `.claude/plans/*.md`                                                                     | plan anchor required before edit (CANON-16, `.claude/hooks/pre-edit-plan-anchor.mjs`)                                              |
| Suppressions/bypasses | commit footers + `.arbiter/evidence/bypass-log.jsonl` (append-only)                      | `scripts/check-commit-footer-rationale.mjs` (INV-119)                                                                              |

Findings never rot in the spool: wave-drain Phase 0.5 **harvests** the spool into
tracked issues before composing each wave ("the backlog is the queue, not the
graveyard" — `.claude/CLAUDE.md` Iron Law).

**Why.** Kills R1 at the root: the context window becomes a cache, never the source of
truth. Also enables M11–M13 (you cannot verify, refute, or audit what was never
written down).

**Enforcement.** HARD: INV-114 Stop gate (a completion claim without correlated evidence
on disk is blocked — see M11); INV-90 schema check; INV-113 consistency; INV-107 ADR
index. SOFT: the spool-harvest step. TO-CREATE: a "finding-loss" check — a session that
dispatched research agents but wrote zero notes/evidence gets flagged.

**Self / Governed.** Both; the whole family is dual-tracked (self-gate + emitted).

**Tier.** All. The evidence _schema_ depth scales with governance level (L2+ evidence,
L4 full harness).

---

### M5 — SSOT-first: truth lives in canonical files; memory is non-authoritative

**What.** A fixed authority hierarchy (`AGENTS.md` §Authority Hierarchy: AGENTS.md →
ADRs → CANON → active plan → AI judgment last). Model memory, retrieval systems, and
prior-session recollections are conveniences that always lose to the canonical file.
Agents navigate via the ssot-navigation skill instead of re-deriving.

**Why.** Kills drift between what the agent "remembers" and what the repo says (R4 in
its chronic form). Conflicts get resolved by rank, not by debate.

**Enforcement.** HARD: `scripts/check-drift.mjs` (INV-28 SSOT contradiction check),
`scripts/check-ssot-core.mjs` + `scripts/gen-ssot-core.mjs --check` (INV-108 core-set
exhaustiveness), doc-links integrity (INV-55), `.claude/hooks/pre-edit-ssot-guard.mjs`
(unauthorized SSOT edits blocked at edit time), INV-115 constraint-scan (every free-text
prohibition must resolve to a verified enforcer — the Beyoncé rule _as a gate_).

**Self / Governed.** Both.

**Tier.** All; the guarded file-set shrinks at solo (fewer ceremony docs — see §3).

---

### M6 — Read-set / context economy: load only what the phase authorizes

**What.** Each phase/agent declares its read-set up front (plan manifest, handoff
"Where" rows, track scoping) and loads nothing else. Big files are read by slice; whole
files only when the slice is load-bearing. "Don't re-read unchanged files" is policy,
not preference.

**Why.** Attacks R5 directly: window budget is the scarcest resource; every irrelevant
token degrades every later judgment (context-rot literature and our own incidents
agree).

**Enforcement.** SOFT/structural: plan manifests per wave group declare files touched
(`.claude/skills/wave-drain/SKILL.md` Phase 1); `pre-edit-load-memory.mjs` injects
gotchas only when a glob matches (targeted, not global). DOC→TO-CREATE: a read-set
declaration in the plan template plus an advisory check that an implementation agent's
touched files ⊆ its manifest (the disjointness half is already what makes ADR-103
parallelism legal — the same manifest can bound reads).

**Self / Governed.** Both (manifest discipline ships with wave-drain).

**Tier.** All; strictness scales with parallelism (mandatory where agents run parallel).

---

### M7 — Research through sub-agents: the context firewall

**What.** Exploration, grep-sweeps, and "does X exist?" questions are delegated to
read-only sub-agents that return **conclusions, not transcripts**. The escalation
ladder is cheap-first (`.claude/AGENT_REGISTRY.md` §Escalation Hierarchy):
`codebase-scanner` (Haiku, read-only) → `context-checker` (structured verdict) →
`bridge-reviewer` (combined verdict); `red-team` runs in parallel with planning.

**Why.** R5: the orchestrator's window never absorbs raw search output; it absorbs one
paragraph of conclusion. Also cheap (M1).

**Enforcement.** SOFT/structural: the agents exist, are registered, and are the paved
road; rule-50 makes read-only the _only_ legal mode for non-worktree parallel agents
(`.claude/rules/50-batch-execution.md` §Allowed). TO-CREATE: none needed beyond keeping
the registry parity gate green.

**Self / Governed.** Both — `codebase-scanner` and `red-team` are emitted templates
(`src/templates/claude/agents/*.md.ejs`).

**Tier.** All.

---

### M8 — Structured-output schemas for agent returns

**What.** An agent's deliverable back to the orchestrator is a schema-validated
artifact, not free prose to be re-parsed: evidence bundles
(`schemas/evidence-bundle.schema.json`), `REVIEW_CONTEXT` JSON from `context-checker`,
`gate-pass.json`, the dispatch matrix itself (`.claude/agent-dispatch-matrix.json`),
TDD evidence (schema inlined in the emitted `check-tdd-evidence.mjs`). Validation
happens at the tool/gate layer — a malformed return is a failed gate, not a parsing
adventure.

**Why.** Kills fragile-parsing drift and makes M4 artifacts machine-consumable; a
schema violation is caught at the boundary instead of corrupting downstream phases.

**Enforcement.** HARD where schemas exist: `scripts/check-evidence-bundle.mjs`
(INV-90), `checkTddEvidenceGate`, `check-agent-dispatch.mjs`. TO-CREATE: a generic
**agent-return envelope** (verdict ∈ {PASS,WARN,FAIL}, findings[], evidence-refs[],
confidence) + one validator, so every review/verify agent writes the same shape into
`.arbiter/evidence/` — today only some returns are schematized.

**Self / Governed.** Schemas + validators are dual-tracked.

**Tier.** All at L2+; solo/L1 keeps at minimum the TDD-evidence and gate-pass shapes.

---

### M9 — Worktree isolation for parallel agents (absolute rule)

**What.** **Never** run parallel write-agents in one working tree. Parallelism is legal
only under the ADR-103 carve-out, all conditions necessary: (1) dedicated worktree per
agent (`/wt-open`, `src/worktree/`), (2) distinct branch per agent, (3) file-sets
declared disjoint in the plan manifest _before_ dispatch. Always serial regardless:
dependency/lockfile changes, main-tree edits, tags. Expensive gates serialize through
the flock mutex (`arbiter gate-exec`, kernel-level, released when the gate-exec supervisor
is SIGKILL/OOM-killed; killing the Arbiter Node PID alone leaves that supervisor holding);
lock acquisition is totally ordered
(gate ≺ worktree ≺ wave-claim, ADR-103 §4) with `gate-exec` as the leaf;
stale worktrees are reaped (`arbiter worktree prune --stale`).

**Why.** R3 — the one failure mode with a confirmed real incident and no clean
recovery path. Isolation converts a catastrophic race into ordinary merge mechanics.

**Enforcement.** MIXED — see ADR-103 §1 for the per-condition strength: the branch is
made race-free by git's atomic `git worktree add -b` (the open lock guards the open-log
write, not branch creation); the gate mutex is flock(1), fail-closed serial where flock
is missing; the spawn guard is advisory by default; Iron Law in `AGENTS.md`
(STOP→REFUSE on violation). Recovery protocol codified in rule-50. TO-CREATE: a
dispatch-time hook that refuses to spawn a write-agent whose `cwd` is the main tree
while another write-agent is active (today the rule is iron but the spawn itself is
not mechanically intercepted).

**Self / Governed.** Both — rule-50, `/wt-*` commands and the worktree engine are
emitted (`src/templates/claude/rules/50-batch-execution.md`, generators).

**Tier.** All. Solo needs it _more_: a solo operator runs the most unattended
parallelism.

---

### M10 — Deterministic orchestration where structure is known

**What.** When the workflow shape is known (phase order, fan-out width, review-agent
count, integration order), a **script computes it** and the model only fills the
judgment slots. `arbiter ship` is the next-action computer (the loop asks it for the
current step, does the model-work, advances on green); wave composition, group
partitioning, agent caps (`min(--max-parallel, nproc-2, wave-size)`), and merge order
(minimum-overlap from real `git diff --name-only`) are computed, not improvised;
review fan-out derives from the declared tier matrix (M1).

**Why.** Model-driven control flow drifts (R2, R6): a model can skip a phase under
pressure; a phase machine cannot. Determinism also makes the process auditable and
resumable (M3).

**Enforcement.** HARD: the phase machine refuses out-of-order advance
(`arbiter task advance` gates each transition; INV-38 phase-tracked lifecycle);
dispatch parity gate (M1). SOFT: playbook execution-order contracts.

**Self / Governed.** Both — ship/task/wave engine is the product.

**Tier.** All; solo runs the same machine with lighter gates (§3).

---

### M11 — Iron law "prove it or it is not done" (wired + tested-red + working)

**What.** No completion on trust — neither the agent's nor the orchestrator's. A claim
of done requires, mechanically:

- **Wired:** the change is invoked (call-site `file:line` + the command that reaches it).
- **Tested (red-path):** a test that _failed before_ the fix and passes after —
  `arbiter task record-red` captures the failing run; `checkTddEvidenceGate` verifies
  task-id match, a recognized failure signature in the log, the test commit SHA in
  history, and the test path present in that commit. Required ordering: commit the
  RED test _before_ running `record-red` — it refuses on a dirty/uncommitted
  `__tests__/**` or a test path absent from HEAD (`--force` overrides, #1988), so the
  stamped SHA always points at a commit that actually contains the test. Gates
  themselves need flip-tests:
  a gate proven only green is ceremony (`scripts/check-guard-flip.mjs`; target =
  100% flip coverage of emitted gates, playbook §T3). CANON-24 makes this a
  requirement, not advice, for the absence-asserting family.
- **Working:** exercised end-to-end on real input (dogfood), not a fixture —
  Verification-Before-Victory (`AGENTS.md`).

**Why.** R2 is the dominant observed failure mode. Review layers do not catch it;
only evidence does.

**Enforcement.** HARD: `.claude/hooks/stop-evidence-guard.mjs` (INV-114, Stop event,
exit 2 blocks the completion claim); `enforce-gate-before-pr.mjs` (no PR without a
valid `gate-pass.json`); `guard-task-completion.mjs` (premature-claim warning);
CI-side re-verification on fresh checkout (INV-131 `check-tdd-evidence.mjs`);
anti-fake-green + fail-closed audit (INV-96: uncertainty ⇒ BLOCK, never SKIP).
PARTIAL: flip coverage is not yet 100% (playbook §T3). CANON-24 (#2301) closed the
first tranche — the ABSENCE-asserting family (`check-no-*`, ratchets, parity) is now
derived live from `check-all.mjs` and each member needs a planted bad/clean proof or a
banked row in `scripts/data/inversion-proof-registry.json`; the residue is 16 rows, all
ratcheted. The "working/dogfood" leg is enforced on arbiter-self
(`check-self-dogfood.mjs`) but only advisory on targets.

**Self / Governed.** Both; J1 (completion-integrity kernel) is slated to ship as a
standalone plugin (playbook §T1) precisely so ungoverned repos can adopt this one
measure alone.

**Tier.** The Stop gate + TDD evidence: L2+. Solo/L1 keeps the gate-before-PR and
red-record as the floor.

---

### M12 — Verify-first: no structural claim without cross-checking the code

**What.** Any structural/architectural assertion an agent makes (or receives) must be
grounded in cited code (`file:line`) before it drives action. The refutation incident
is canon: an audit claimed "the hexagonal architecture is fiction" — cross-checking
found 113 ArchUnit rules enforcing it; the alarm was the fiction. Corollary already
codified: **the ground is the authority** — Opus re-greps immediately before every
deletion batch; "this document is a map, not a warrant" (playbook §7.5). Root-Cause-First
is the same law applied to failures: read the actual failure before the second fix
attempt (`AGENTS.md` Iron Law).

**Why.** R4. A false structural claim, acted on, is indistinguishable from sabotage.

**Enforcement.** SOFT today: red-team protocol demands `file:line` evidence per
finding (the 3-hop plan gate verifies the trail via `gh` deterministically —
wave-drain v2); playbook safety re-grep contract. TO-CREATE: make citation mandatory
in the agent-return envelope (M8) — a structural finding without a resolvable
`file:line` is rejected at the tool layer.

**Self / Governed.** Both.

**Tier.** All.

---

### M13 — Adversarial verification: independent skeptics try to refute; majority survives

**What.** High-stakes findings and verdicts are not accepted from a single agent.
Independent skeptical agents are dispatched with the explicit mandate to **REFUTE**
the finding (not to confirm it); a finding survives only if it withstands the
majority. Today's building blocks: the `red-team` agent (adversarial by charter,
PASS/WARN/FAIL, CRITICAL routes to rework, max 2 cycles); the adversarial verifier in
the refactor phase; tier-scaled review fan-out with orthogonal verticals (bugs,
type-safety, domain, +test-quality, +security, +data-integrity, +silent-failures) so
reviewers cannot herd.

**Why.** Single-reviewer verdicts inherit the reviewer's blind spots and the
confirmation bias of "reviewing to approve". Refutation-framing plus independence is
the cheapest known de-biaser; majority survival bounds both false positives (R4) and
rubber stamps (R2).

**Enforcement.** PARTIAL: red-team dispatch is phase-gated in ship (tier-N agents at
`red-team-review`); vertical breadth floors are parity-checked (M1). TO-CREATE: the
**refutation protocol** as a first-class skill/dispatch mode — N independent skeptics
per surviving finding, refute-mandate prompts, majority rule, verdicts persisted as
M8 envelopes; wire it as the required path for audit findings above a severity
threshold.

**Self / Governed.** Both (red-team template already emitted).

**Tier.** Fan-out width scales by tier: solo XS/S = 1 skeptic (the red-team);
Standard = 3; enterprise/gated-review = full vertical set. Right-sized: solo never
pays 5 agents for a typo fix.

---

### M14 — Loop-until-dry: discovery of unknown size terminates on evidence, not on fatigue

**What.** When the size of the problem space is unknown (audits, backlog drains,
dead-code hunts, finding harvests), the loop repeats until a **dry pass**: a full pass
that produces zero new findings (for audits: two consecutive dry passes from
differently-seeded scans). Wave-drain already runs this shape at backlog level
("next wave, until the backlog is empty"; every issue ends merged or `needs-human` —
never silently dropped); the codebase-audit skill runs a re-verification pass after
fixes.

**Why.** Fixed-iteration discovery under-samples precisely when the space is large —
the case where it matters most. The dry-pass criterion converts "I think we got
everything" (a claim, R2) into evidence.

**Enforcement.** SOFT/structural in wave-drain (termination = empty backlog is
observable via `gh`). TO-CREATE: codify the dry-pass termination rule in the
codebase-audit skill (pass counter + new-finding count per pass persisted in the
evidence dir; the skill refuses to conclude while the last pass was wet).

**Self / Governed.** Both.

**Tier.** All; pass width (number of parallel scanners) scales with tier.

---

### M15 — Fail-closed gates + bypass accounting (anti-deviance loop)

**What.** Two complementary rules. (a) Every gate/hook/check defaults to **BLOCK on
uncertainty**, never SKIP (INV-96 — fail-open is how rot enters silently). (b) Every
bypass is possible only through an audited, append-only channel (bypass-log JSONL,
commit-footer rationale INV-119) and the _bypass rate itself is gated_: a gate
bypassed more than N times/month is auto-flagged for demotion or deletion (ceremony
detector, playbook §T4) — because a routinely-bypassed gate actively trains deviance
(axiom 3).

**Why.** R6. This is the immune system of every other measure: without it, M1–M14
decay into prose within months (observed: 305 bypasses).

**Enforcement.** HARD: `scripts/check-fail-closed-audit.mjs` (INV-96, audits scripts/,
`.githooks/`, `.claude/hooks/` for fail-open anti-patterns);
`check-commit-footer-rationale.mjs`; append-only bypass-log; suppressions require
expiry (INV-31). TO-CREATE: `check-bypass-ceremony.mjs` + `doctor` surface (playbook
§T4); move bypass env vars out of agent-readable config (playbook §T1 — the bypass
channel becomes human-permissioned).

**Self / Governed.** Both.

**Tier.** All; N (bypass tolerance) may be higher at solo.

### M16 — Terminal handoff: subagents never own waits

**What.** `M16 handoff-contract: subagents never own waits`. A dispatched worker that
finishes real work and then "waits for the gate" is the most expensive failure mode in
this standard: the wait is usually not real, so the parent receives `completed` while
the gate still runs, then burns 100k-350k tokens per SendMessage re-engagement as the
agent re-derives its world from a cold transcript. The fix is structural, not
prompting: (a) a worker brief ends at commit + launch + a structured handoff
`{SHA, worktree, PID, exit-file, log}` and an explicit END-TURN — the worker's last
action is `bg-run.sh <name> -- <gate-command>`, never "I'll wait"; (b) ALL watches
belong to the coordinator: a background `pid-watch.sh <name>` until-loop on the
exit-file, which emits exactly one line at job end; (c) resume contract: if a worker
IS resumed, it may spend at most 3 tool calls re-establishing state before acting
(it must never re-read the world); (d) the one valid subagent-wait idiom — `Bash` with
`run_in_background` on the gate command itself, no nohup/PID-file/finite-Monitor — is
the documented exception for merge-after-green briefs. `bg-run.sh`/`pid-watch.sh`
(emitted by `arbiter update`, see gate-throughput-patterns.md) supersede the raw
nohup+PID-file recipe: the OS process is invisible to harness child-tracking BY
DESIGN, so the launching agent must end its turn; a foreground wait on the PID is
exactly the parked-wait bug this measure bans. Monitor stays valid for event
streams — it is only banned as a gate-wait idiom with finite timeout.

**Why.** R5/R7. Six verified incidents in one night (2026-07-24, ~750k-1M tokens:
arbiter #2095/#2098/#2102-work, a governed consumer #4004/#4011): every ambient default funnels
agents into a broken lookalike — (1) nohup+PID-file in foreground Bash (invisible to
harness child-tracking, encouraged by the old scoped-PID memory note), (2) Monitor
with finite `timeout_ms` silently killed mid-gate, (3) pure narration backed by
nothing. All three end with "no live background children" → premature `completed`.
Resume via SendMessage re-prefills the full transcript at cold cache — the cheap
resume is the one that never happens.

**Enforcement.** SOFT: `scripts/check-m16-handoff.mjs` (+ generated twin
`src/templates/scripts/check-m16-handoff.mjs.ejs`) greps the dispatch-template corpus
(`.claude/skills/wave-drain/SKILL.md`, `.claude/skills/drain/SKILL.md`, this section)
for the marker line — a dispatch brief without it fails the gate naming the file.
Self-tests on `bg-run.sh`/`pid-watch.sh` prove the exact failure mode: a watcher on a
PID that outlives the caller's session emits exactly one exit line. TO-CREATE
(dated debt): promote to HARD by making the corpus check fail-closed when a dispatch
template is added without the marker; the gate registration in `check-all.mjs` is
wired at integration.

**Self / Governed.** Both: arbiter self runs the helpers + the SOFT gate; governed
projects receive `bg-run.sh`, `pid-watch.sh` and the gate twin via `arbiter update`.

**Tier.** All; the resume-cap is solo's default (a solo agent IS the coordinator).

---

## 3. Right-sizing per tier (no cathedral)

The tier axis is `collaborationMode` (`src/config/collaboration-mode-defaults.ts`,
ADR-051) × governance level (L1–L4, `docs/CONCEPTS.md`). Mapping to plain words:
**solo** = trunk-solo, **team** = peer-review, **enterprise** = gated-review.

| Measure                         | Solo (trunk-solo)                           | Team (peer-review)                  | Enterprise (gated-review)                      |
| ------------------------------- | ------------------------------------------- | ----------------------------------- | ---------------------------------------------- |
| M1 pyramid                      | full (cost rule)                            | full                                | full + registry review                         |
| M2 short-lived                  | full                                        | full                                | full                                           |
| M3 handover//clear              | handoff file + banner                       | + status.json gate                  | + evidence of handoff in bundle                |
| M4 persist-to-file              | findings spool + gate-pass                  | + full evidence dirs (L2)           | + L4 evidence harness, audit trail             |
| M5 SSOT-first                   | AGENTS.md + drift check                     | + core-set gate                     | + guarded-edit hooks on all SSOT               |
| M6 read-set                     | advisory                                    | manifest per plan                   | manifest checked                               |
| M7 research sub-agents          | scanner agent                               | full ladder                         | full ladder                                    |
| M8 schemas                      | tdd-evidence + gate-pass                    | + evidence bundle (INV-90)          | + full return-envelope                         |
| M9 worktrees                    | **full — never relaxed**                    | full                                | full                                           |
| M10 deterministic orchestration | ship/task machine                           | + wave-drain                        | + merge-train / one-wave-PR                    |
| M11 prove-or-not-done           | gate-before-PR + record-red                 | + Stop gate (INV-114), CI re-verify | + flip-coverage 100%, dogfood leg              |
| M12 verify-first                | rule of conduct                             | citation in reviews                 | citation enforced in envelope                  |
| M13 adversarial                 | 1 skeptic (red-team)                        | 3 skeptics, majority                | full vertical set, majority                    |
| M14 loop-until-dry              | dry-pass rule                               | + persisted pass ledger             | + audited termination evidence                 |
| M15 fail-closed + bypass        | fail-closed always; bypass logged           | + footer rationale                  | + ceremony detector, human-permissioned bypass |
| M16 terminal handoff            | worker ends at handoff; coordinator watches | + bg-run/pid-watch emitted          | + marker gate on dispatch templates            |

Principle: **M9 and M15(a) never scale down.** Everything else scales in _depth of
evidence and fan-out width_, not in whether the measure exists.

---

## 4. Self vs governed — division of labor

- **Arbiter for itself (self):** runs every measure at team-or-above depth; dogfood
  parity is gated (CANON-14, `check-self-dogfood.mjs`, `.dogfood-divergences.json`
  with dated carve-outs). The self-repo is the reference implementation of this
  standard.
- **Arbiter for governed projects:** `arbiter init/update` **generates** the
  enforcement surface (hooks, gate scripts, rules, skills, agents, templates listed
  in §5) right-sized by `collaborationMode` × level, and `update --adopt` (playbook
  §T1) guarantees safety-class fixes propagate even over local modifications —
  a withheld safety fix is the erosion case, blocked by ratchet.
- **Ungoverned repos:** the completion-integrity kernel (J1: stop-evidence-guard +
  evidence protocol + the two wiring detectors) ships as a standalone plugin so M11
  is adoptable without the rest.

---

## 5. Appendix — measure → arbiter mechanism map (implementation base)

Status legend: **EXISTS** (wired today) · **PARTIAL** (exists, gap named) ·
**TO-CREATE** (net-new, target named).

| #   | Measure                                                 | Mechanism                                                                                     | Status                                        | Code anchors                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Model pyramid, deterministic routing                    | dispatch oracle + registry + handoff tier rows                                                | **EXISTS** (declaration+parity)               | `.claude/agent-dispatch-matrix.json`; `scripts/check-agent-dispatch.mjs`; `src/commands/task-ship.ts::verticalsForTier` (~L92); `.claude/AGENT_REGISTRY.md`; `src/templates/HANDOFF.template.md`; `AGENTS.md` §Model-Pyramid                                                                                                                                                                                                                                            |
| M1  | Handoff-lint (tier suggested per task)                  | advisory check (runWarnCheck)                                                                 | **EXISTS** (#1943)                            | `scripts/check-handoff-doc.mjs`; wired `scripts/check-all.mjs`; `__tests__/scripts/check-handoff-doc.test.ts`; advisory-ledger entry `scripts/data/advisory-ledger.json`                                                                                                                                                                                                                                                                                                |
| M2  | Short-lived / one task per session                      | phase machine + wave worker lifecycle                                                         | **EXISTS** (structural)                       | `src/commands/task.ts` (advance gates); `.claude/skills/wave-drain/SKILL.md`                                                                                                                                                                                                                                                                                                                                                                                            |
| M3  | Mesocycle handover + /clear                             | handoff gate, clear strategy, post-clear re-entry, pre-compact, 3-layer skill                 | **EXISTS**                                    | `src/commands/task.ts::decideClearStrategy` (~L511) / `::buildHandoffBanner` (~L526) / `handlePostClearReEntry`; ADR-054; `.claude/hooks/pre-compact.mjs`; `.claude/skills/context-rot-management/SKILL.md`; `src/capabilities/host-probe.ts`                                                                                                                                                                                                                           |
| M3  | Cursor after T2 cut of `arbiter mark`                   | status.json fields only; repoint skill docs                                                   | **PARTIAL** (transition)                      | playbook §T2.B D2; INV-113                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| M4  | Findings spool + harvest                                | task-note JSONL + wave Phase 0.5                                                              | **EXISTS**                                    | `src/commands/task-note.ts::FindingEntry` (~L61); `.arbiter/findings/`; wave-drain Phase 0.5                                                                                                                                                                                                                                                                                                                                                                            |
| M4  | Evidence per phase, schema'd                            | evidence dirs + bundle schema + phase doc                                                     | **EXISTS**                                    | `.arbiter/evidence/**`; `schemas/evidence-bundle.schema.json`; `scripts/check-evidence-bundle.mjs` (INV-90); `scripts/check-phase-doc-consistency.mjs` (INV-113)                                                                                                                                                                                                                                                                                                        |
| M4  | Plan anchor before edit                                 | pre-edit hook (CANON-16)                                                                      | **EXISTS**                                    | `.claude/hooks/pre-edit-plan-anchor.mjs`                                                                                                                                                                                                                                                                                                                                                                                                                                |
| M4  | Finding-loss detector                                   | Stop hook, advisory default / hard via env                                                    | **EXISTS** (activated advisory, #1948)        | `.claude/hooks/stop-finding-loss.mjs`; `__tests__/hooks/empirical/stop-finding-loss.test.ts`; `.arbiter/hooks-manifest.json`; `.claude/settings.json` Stop chain; design doc §E6b. Wired per OD-14 2026-07-17; `ARBITER_FINDING_LOSS_HARD=1` promotes to hard.                                                                                                                                                                                                          |
| M5  | SSOT-first                                              | drift + core-set + links + edit guard + constraint-scan                                       | **EXISTS**                                    | `scripts/check-drift.mjs` (INV-28); `scripts/gen-ssot-core.mjs`/`check-ssot-core.mjs` (INV-108); `scripts/check-doc-links.mjs` (INV-55); `.claude/hooks/pre-edit-ssot-guard.mjs`; `scripts/check-constraint-scan.mjs` (INV-115)                                                                                                                                                                                                                                         |
| M6  | Read-set / context economy                              | wave plan manifests; targeted memory hook; touched⊆manifest gate                              | **EXISTS** (#1943)                            | wave-drain Phase 1 manifests + Read-set row (`.claude/skills/wave-drain/SKILL.md`); `scripts/check-touched-vs-manifest.mjs` (harvest GO, skill-wired); `__tests__/scripts/check-touched-vs-manifest.test.ts`; allowlisted `scripts/optional-emissions.json`                                                                                                                                                                                                             |
| M7  | Research sub-agents, cheap-first ladder                 | scanner/context-checker/bridge/red-team registry                                              | **EXISTS**                                    | `.claude/agents/*.md`; `.claude/AGENT_REGISTRY.md` §Escalation; `src/templates/claude/agents/*.ejs`; rule-50 read-only clause                                                                                                                                                                                                                                                                                                                                           |
| M8  | Structured agent returns                                | per-artifact schemas + generic envelope + gate validation                                     | **EXISTS** (#1943)                            | `schemas/agent-return.schema.json`; `scripts/check-agent-return.mjs` (+ `record-agent-return.mjs` recorder); `scripts/lib/agent-return-validate.mjs` (M12 citation resolve); wired `scripts/check-all.mjs`; `__tests__/scripts/check-agent-return.test.ts`                                                                                                                                                                                                              |
| M8  | Review-completion reconciliation                        | task-scoped dispatched-vs-returned reconciliation; one retry then hard stop                   | **EXISTS** (#2177)                            | Additive `.arbiter/agents-dispatched.json::agents[]`; `scripts/check-review-completion.mjs`; `/ship` never re-dispatches an agent that exhausted its turn budget after writing its envelope. Implements #2176's 77% ITT vs 88% per-protocol finding (about +11pp).                                                                                                                                                                                                      |
| M9  | Worktree isolation (absolute)                           | Iron Law + rule-50/ADR-103 carve-out + wt engine + gate mutex + reaper                        | **EXISTS**                                    | `AGENTS.md` §Iron Laws; `.claude/rules/50-batch-execution.md`; `src/worktree/{paths,links,validate,harvest}.ts`; `src/commands/{worktree,worktree-prune,gate-exec}.ts`; `/wt-*` commands                                                                                                                                                                                                                                                                                |
| M9  | Spawn-time interception (main-tree write-agent refusal) | PreToolUse hook, advisory default / hard via env                                              | **EXISTS** (activated, #1947)                 | `.claude/hooks/pre-spawn-worktree-guard.mjs`; `__tests__/hooks/empirical/pre-spawn-worktree-guard.test.ts`; `.arbiter/hooks-manifest.json`; design doc §E5. Wired into the PreToolUse chain (`Task\|Agent`) per OD-14 2026-07-17; `ARBITER_SPAWN_GUARD_HARD=1` promotes to hard.                                                                                                                                                                                        |
| M10 | Deterministic orchestration                             | ship next-action computer + phase gates + wave composition math                               | **EXISTS**                                    | `src/commands/task-ship.ts`; `arbiter ship --advance`; `.claude/commands/ship.md`; wave-drain caps/merge-order; INV-38                                                                                                                                                                                                                                                                                                                                                  |
| M11 | Prove-or-not-done                                       | Stop gate + TDD evidence + gate-before-PR + CI re-verify + fail-closed                        | **EXISTS** (core)                             | `.claude/hooks/stop-evidence-guard.mjs` (INV-114); `src/commands/task.ts::checkTddEvidenceGate` (~L450); `.claude/hooks/enforce-gate-before-pr.mjs`; `scripts/check-tdd-evidence.mjs` (INV-131); `scripts/check-anti-fake-green.mjs`                                                                                                                                                                                                                                    |
| M11 | Flip-coverage 100% of emitted gates                     | extend flip harness                                                                           | **PARTIAL** (absence family closed, #2301)    | `scripts/check-guard-flip.mjs`; `scripts/lib/gate-roster.mjs` (family derived from `check-all.mjs`); `scripts/data/inversion-proof-registry.json` (banked residue, 16 rows); CANON-24; playbook §T3                                                                                                                                                                                                                                                                     |
| M11 | Kernel as standalone plugin                             | package J1                                                                                    | **PARTIAL** (package landed, builder unwired) | playbook §T1; `packages/kernel/` (README + emitted `hooks/`); `scripts/build-kernel-plugin.mjs`. Gap: the builder is referenced by no gate, test or workflow, so `packages/kernel/hooks/` can drift from `.claude/hooks/` undetected.                                                                                                                                                                                                                                   |
| M12 | Verify-first / citation-grounded claims                 | red-team file:line protocol; pre-delete re-grep contract; envelope-enforced citation          | **EXISTS** (#1943)                            | `.claude/agents/red-team.md`; wave-drain 3-hop plan gate; playbook §0.2/§7.5; mandatory citation field enforced by `scripts/lib/agent-return-validate.mjs::enforceCitations` (structural finding without resolvable file:line ⇒ rejected)                                                                                                                                                                                                                               |
| M13 | Adversarial refutation, majority                        | red-team + adversarial verifier + tiered verticals + refutation skill + majority gate         | **EXISTS** (#1943)                            | `src/commands/task-ship.ts` REDTEAM_AGENTS/REVIEW_AGENTS (~L77); `.claude/skills/refutation/SKILL.md`; `.claude/agent-dispatch-matrix.json::refutation_skeptics` (parity-gated by `scripts/check-agent-dispatch.mjs`); `scripts/check-refutation-verdicts.mjs`; `__tests__/scripts/check-refutation-verdicts.test.ts`                                                                                                                                                   |
| M14 | Loop-until-dry                                          | wave loop to empty backlog; audit re-verify pass; dry-pass termination gate                   | **EXISTS** (#1943)                            | wave-drain loop; `.claude/skills/codebase-audit/`; `scripts/check-audit-dry-pass.mjs` (two-dry-pass + distinct-seed rule); `__tests__/scripts/check-audit-dry-pass.test.ts`                                                                                                                                                                                                                                                                                             |
| M15 | Fail-closed everywhere                                  | fail-closed audit gate                                                                        | **EXISTS**                                    | `scripts/check-fail-closed-audit.mjs` (INV-96)                                                                                                                                                                                                                                                                                                                                                                                                                          |
| M16 | Terminal handoff — subagents never own waits            | bg-run.sh + pid-watch.sh helpers; coordinator-only watches; marker gate on dispatch templates | **EXISTS** (#2103)                            | `scripts/bg-run.sh`, `scripts/pid-watch.sh`, `scripts/check-m16-handoff.mjs` (+ .ejs twins); this section; registration in `check-all.mjs` at integration                                                                                                                                                                                                                                                                                                               |
| M15 | Bypass accounting + ceremony detector                   | footer rationale + append-only log; detector                                                  | **EXISTS** (#1949)                            | `scripts/check-commit-footer-rationale.mjs` (INV-119); `.arbiter/evidence/bypass-log.jsonl`; `scripts/check-bypass-ceremony.mjs` (thresholds `scripts/data/ceremony-thresholds.json`, ledger `scripts/data/advisory-ledger.json`); doctor row `src/commands/doctor/health.ts`; wired HARD at L1 in `scripts/check-all.mjs` (#2419 AC-2, promoted from advisory); `__tests__/scripts/check-bypass-ceremony.test.ts`, `__tests__/gates/bypass-ceremony-hard-2419.test.ts` |

**Wiring order — followed, not pending (#1943, #1947, #1948, #1949).** The
recommended order was (1) the M8 agent-return envelope as the substrate M12/M13 hang
on, (2) the M13 refutation skill + M14 dry-pass rule, (3) the M15 ceremony detector
and M11 flip-coverage, (4) the M9 spawn-time hook, (5) the advisory checks (M1
handoff-lint, M4 finding-loss, M6 read-set). All of it shipped. Every gate follows
INV-53 exit codes, the INV-94 CATALOG marker and INV-96 fail-closed, and every one
carries a planted-bad/planted-clean fixture test in `__tests__/scripts/` — the
standard applied to its own enforcement.

They were all wired **advisory** (`runWarnCheck`) with dated promoteBy entries in
`scripts/data/advisory-ledger.json`; per the design doc's §0 rule an advisory-tier
enforcer burns no invariant number until it is promoted, so none of E1–E7 claims an
INV. Two have since been promoted and their ledger entries pruned: `review completion`
(#2435 AC-2, hard at L2) and the E4 ceremony detector itself (#2419 AC-2, hard at L1 —
the police of advisory-forever gates could not itself be advisory-forever). Two rows above stay **PARTIAL** on purpose and are the honest residual: the M3
cursor transition, and M11 flip-coverage — `scripts/lib/anti-fake-green-guards.mjs`
enumerates five of the seven scripts in `CONTEXT_ROT_GATES`, because
`check-bypass-ceremony` and `check-review-completion` are proven by their vitest
fixtures but have no bespoke-argv entry in `scripts/lib/guard-flip-registry.mjs`
yet (playbook §T3). The M11 kernel row is PARTIAL for a different reason, named in
the row itself: the package exists but nothing keeps it in sync.
