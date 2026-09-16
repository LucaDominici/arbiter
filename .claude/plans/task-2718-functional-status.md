---
context:
  issue: '#2718'
  type: experiment
  pipeline: 'runtime qualification → red → green → comparison → independent review → verification → PR'
  branch_convention: 'task/#2718-functional-status'
  base_branch: 'main @ cb8b8499a5512b7eac9401bb4fa0d04fbb475606'
  key_constraints:
    - 'Use one optional module in the existing kernel plugin; add no second plugin, orchestrator, status authority or evidence store.'
    - 'Call only the installed Arbiter CLI with fixed argv and the session cwd; never read or migrate lifecycle/task state.'
    - 'Default off and fail open to the ordinary prompt/CLI path on every unavailable, malformed, timeout or aborted condition.'
    - 'Preserve every existing command hook, TDD, exact-subject, review, acceptance and landing guarantee.'
    - 'Ship only if measured against native Claude shell mode and demonstrably useful; otherwise remove the candidate.'
  red_team_warnings:
    - 'Claude Code function hooks are version- and rollout-dependent; source inspection is not runtime qualification.'
    - 'A prompt drop before successful validated output can silently eat the user request.'
    - 'Method status describes configured/emitted wiring, not exercised runtime behavior or product acceptance.'
    - 'Native ! shell mode already avoids a model turn, so zero-model execution is not a novel benefit.'
  estimate: 'Standard (host-specific runtime qualification, opt-in config, packaged plugin proof and measured go/no-go)'
files:
  - src/templates/claude/hooks/functional-status.ts
  - scripts/build-kernel-plugin.mjs
  - packages/kernel/hooks/functional-status.ts
  - packages/kernel/hooks/hooks.json
  - src/config/schema.ts
  - src/commands/settings.ts
  - src/commands/configure.ts
  - src/commands/configure-interactive.ts
  - src/commands/method.ts
  - __tests__/hooks/functional-status.test.ts
  - packages/kernel/README.md
  - docs/internal/SYSTEM/HOOK-CONTRACTS.md
  - .claude/plans/task-2718-functional-status.md
  - .arbiter/evidence/tdd/#2718.json
  - .arbiter/evidence/benchmark/#2718.json
---

# #2718 — Qualify an opt-in functional status adapter

## Outcome

One exact, explicit status request may use an optional Claude function hook to display the existing read-only `arbiter method status` result without a model turn or retaining the full report in later model context. The adapter ships only if Claude Code 2.1.271 runtime proof and a same-subject comparison show value over native `! arbiter method status`.

## Existing ownership

- `runMethodStatus` remains the sole status owner and its `wired`, `partial`, `unverified` and `off` meanings remain unchanged.
- The kernel plugin remains the sole Claude plugin artifact; the function module coexists with its existing command hooks.
- The settings catalog, resolver and configure writer remain the sole configuration path.
- #2706 owns the eventual atomic public `status` vocabulary. This pilot adds no CLI alias and must move atomically when that owner lands.
- #2677 owns installed-package proof. This slice records its proof in existing evidence paths without closing either parent issue.

## Go / no-go checkpoints

1. Generate types from the installed Claude Code 2.1.271 runtime in the isolated worktree and validate the module API. Do not copy upstream snippets.
2. Run a network-denied native probe from a temporary plugin directory. Prove module load, exact trigger, visible output, coexistence with command hooks, fallback and before/after filesystem identity. Do not modify global settings.
3. If load/trigger/output cannot be proven, record `UNSUPPORTED` and close the experiment without product surface.
4. If runtime qualification passes, implement the smallest adapter and opt-in through the existing owners.
5. Compare agent-mediated status, native `!` shell mode and the adapter over the same subject. Ship only on correct output, zero mutations, zero false acceptance and measurable value beyond native shell mode.

## Acceptance Criteria

- [ ] AC-1: Claude Code 2.1.271-generated types and a native isolated probe prove module loading, exact-trigger consumption, visible output, command-hook coexistence, interactive/headless behavior and zero project mutation; unsupported cells remain explicit.
- [ ] AC-2: Only the exact request is eligible. Near matches, extra text, plugin-origin prompts and unrelated requests pass through. Absent or false opt-in never consumes.
- [ ] AC-3: The adapter drops a prompt only after successful fixed-argv read-only execution and validated output. Missing CLI, nonzero exit, malformed/truncated output, timeout or abort cannot emit success.
- [ ] AC-4: Existing method-status distinctions remain intact and are never promoted to runtime or product acceptance.
- [ ] AC-5: Kernel source/package parity and installed-package tests prove the module ships while every existing command guard remains present and effective.
- [ ] AC-6: A same-subject three-run comparison reports model dispatches, retained output size where observable, process count and median/range latency for agent-mediated status, native shell mode and the adapter. Missing token data is `NO DATA`.
- [ ] AC-7: The feature is default-off and retained only if it shows measurable value over native shell mode. Otherwise no module or configuration surface remains.

## TDD seams

The approved public seams are:

1. The function-hook event/result boundary: exact request, opt-in and process outcome decide pass-through versus one successful drop.
2. The existing `arbiter method status --json` CLI boundary: the adapter validates and displays its existing result without reinterpreting product truth.
3. The kernel package boundary: build output contains one module alongside unchanged command hooks.
4. The installed runtime boundary: an isolated 2.1.271 probe demonstrates actual load, trigger, fallback and no mutation.

Work in vertical RED/GREEN slices. Do not test private helper shapes or mock the decision itself.

## Verification and measurement

- Record genuine RED evidence before implementation.
- Targeted unit/contract tests cover exact match, pass-through, disabled config, CLI failure, invalid output, timeout and cwd freshness.
- Kernel build/parity and installed-package tests cover distribution and coexistence.
- The native probe records runtime version, plugin digest, command invocation, output, exit classification and filesystem hashes in the existing benchmark evidence store.
- Final reviewers inspect the same frozen SHA; one full final gate follows.

## Non-goals

No command-hook migration, lifecycle advancement, recovery change, preflight duplication, shell rewrite, background process, dashboard, transcript mining, global installation, timer/store, remote telemetry or new framework.
