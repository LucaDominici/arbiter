# Handoff: Viafera-validated patterns → Arbiter consolidation

**Date:** 2026-07-05 · **Author:** Fable 5 orchestrator session (viafera rebaseline audit)
**Source of truth:** `~/work/repos/viafera/.claude/plans/gold-rebaseline-2026-07.md` (full audit evidence)
**Executor:** any competent model (Sonnet+). Each numbered item is issue-sized.
**Prime directive:** Arbiter absorbs only patterns that _survived contact_ with a 100k-LOC real project. Nothing speculative. Ponytail applies to arbiter itself.

---

## A. Patterns proven on Viafera → absorb into arbiter

### A1. Tier-assignment rule for gates (the one CI rule)

"A check lives at the fastest tier where its red would change the dev's next action. A red tolerated >48h must be fixed, demoted, or deleted."

- **Where:** codify in `AGENTS.md` canon + `arbiter ci` generator emits the 5-lane shape: pre-commit (<10s) / PR-blocking (≤15min) / nightly (≤45min) / weekly (unbounded) / release-seal (tag).
- **Proof it works:** Viafera had 10 workflows, nightly red 3 weeks, 20 ignored auto-issues = measured alarm fatigue. The 5-lane collapse is the fix (viafera #3715/#3716).
- **AC:** `arbiter init` on a fresh repo emits ≤5 workflows with tier budgets in comments.

### A2. Journey-first Definition-of-Done (extends INV-114)

Current evidence model (test failed → passes, SHA-anchored) is necessary but not sufficient: Viafera shipped images where the FE ran in fixture mode — all tests green, prod buttons dead.

- **Extend evidence taxonomy with two checks:**
  1. _Journey evidence:_ task declares its acceptance E2E spec BEFORE implementation; completion claim must reference a run of that spec.
  2. _Artifact parity:_ the E2E ran against the **built artifact** (compose image / dist), not the dev server. Evidence records which.
- **AC:** stop-evidence-guard rejects a completion claim whose journey evidence is missing or dev-server-only, with a clear message.

### A3. Zero-retry smoke + quarantine TTL

Retries hide races; quarantine without expiry becomes a graveyard. Viafera grew a 34-script "e2e farm" to _manage_ flakiness instead of eliminating it.

- **Rule:** @smoke tier = 0 retries. Quarantine allowed only with linked issue + TTL 7 days; expired quarantine = gate failure.
- **Where:** conformance check + installable E2E constitution (see A4).
- **AC:** a repo with an expired quarantine entry fails `arbiter conformance`.

### A4. E2E constitution (installable standard, ~10 rules)

Determinism rules Viafera paid for in incidents: testid-contract selectors only; fake clock installed before first navigation; no hardcoded past dates (dynamic/future only); dedicated seed per spec; external providers deterministic (fixed payloads); no sleep/waitForTimeout; no skipped tests without issue+TTL; smoke against built artifact.

- **Where:** template in `src/templates`, installed by init/kit; referenced by A3 conformance.
- **AC:** template exists, ≤1 page, installed file is customizable (arbiter leaves edits alone).

### A5. Gates-that-bite: negative proof, not script self-tests

Viafera anti-pattern: ~40 `test-*.sh` unit-testing the gate scripts themselves (meta-tax). Viafera pattern that WORKED: `ArchNegativeProofTest` — intentional-violation fixtures proving each architecture rule actually fails.

- **Rule:** every gate arbiter installs ships one negative fixture proving it bites. That replaces script self-test suites entirely.
- **AC:** `arbiter doctor` can run the negative proofs (`--prove-gates`) and reports any gate that fails to fail.

### A6. Sticky failure issue (absence-graceful process)

A solo/AI-driven repo's process must degrade gracefully when the human disappears for 3 weeks. Viafera auto-filed 1 issue per red night → 20 duplicates, zero action.

- **Rule:** scheduled-lane failures update ONE sticky issue (append run link, keep count), auto-close on green.
- **Where:** CI fragment emitted by `arbiter ci` (replaces per-failure issue creation).
- **AC:** two consecutive simulated failures produce 1 issue with 2 entries.

### A7. Executable-handoff standard (issue-as-memory)

The cheapest durable memory across sessions/models/budget gaps is an issue (or plan file) written so a _cold_ model executes it without re-derivation: context, evidence pointers, ordered atomic tasks, per-task AC + verify command, suggested model tier.

- **Where:** template (`HANDOFF.template.md`) + `arbiter explain --handoff <topic>` scaffold. Reference example: the viafera gold-rebaseline file.
- **AC:** template exists; docs state the 90/10 rule (see A8).

### A8. Model-pyramid budget as _guidance_, not machinery

Rule of thumb that survived: ~90% of work on cheap models executing good plans, ~10% expensive models for judgment (root-cause, architecture, plan review). "If the expensive model is executing, the plan upstream was bad."

- **Where:** one paragraph in AGENTS.md canon. Explicitly NOT a runtime feature — see B1.

### A9. Java recipe: migration validator + test taxonomy

Two Viafera gates worth generalizing into the java recipe/kit:

- Flyway validator: naming convention, idempotency, destructive-DDL guard, dual-migration-set parity (if a second dialect dir exists).
- Test taxonomy: `@Tag("unit")`/`@Tag("integration")` enforced by count gate (no untagged tests).
- **AC:** both available as opt-in checks in the java kit.

### A10. Frontend recipe: token hygiene

Semantic-token-only styling enforced by a check (no raw palette classes, no `<style>` blocks where the project forbids them), with a baseline file for grandfathered violations + ratchet.

- **Source:** viafera `verify-primitives-tokens.mjs` (proven: 73% adoption, 0 ad-hoc CSS).
- **AC:** opt-in check in fe kit with baseline+ratchet mechanics.

### A11. CLOSER mode (last-mile rule in the task lifecycle)

Empirical failure mode across multiple AI-driven repos (viafera, coach, haben, 2026-07): agents burn hours _discovering_ work (tech-debt issues spawning) instead of _closing_ it — because discovery is cheap and visible while the residual 10% (merge, red gate, conflict) is hard. The fix is a mode, not a hope:

- **Trigger:** a task enters its closing phase (post-implementation, pre-merge), OR a human invokes it on stuck work (`arbiter ship --closer` or agent-rule).
- **Rules (installable as agent-rule template):** (1) single named target, no switching; (2) opening new issues / refactoring beyond the minimal diff is FORBIDDEN — findings go to a PARKING list, one line, no action; this includes deleting or "fixing" files outside your diff to appease a gate (observed: an agent deleted a colleague's untracked deliverable to make the format check pass — report the obstruction instead); (3) discovering work is the session's failure mode, closing is the only success metric; (4) same error surviving 2 fix attempts → stop patching, 5-line root-cause analysis, fix root or declare BLOCKED with the analysis; (5) pre-existing failures on the branch are the agent's blocker — no merge, not done; (6) done = merged (state verified) + gate output pasted; (7) never end a turn on a promise ("I'll resume when X finishes") — end it on the CLOSER report or keep driving; a turn's last line must be an outcome, not an intention. Corollary: in the close phase all waits are blocking foreground waits (`gh pr checks --watch`, foreground gate runs with generous timeouts) — background "monitors" that cannot actually wake the agent are stalls wearing a uniform (observed 4× in one night). A BLOCKED report with root-cause is an _accepted_ deliverable; partial progress on five fronts is not. (Rule 7 observed empirically the same night the rule set was first deployed: 2 of 5 CLOSER agents stalled mid-task on self-made promises and needed a human-tier nudge — the rule pays for itself.)
- **Where:** agent-rules template installed by init + wired into the task-lifecycle phase machine (the existing "lifecycle with teeth" gets a `close` phase whose entry switches the rule set). Synergy with A2: the completion claim CLOSER demands is exactly the journey+artifact evidence.
- **AC:** `arbiter init` installs the CLOSER rule; the lifecycle rejects a task leaving the close phase without merged-state evidence; docs name the anti-pattern ("issue spawning during close").

## B. Arbiter's own 2025 cruft — audit with the same knife

_(Assumption-labeled: judged from src/ layout + command surface, not deep inspection. Verify before deleting.)_

- **B1. `sizing/`, `affinity/`, `cost/`, `decomposition/`** — model-tier-era machinery (choosing/splitting work per model capability). 2026 models don't need runtime tiering; A8's paragraph replaces it. Candidate: delete or fold into docs guidance.
- **B2. Multi-pass review machinery** (`review/`, `review-diff`, findings-promote pipelines) — keep ONE review entry point; kill pass-count orchestration if present (Viafera's plan-reviewer 5-pass dispatch was pure 2025 compensation).
- **B3. `graphify-out/` in tree** — same junk as viafera. Delete + gitignore.
- **B4. Root report accretion** (`AUDIT-V0.1-FABLE.md`, `GOLD-REPORT.md`) — generated reports out of the repo root; keep in releases/artifacts or `report/`.
- **B5. `experimental/` + hidden commands** — good instinct (11-command public surface). Set a TTL: experimental >90 days without promotion = delete.
- **B6. `wiki/`, `website/`** — fine if published; if stale, they're doc-drift liability. Check freshness.
- **B7. Command surface** — 30+ command files in `src/commands` for 11 public commands: verify the hidden ones are reachable/needed; delete dead ones.

## C. Non-goals

No new subsystems. No telemetry. No per-model runtime adaptation. No absorbing viafera-specific gates (keycloak-theme-sync, i18n-parity stay in viafera). Obsidian sync: keep as-is (in use by other repos), do not extend.

## D. Suggested execution order

1. B3+B4 (10 min, zero risk) → 2. A1+A6 (CI generator shape) → 3. A2+A3+A4+A11 (evidence/DoD/closer core — the highest-value block) → 4. A5 (`--prove-gates`) → 5. A7+A8 (templates/docs) → 6. A9+A10 (stack kits) → 7. B1/B2/B5-B7 audit (each needs a look-before-delete).

After A2-A4 land: viafera task T18 (its local ceremony → arbiter) becomes executable; viafera then deletes its hand-rolled versions.
