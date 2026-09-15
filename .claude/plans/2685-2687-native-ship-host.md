# Native ship host and evidence qualification plan

**Goal:** Make one `/ship` capability survive the main-to-worktree handoff and persist the already-completed review panel and AC-fit verdict through commands accepted by Claude Code auto-mode.

**Baseline:** `d9441a6f0bcb5f9c7307414defffff9ee6d48060`

**Delivery:** One declared train, primary `#2685` with chained `#2687`. The host-binding repair is completed and proven before the evidence-producer qualification. Each issue keeps its own RED evidence and commit; one frozen-HEAD review, one L2 gate, one PR, and one CI run certify the combined capability.

## Approach & decomposition

1. Add `arbiter task host-preflight --id <task> --worktree <exact-path>` immediately after `worktree open --json`. It accepts only the exact task/path/branch row in the shared worktree log, requires the live process Git root to equal that path, requires a fresh worktree-project `CLAUDE_CODE_SESSION_ID` transcript, and persists that tuple in the existing task state before normal `task init`. `CLAUDE_PROJECT_DIR` is corroborating input when the host exposes it, not a Bash precondition. Under Claude, `task init --dir <other-root>` and the two new evidence-recording modes require the same persisted tuple and live process/session corroboration, so omitting the explicit preflight cannot bypass the boundary. A parent-root call fails before task initialization or any task-evidence action and prints the fresh worktree-rooted `claude --resume … --fork-session --permission-mode auto` recovery command.
2. Move Claude project/transcript identity validation into one hook helper and call it from both the existing phase validator and the pre-spawn guard. The guard corroborates the persisted host binding against hook input before every lifecycle agent, including read-only reviewers. It rejects main-root, wrong-cwd, wrong-session-transcript, stale binding, and ambiguous/mismatched worktree dispatches.
3. Extend the already-admitted `scripts/record-agent-return.mjs` producer with two explicit modes: declared reviewer-panel recording and AC-fit recording. Panel mode independently derives the required seat count and active auditor set from the persisted tier plus the canonical router over the frozen diff; the sidecar roster is then formed from the exact distinct accepted envelopes and cannot be caller-shrunk. Every seat needs a current, schema-valid, citation-checked return envelope with supported recorder-stamped provenance. In AC-fit mode the verifier returns one schema-valid agent-return envelope whose optional `acceptanceFit` member contains the complete per-criterion verdict/citations; there is no second payload input. The recorder persists that envelope first, derives the existing task-keyed `.arbiter/evidence/ac-fit/<sanitized-task>.json` only from the exact nested member, and records branch, SHA, plan hash, source envelope path, and SHA-256 digest in the fit artifact. The acceptance consumer re-hashes the cited envelope and requires its nested `acceptanceFit` to equal the derived fit record. Both modes validate the supplied task/branch/SHA against current state before stamping and reject unavailable Git identity rather than emitting `unknown`/`0000000`; AC-fit also binds the exact frozen plan criterion hash and cited all-PASS coverage. The two new modes write only canonical repository evidence paths and reject custom `--evidence-dir`; legacy single-envelope recording retains its current fixture/output option. Writes retain descriptor-relative directory traversal, no-follow protection, atomic replacement, and existing exit-code classes.
4. Replace `/ship`'s inline sidecar writer and raw AC-fit write with those two producer calls. Update `/wt-open` to consume JSON output and require the fresh-session handoff when the current Claude project differs. Keep `getRepoRoot()`, Stop receipt semantics, the task engine, evidence stores, reviewer counts, and permission policy unchanged.

The order is strict: Task 1 reaches its focused green and a clean native worktree-root assertion; Task 2 then uses that corrected boundary. Both finish before HEAD is frozen. Review, AC-fit, and the full gate operate on that one frozen SHA.

## Merge contract

- Acceptance: the eleven namespaced criteria below are the combined hard boundary for #2685/#2687.
- Policy: INV-08 input validation, INV-12 no PII, INV-23 branch/PR delivery, INV-24/25 gates, INV-26 TDD, INV-27 evidence, INV-36/39 empirical hooks, INV-45 self/template parity, INV-53 exit codes, INV-91 owner-authorized merge handling, INV-96 fail-closed uncertainty, INV-114 evidence correlation, and INV-138 acceptance anchoring.
- Tests: hook identity and inverse drills prove #2685; recorder/consumer negative matrices prove #2687; a real Claude auto-mode journey proves their composition.
- CI: focused tests first, one L1 before commit, one L2 on frozen HEAD before push, required PR checks, exact-SHA fast-forward merge.
- Review: the current path router controls the frozen-HEAD panel. Because `scripts/**` and `.claude/hooks/**` activate `silent-failures`, retain the three-agent escalated panel; if a cross-model seat is fulfilled it replaces one seat and never enlarges the panel. One adversarial AC-fit verifier remains separate.
- Dependencies: Node stdlib, current worktree log, current task state, current acceptance/evidence-binding helpers, and current contained-write primitive only. No package or lock change.
- Landing route supported: yes — current `trunk-solo` + `pr-ff` path through `pr-merge-watch`.

## Threat model & abuse cases

- A fallible agent can keep the parent project root after shell `cd`, reuse a main-project transcript UUID, omit a reviewer from the declared panel, replay a return from an older SHA, point AC-fit at another task/plan, or write through a symlinked evidence directory.
- The repair blocks those cases before dispatch or before persistence. It does not weaken permissions, accept inferred PASS, copy transcripts, or trust agent-supplied authority fields.

## Input validation

- Bootstrap input must name one task and the exact absolute path returned by `worktree open --json`. The shared log row, live Git root, project root, branch, session id, and derived transcript must agree before the binding enters existing task state.
- Hook input must be a JSON object with one task id, absolute readable `cwd`, valid session id, exact transcript path, and the same persisted binding. Uncertainty blocks under hard grading with an exact recovery command.
- Recorder input must be valid JSON for the selected explicit mode. Task id, current task state, branch, source SHA, router-derived panel size/auditors, current return-envelope provenance, plan criterion hash, criterion coverage, verdict, citations, and canonical contained output path are checked before any replacement. AC-fit accepts one verifier envelope only; its schema-valid nested `acceptanceFit` is the sole source of criterion data, and the persisted fit cites the recorded envelope path and digest. Current review admission independently enforces citations and recorder provenance for every sidecar-named envelope.
- Missing/malformed/stale contract data exits 1; invocation or filesystem inability exits 2; neither path changes a prior valid record. Under Claude, a missing/stale host binding exits before `task init` or either new producer mode writes, including the direct-persistence inverse that deliberately skips `host-preflight`.

## Idiomatic patterns & pitfalls

- Reuse `git rev-parse --git-common-dir` for main/worktree identity, Node `realpathSync`/`path.relative` for containment, current descriptor-relative `O_NOFOLLOW` + temp/rename writes, `computeAcHash`, `validateAcFit`, and `evidenceStaleness`.
- Do not pick the latest worktree-log row, infer completed reviewers from returned envelopes, restamp a stale supplied SHA, accept a same-named transcript from another project, or add a second state/evidence authority.

## Propagation

- Materialized self files and their `src/templates/**` twins change together.
- The existing check-all generator already distributes `record-agent-return.mjs`, acceptance helpers, evidence binding, and Claude hooks/commands; no new generator, dependency, schema family, state store, or orchestrator is added.
- Focused render/parity tests prove generated projects receive the same behavior.

## File manifest and owners

- Host bootstrap/state: `src/capabilities/host-probe.ts`, `src/commands/task.ts`, `src/commands/task-state.ts`, `src/cli.ts`; tests in `__tests__/capabilities/host-probe.test.ts`, `__tests__/commands/task-state.test.ts`, and a focused `__tests__/commands/task-host-preflight.test.ts` only if the existing command tests cannot hold the integration cases cleanly.
- Hook identity: `.claude/hooks/lib.mjs`, `.claude/hooks/pre-spawn-worktree-guard.mjs`, `.claude/hooks/skill-forced-eval.mjs` and exact twins `src/templates/claude/hooks/lib.mjs.ejs`, `src/templates/claude/hooks/pre-spawn-worktree-guard.mjs`, `src/templates/claude/hooks/skill-forced-eval.mjs.ejs`; empirical tests in `__tests__/hooks/empirical/pre-spawn-worktree-guard.test.ts` and `__tests__/hooks/empirical/skill-forced-eval.test.ts`.
- Native instructions: `.claude/commands/wt-open.md`, `.claude/commands/ship.md` and twins `src/templates/claude/commands/wt-open.md.ejs`, `src/templates/claude/commands/ship.md.ejs`; render coverage in `__tests__/templates/commands-claude.test.ts`.
- Evidence producer/admission: `schemas/agent-return.schema.json`, `scripts/record-agent-return.mjs`, `scripts/check-review-completion.mjs`, `scripts/check-acceptance.mjs` and twins `src/templates/scripts/schemas/agent-return.schema.json.ejs`, `src/templates/scripts/record-agent-return.mjs.ejs`, `src/templates/scripts/check-review-completion.mjs.ejs`, `src/templates/scripts/check-acceptance.mjs.ejs`; tests in `__tests__/scripts/check-agent-return.test.ts`, `__tests__/scripts/check-review-completion.test.ts`, `__tests__/scripts/check-acceptance.test.ts`, and `__tests__/templates/acceptance-anchor-scripts-render.test.ts`.
- Existing helpers consumed unchanged unless RED proves a missing primitive: `src/utils/fs.ts`, `scripts/lib/acceptance-criteria.mjs`, `scripts/lib/evidence-binding.mjs`, and `schemas/agent-return.schema.json`.
- Native qualification artifact: `.arbiter/evidence/native-host/2685-2687.json` records the bounded real-host drill as evidence in the existing store; no executable logic consumes it as a new authority.

## Product truth impact

No `FEATURE_MATRIX.md` row currently names #2685 or #2687. This is delivery-trust infrastructure rather than a new user promise; the issue, plan, executable negative proofs, native-host drill, and exact-subject evidence remain the traceability chain.

## Tasks

### Task 1 — #2685 host binding

- RED: extend the empirical pre-spawn and transcript tests with main-root, same-UUID/wrong-project, exact-worktree, completed-notification, multiple-slug ambiguity, and task-local Stop observation cases.
- GREEN: add the shared transcript-binding predicate, exact worktree-log resolution, fail-closed pre-dispatch guard, host-bound initialization/evidence entry checks, and `/wt-open` recovery instructions.
- Proof: a real Claude Code `2.1.271` auto-mode run begins in main, consumes the exact JSON worktree path, forks a fresh session from that directory, passes `arbiter task host-preflight`, and reaches a task-local lifecycle dispatch. From main, `arbiter task host-preflight --dir <worktree>` fails before any agent or `arbiter note` command can be considered task-local.

### Task 2 — #2687 sanctioned evidence producers

- RED: extend recorder, review-completion, and acceptance tests for wrong task, stale branch/SHA, unavailable Git identity, changed plan hash, missing/extra/non-PASS criteria, missing recorder provenance/citations, escaped/unsafe links, atomic replacement, router-derived complete roster, and distinct invalid-input/IO outcomes.
- GREEN: add the two narrow recorder modes, allow the verifier envelope to carry one optional schema-defined `acceptanceFit`, derive the admitted fit from that member while binding its source envelope digest and frozen criteria, and replace the inline/raw `/ship` writes.
- Proof: under the same real auto-mode host, record one declared reviewer panel and one AC-fit return without redispatch; native review-completion and acceptance checks pass. Denied, malformed, and stale inputs remain distinct and preserve prior valid evidence.

## Acceptance Criteria

- [ ] AC-2685.1: After `/ship` opens a task worktree from main, the actual native Claude session/tool/hook root and project transcript identity are bound to the exact `worktreePath` recorded for that task before any lifecycle agent dispatch or task-evidence hook runs. Shell-local `cd` alone does not meet this criterion.
- [ ] AC-2685.2: A native-host integration drill starts from main, opens a task worktree, records a valid task-local finding or agent-return envelope, and proves the Stop finding-loss hook resolves and observes that worktree.
- [ ] AC-2685.3: The inverse drill simulates a host that remains rooted at main. It fails before dispatch with an actionable root-mismatch recovery path; a generic main-root `arbiter note` cannot satisfy the task's local-return persistence requirement.
- [ ] AC-2685.4: The repair uses the exact task binding from `arbiter worktree open` (or a supported fresh worktree-rooted session resuming the persisted native task). It does not guess the latest shared-log worktree, weaken the hard hooks, or modify unrelated #2493/#2564/#2567/#2503 contracts.
- [ ] AC-2685.5: Continue the integration drill through an implementation phase and completed agent/gate notification. The transcript path, session identity and task root satisfy the current transcript validator. Reusing a main-project session UUID from the worktree is an explicit inverse case; it must be rejected before costly dispatch or recovered through a proven host mechanism, without disabling hooks or repeating accepted reviews.
- [ ] AC-2687.1: Starting from a native task with genuine completed reviewer/AC-fit returns, the supported host path can persist the required dispatch and AC-fit records and pass native review/acceptance admission without repeating completed reviewers solely to change output format.
- [ ] AC-2687.2: Recording validates the actual task, subject and required verdict coverage; missing, malformed, wrong-task or unsupported provenance remains rejected. Reuse or extend an existing native producer where it fits; do not replace an evidence requirement with a synthetic PASS.
- [ ] AC-2687.3: A real run on the supported auto-mode host demonstrates the sanctioned producer is admitted. Unit tests of repository hooks alone do not qualify the host approval layer. If host approval remains necessary, it is surfaced as a precise pending action before costly repeated verification, and recovery resumes the existing task.
- [ ] AC-2687.4: Host denial, missing data and malformed return have distinguishable outcomes. No broad permission relaxation, disabled hook, delegated denied write or false completion is used as recovery.
- [ ] AC-2687.5: The current `/ship` instructions point to one validated producer path per record. Remove a replaced inline writer only when its ownership, atomicity and anti-symlink guarantees are preserved; record concepts/mechanisms and real review cost before/after.
- [ ] AC-2687.6: A declared reviewer panel without one current, supported-provenance return envelope per named seat is rejected before the sidecar changes; AC-fit without a current verifier envelope or with a changed plan hash is rejected before its prior valid artifact changes.

## Non-Goals

- No generic harness, graph or loop runtime, evidence framework/store, scheduler, second orchestrator, permission preset, hook disablement, or reviewer panel.
- No change to finding-loss artifact classes, reviewer counts, worktree cleanup policy, task phase semantics, or human-approval policy machinery.
- No claim that a unit/render test alone proves Claude Code auto-mode admission.

## Test strategy

- Unit/empirical hook tests: RED on parent-root and transcript mismatch; GREEN only for the exact task worktree/session tuple, including ambiguous multiple-slug and completed-notification cases.
- Script tests: RED for malformed, wrong-task, stale-subject, unavailable Git identity, plan-drift, router/count mismatch, missing provenance/citations, incomplete-panel, incomplete/non-PASS AC coverage, custom output escape, and symlink paths; GREEN for one router-derived roster and task-keyed fit record. Changing one verdict or citation while retaining the otherwise-valid verifier envelope, task, SHA, and plan hash must be rejected without replacing prior evidence; mutation of the recorded source envelope or frozen plan must turn the consumer RED.
- Render tests: self/template bytes and generated commands name only the sanctioned producers.
- Product proof: from main, run `claude -p --permission-mode auto --output-format json` with a bounded prompt that calls `arbiter worktree open --json`, attempts `arbiter task host-preflight`, and reports the expected refusal. From the exact returned worktree run `claude -p --resume <main-session-id> --fork-session --permission-mode auto --output-format json` with the same bounded task; require a new session id/project transcript, successful host-preflight, actual Agent dispatch/return, both producer modes, `check-review-completion`, `check-acceptance`, and task-local Stop observation. Capture exit classes and paths in `.arbiter/evidence/native-host/2685-2687.json`; the inverse retains a main-root note and still blocks.

## Risks

- Claude may not rebind a resumed conversation across project roots even with `--fork-session`; mitigation is a bounded real-host probe before claiming the route, with fail-closed instructions if unsupported.
- The shared worktree log permits multiple slugs per task; mitigation is exact-path matching and an ambiguity error, never recency.
- Adding subject fields only at the producer can leave legacy hand-written AC-fit weak; mitigation is late-phase consumer enforcement for active tasks while direct historical/wave validation retains compatibility.
- Refactoring transcript validation can weaken the existing phase hook; mitigation is keeping every current inverse test and adding parity cases before replacing local logic.

## Verification and measures

- Focused RED/GREEN tests for hooks, recorder, acceptance, command rendering, and template parity.
- Frozen-HEAD independent review and AC-fit over the same SHA; one final L2 gate, PR CI, exact-SHA merge, then post-merge validation.
- Record `stale_head_reviews`, repeated reviewer calls, inline writer LOC, producer calls accepted/denied, review duration, contract rework, and gate duration. Quality must retain every existing hard hook, evidence consumer, and exact-subject check.

## Anti-bloat accounting

- Concepts before/after: host handoff + dispatch record + AC-fit / unchanged.
- Authorities before/after: duplicated transcript checks and inline writer / shared transcript predicate and one existing producer.
- New mechanisms: no new orchestrator, store, framework, or dependency; only two modes on the current producer and an earlier invocation of the canonical hook guard.
- Removed mechanisms: inline reviewer-sidecar heredoc and raw AC-fit write instruction.
- Guarantees: exact worktree/session binding and exact-subject fit admission increase; none intentionally lost.
