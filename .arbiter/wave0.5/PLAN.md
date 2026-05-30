# Wave 0.5 — Template self-consistency fix

> **Stream**: A (Arbiter Product) · **Status**: scaffold ready, implementation pending · **Authored**: 2026-05-26
> **Trigger**: Wave 0 smoke test on haben — 12 findings, 6 P0. See [`../wave0/haben-smoke-test.md`](../wave0/haben-smoke-test.md).
> **Operating mode**: DEC-005 in force — Claude drafts ADR/plan, Luca writes code.

## Mission

Make arbiter audit-proof against its own outputs. Today:
- A fresh `arbiter update` on any greenfield project produces an **L1-RED** repository (4/20 checks fail on arbiter-generated files alone).
- A single invocation **silently materializes a GitHub project board** on the operator's account; over time the account accumulated 152 orphan boards.
- The `diff` command **under-reports its sibling `update`'s side effects by 89%**.

These are not user-visible drift — they're structural template/CLI defects. They block every downstream stream (Wave 2A consolidation, plugin Java case study, doc site, talk submission) because no demo of arbiter is credible while the demo project fails L1 immediately.

## Outcome criteria for Wave 0.5

The wave closes when ALL of the following hold:

1. `arbiter diff` and `arbiter update` operate on the same manifest (F1/F7)
2. `arbiter update` exits non-zero on any unrecoverable `gh` error (F9)
3. Default invocation makes **zero** remote GitHub calls; `--github` is opt-in (F4)
4. Project board creation, when opted in, namespaces by repo full path + creation date and probes existing boards account-wide before creating (F11)
5. Templates produce output that passes `node scripts/check-all.mjs L1` on a fresh greenfield project (F10)
6. Generated Markdown is valid CommonMark, padded-table style, no trailing-pipe bug (F2/F3)
7. A fixture under `__tests__/fixtures/real-projects/` asserts (5) above as a regression test (INV-32 binding)
8. Re-run of Wave 0 smoke test on a clean checkout produces **zero of the 12 findings**

## P0 sequencing (committed)

See MILESTONES.md §Active 2 for the full table. Summary order with rationale:

1. **F4 + F11** — "stop the bleeding". Cap further remote pollution before anything else.
2. **F9** — make exit code honest so subsequent PRs surface failures cleanly.
3. **F2** — small, surgical, MD-template win to validate the Wave 0.5 PR flow.
4. **F10** — the big template fix; tackles the visible L1-RED.
5. **F1 + F7** — architectural alignment, last because its target (the update manifest) is the result of F10.

Each step has a dedicated ADR-stub in this folder:

- [`ADR-001-no-github-flag.md`](ADR-001-no-github-flag.md) — `--no-github` flag (default opt-out) + project board namespacing fix
- [`ADR-002-exit-code.md`](ADR-002-exit-code.md) — exit code propagation from `gh` wrappers
- [`ADR-003-md-template-fix.md`](ADR-003-md-template-fix.md) — Markdown table padding + pipe closure
- [`ADR-004-templates-L1-pass.md`](ADR-004-templates-L1-pass.md) — make all generated templates pass L1
- [`ADR-005-diff-scope.md`](ADR-005-diff-scope.md) — align `diff` manifest to `update`

## Cross-cutting concerns

These apply to every step, not just one ADR:

- **CANON-16 (refactor-first)**: each implementation chat must include an "Existing Code Survey" before any new file under `src/`. The light survey in each ADR is a starting point — the chat refines it.
- **Branch discipline**: every step starts from `arbiter:main`, fresh branch `task/wave0.5-<id>-<slug>`. The repo's `90-exec-protocol.md` hard-stops main edits.
- **Test-first**: each step's acceptance includes a failing test added BEFORE the fix lands.
- **L1 gate**: `node scripts/check-all.mjs L1` green before commit, L2 before push.
- **DEC-005**: Claude writes ADRs, drafts, PR review, audit. Luca writes source code. PRs reviewed by Claude before merge.
- **Channel pause**: while Wave 0.5 is open, do NOT run `arbiter update` on any user-owned account unless `--no-github` is in place (else F11 accumulates further). Once ADR-001 ships, this constraint relaxes.

## Pre-Wave-0.5 prerequisites

Before opening the first chat for ADR-001:

- [ ] Run the cleanup script `.arbiter/wave0/evidence/cleanup-orphan-boards.sh --dry-run`, review, then `--execute` to delete 152 orphan boards. **Operator runs this; Claude does not execute destructive remote ops.**
- [ ] Fix the local arbiter clone origin: `git remote set-url origin https://github.com/LucaDominici/arbiter.git` then `git fetch origin`. (F12 — not an arbiter bug, but breaks any PR push from this clone.)
- [ ] Verify on a fresh `gh project list` that #1 "Viafera Backlog" is preserved and the orphans are gone.
- [ ] Commit this folder + the Wave 0 report on a task branch (suggestion: `task/wave0-evidence`) so that the analysis itself is version-controlled before any code work starts.

## How each chat closes

Per chat-protocol.md: ship one ADR's worth of work, update MILESTONES.md + DONE.md, then close. No multi-ADR chats. The "win-quick → win-deep" sequencing is deliberate so each PR is reviewable in isolation.

## Out of scope (explicitly deferred)

These were touched by Wave 0 but are NOT Wave 0.5:

- P1: F6 (idempotence) — falls out naturally once F1/F7 align scope; revisit at end of wave.
- P1: F8 (label probe before create) — addressed inside ADR-001 as part of F4's gh-call refactor.
- P2: F3 (table padding regression, GLOBAL_INVARIANTS blank-line bloat) — addressed inside ADR-003.
- P2: F5 (version stamping) — separate effort, post-Wave 0.5.

## Regression test plan

After Wave 0.5 closes, run a full Wave 0 smoke test re-execution against a NEW haben checkout (`git clone` fresh; do not reuse the polluted `task/fix-l1-gate-failures` branch). Acceptance: **zero of the 12 findings present**. The full re-run procedure is in [`../wave0/haben-smoke-test.md`](../wave0/haben-smoke-test.md) §Reproduction kit.
