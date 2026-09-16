---
files:
  - .claude/plans/task-2564-native-checkout-adoption.md
  - .claude/hooks/lib.mjs
  - .claude/hooks/post-subagent-release.mjs
  - .claude/hooks/pre-spawn-worktree-guard.mjs
  - __tests__/commands/worktree.test.ts
  - __tests__/commands/task-host-preflight.test.ts
  - __tests__/hooks/empirical/pre-spawn-worktree-guard.test.ts
  - __tests__/integration/worktree-adopt.test.ts
  - __tests__/worktree/links.test.ts
  - examples/go-library/.arbiter-generated-manifest.json
  - examples/go-library/.claude/hooks/lib.mjs
  - examples/go-library/.claude/hooks/post-subagent-release.mjs
  - examples/go-library/.claude/hooks/pre-spawn-worktree-guard.mjs
  - examples/python-library/.arbiter-generated-manifest.json
  - examples/python-library/.claude/hooks/lib.mjs
  - examples/python-library/.claude/hooks/post-subagent-release.mjs
  - examples/python-library/.claude/hooks/pre-spawn-worktree-guard.mjs
  - examples/ts-library/.arbiter-generated-manifest.json
  - examples/ts-library/.claude/hooks/lib.mjs
  - examples/ts-library/.claude/hooks/post-subagent-release.mjs
  - examples/ts-library/.claude/hooks/pre-spawn-worktree-guard.mjs
  - packages/kernel/hooks/lib.mjs
  - src/cli.ts
  - src/commands/worktree.ts
  - src/commands/task-state.ts
  - src/commands/task.ts
  - src/templates/claude/hooks/lib.mjs.ejs
  - src/templates/claude/hooks/post-subagent-release.mjs
  - src/templates/claude/hooks/pre-spawn-worktree-guard.mjs
  - src/worktree/links.ts
  - website/reference/cli.md
---

# Plan — #2564 Adopt native checkouts and admit local resources safely

## Context Block

- base_branch: `origin/main`
- baseline: `7c97089cf12a1aad8a322111b48dd44d8d7d594c`
- key_constraints: native hosts create and clean checkouts; Arbiter only adopts, prepares, binds and invalidates; reuse current worktree log, link policy, task host binding and locks; one writer; no new lifecycle, store or scheduler.
- red_team_warnings: detached HEAD must become an explicit task branch; stale logs must never authorize removal; a path-name heuristic is not checkout proof; concurrent sidecar writers must not lose entries; required resources and unsupported locking fail closed.
- estimate: one delivery candidate, one independent final review/AC-fit packet, one final full gate.
- files: see frontmatter; generated/materialized twins only when current generators require them.

## Approach

1. Add `worktree adopt` as the default native-host path beside the existing manual fallback. Resolve the checkout through Git inventory, convert a detached checkout to the deterministic task branch, materialize the existing link policy and atomically replace the task's open-log binding. Every adoption mints a new binding identity.
2. Make close/prune corroborate log identity with live Git inventory before any destructive action. Add an all-worktree list view for #2442 without changing the default task-focused view.
3. Replace the spawn guard's directory-name heuristic with Git's own worktree identity. Serialize both sidecar producers through one portable exclusive-file contract with dead-owner recovery; a live or unverifiable owner blocks admission instead of losing state. The separate gate-execution mutex remains owned by #2517.
4. Make task host binding Git-native with optional Claude transcript attestation. Task init and every phase transition corroborate the binding identity against the authoritative adoption row, so a handoff or re-adoption invalidates prior task state and its dependent review/acceptance path.
5. Preserve `symlink-children`, optional build links, required/optional resources, dangling diagnostics and cache isolation in real filesystem fixtures.

## Acceptance Criteria

- [ ] AC-1: Claude-native, Codex detached-to-branch and manual worktrees are adopted from live Git inventory and logged exactly once.
- [ ] AC-2: required/optional files, local-library links, `symlink-children`, cache isolation, optional build links and dangling targets use the existing policy and real filesystem behavior.
- [ ] AC-3: writer admission and the sidecar writers share one atomic lock; unavailable/busy locking fails closed with an actionable result.
- [ ] AC-4: re-adoption or branch/path handoff changes the binding identity; stale task state cannot initialize, advance, record review, or accept evidence until rebound.
- [ ] AC-5: stale or mismatched open logs cannot authorize close/prune; all-worktree inventory exposes non-task and detached checkouts.
- [ ] AC-6: the supported path has no Claude-specific pre-spawn requirement; Git identity works for any native host.

## Verification

Write the real checkout/guard inversions first, then implement the smallest shared owners. Run focused worktree, hook and template tests during edits; exercise adoption against a real temporary repository; freeze one candidate for independent review and AC-fit; run one final L3, PR CI, merge and post-merge CI.

## Non-Goals

- Native-host checkout creation or cleanup ownership. Existing Arbiter `open`/`close` remains only the manual fallback for hosts without checkout support and uses the same log/resource contract.
- A generic resource manager, scheduler, or new evidence store.
- Automatic pruning policy or changes to unrelated task/evidence schemas.
