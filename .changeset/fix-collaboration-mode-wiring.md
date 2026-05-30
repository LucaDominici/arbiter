---
'@arbiter/cli': minor
---

fix(#1119): wire collaborationMode end-to-end — solo/small-team ceremony

**Problem (before this PR):**

- `task.md.ejs` hardcoded `gh pr merge --squash` + full PR ceremony for ALL modes
- `resolveDefaultMergeMode` / `resolveDefaultWorktreeMode` had zero callers
- `buildRenderContext` (claude.ts) never injected resolved `mergeMode`/`branchingStrategy`
- `configure --set collaborationMode=garbage` accepted any string (no enum validation)
- No `--solo` CLI flag; wizard asked deprecated `soloDevMode` boolean, not a 3-way prompt
- Five duplicated inline derivations of `collaborationMode` from `soloDevMode`

**Changes:**

- **Single derivation source:** `resolveCollaborationMode` + `resolveCollaborationAxes` added to
  `collaboration-mode-defaults.ts`; replaces 5 inline copies. The dead resolvers
  (`resolveDefaultMergeMode`, `resolveDefaultWorktreeMode`) are now called from here.

- **`task.md.ejs` mode-aware:**
  - Phase 10 keyed on `mergeMode`: `direct` → no PR (commit+push to trunk);
    `pr-ff` → `gh pr create` + `gh pr merge --merge` (ff). **`--squash` removed** (ADR-051).
  - Phase 0 branch-guard: for `direct` mode, "HARD STOP on main" becomes a confirmation (trunk-solo
    allows working directly on trunk).
  - Review ceremony: `trunk-solo` → 1 self-review agent; `peer-review`/`gated-review` → tier counts.

- **`CLAUDE.md.ejs`:** adds Quick Reference row showing collaboration mode, merge method, branching.

- **`--solo` CLI flag** (`arbiter init --solo`): sets `collaborationMode='trunk-solo'`.

- **Wizard 3-way prompt:** replaces the deprecated `soloDevMode` confirm with a
  `trunk-solo | peer-review | gated-review` list. `collaborationMode` persisted to config (not discarded).

- **`configure` enum validation:** `collaborationMode`, `solo.mergeMode`, and `branchingStrategy`
  are now validated with `E_INVALID_ARCHETYPE` errors. `solo.mergeMode` and `branchingStrategy` added
  to `ALLOWED_PATHS`.

- **`ArbiterConfigV2`** gains `solo?: { mergeMode: SoloMergeMode }` and `branchingStrategy?`.
  Both are round-tripped through init/configure/update.

- **`diff.ts` PATH_TO_KEYS:** `collaborationMode` now triggers `claude` generator (task.md/CLAUDE.md
  regeneration on `arbiter update`); `solo.mergeMode` and `branchingStrategy` added.

- **Design invariant (prevents idempotence bugs):** only `collaborationMode` + explicit user overrides
  (`solo.mergeMode`, `branchingStrategy`) are persisted; all derived values (mergeMode, worktreeMode,
  pipelineStyle) are recomputed at render time by `resolveCollaborationAxes`.

- **Dogfood:** arbiter's own `arbiter.json` gets `solo: { mergeMode: 'pr-ff' }` so its trunk-solo
  self-config keeps the PR+ff workflow (branch protection requires PRs).

**Blast radius:**

- Template output changes for all projects on next `arbiter update` (squash→ff for PR modes; mode-gated
  review ceremony). Existing `task.md` files use `skipIfExists` and are NOT automatically rewritten —
  users can delete and re-init or run `arbiter update` after deleting the file.
- `features.soloDevMode` is still WRITTEN (back-compat) but the wizard no longer asks for it directly;
  `collaborationMode` is now the authoritative field.
