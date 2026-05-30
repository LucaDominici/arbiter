# ADR-005 — `arbiter diff` manifest must match `arbiter update` scope

> **Status**: Draft (Claude) · **Date**: 2026-05-26 · **Reviewer**: Luca
> **Maps to**: Wave 0 findings **F1** (89% under-reporting) + **F7** (diff lies in both directions, before and after update)
> **Evidence**: [`../wave0/haben-smoke-test.md`](../wave0/haben-smoke-test.md) §F1 §F7 · [`../wave0/evidence/haben-diff.txt`](../wave0/evidence/haben-diff.txt) · [`../wave0/evidence/haben-update-1st.txt`](../wave0/evidence/haben-update-1st.txt) · [`../wave0/evidence/haben-diff-after.txt`](../wave0/evidence/haben-diff-after.txt)

## Problem

`arbiter diff` announces 4 files. `arbiter update` then touches 37 files (11 backed-up + 26 silently-created). After `update`, `diff` says "All files up to date" — but a second `update` still re-touches 37. The diff/apply contract is broken in both directions.

Today's `diff` appears to enumerate only the top-level SSOT set (`AGENTS.md`, `GLOBAL_INVARIANTS.md`, `.claude/CLAUDE.md`, `.agents/CODEX.md`), ignoring the rest of the template manifest: workflows, hooks, scripts, actions, codex config, settings.json.

## Code anchors

- `src/commands/diff.ts` — entry point for the `diff` command
- `src/config/diff.ts` — `ConfigDiff` interface, `AXIS_FIELDS` set
- `src/commands/update.ts` — what update *actually* touches (this is the ground truth)
- `src/generators/*.ts` — the manifest is implicitly the union of generators' outputs

Grep target: in the chat, find where `diff.ts` computes the file list and compare to where `update.ts` writes. Likely there's an explicit allow-list in `diff.ts` ("show only these 4") that diverged from the implicit one in `update.ts` ("write whatever generators emit").

## Why this is architectural (last in sequence)

This fix requires F10 (templates-pass-L1, ADR-004) to be stable first because:
- The manifest that `diff` must enumerate is the same one `update` produces
- If templates are still changing in F10, the manifest is moving
- Aligning a moving target wastes effort

Conceptually: `update` is the canonical "what arbiter does"; `diff` should be a pure projection of it ("what arbiter *would* do, without doing it"). Same code path, different terminal action.

## Options considered

**Option A — Hand-maintain a manifest in `diff.ts`**
- Add the missing 33 files to the diff allow-list.
- Pro: smallest diff.
- Con: drifts the moment a new generator or template is added. Same root cause repeats.

**Option B — Compute manifest from generators (RECOMMENDED)**
- Refactor: each generator declares an interface like `getFilesToWrite(config): { path, action: 'create'|'replace'|'skip' }[]`. Both `diff` and `update` consume this; `diff` just prints, `update` writes.
- Pro: structural correctness. Diff can never drift.
- Con: refactor across many generators. Larger PR.

**Option C — Inverse: `diff` calls `update --dry-run`**
- Add a `--dry-run` flag to `update` that does everything except final write. `diff` becomes `update --dry-run --format=summary`.
- Pro: literally no possibility of divergence.
- Con: `update` is the dangerous command; even in dry-run mode, accidental partial writes (e.g., side-effects in generators that prepare temp dirs) are a risk.

## Recommended: Option B (manifest contract)

Introduce a `Manifest` type and a `getManifest(config)` function. Each generator exports a `getManifest(config)` method. The top-level `runUpdate(config)` calls each generator's `getManifest`, unions, then applies. `runDiff(config)` calls the same union, formats, prints. Both consume the same data; neither can drift from the other.

Sketch:

```ts
// src/generators/manifest.ts (new)
export type ManifestEntry = {
  path: string
  action: 'create' | 'replace' | 'skip'  // vs current state
  reason?: string
  remoteSideEffect?: 'gh-label' | 'gh-project' | 'gh-branch-protection'  // for ADR-001 binding
}

export interface Generator {
  key: GeneratorKey
  getManifest(config: ArbiterConfigV2, projectRoot: string): Promise<ManifestEntry[]>
  apply(entries: ManifestEntry[]): Promise<void>
}
```

`diff` prints entries grouped by action; `update` filters by `action !== 'skip'` and applies. Same single source of truth.

Bind with ADR-001: `remoteSideEffect` field lets `diff` enumerate remote operations the user would consent to.

## Test plan

- Property: for every `(config, repo-state)` fixture, `getManifest()` called twice returns identical entries (deterministic).
- Integration: after `arbiter update`, a subsequent `arbiter diff` returns zero entries (or all `action: 'skip'`).
- Integration: `arbiter diff` then `arbiter update`: the set of files actually touched by `update` ⊆ the set announced by `diff` (subset rule, never superset).
- Regression: add a "Wave 0 reproducer" test that fails before this ADR ships and passes after.

## File impact survey

| File | Change |
|---|---|
| `src/generators/manifest.ts` (new) | Manifest types + Generator interface |
| `src/generators/*.ts` (≈10 files) | Each implements `getManifest(config, root)` |
| `src/commands/diff.ts` | Consumes manifest, prints |
| `src/commands/update.ts` | Consumes manifest, applies |
| `src/config/diff.ts` | Likely renamed or removed (this is the AXIS_FIELDS / file allow-list that diverged) |
| `__tests__/generators/manifest.test.ts` (new) | Determinism + diff-update parity |
| `__tests__/integration/wave0-reproducer.test.ts` (new) | Regression for F1+F7 |

CANON-16: this is a refactor, not a green-field. Survey existing `diff.ts` + `update.ts` to identify the shared logic that should move to manifest, vs. command-specific (formatting, user prompts).

## Acceptance criteria

- [ ] `arbiter diff` and `arbiter update` enumerate the same file set for any given (config, repo-state)
- [ ] After `arbiter update`, `arbiter diff` reports zero entries with `action: 'create' | 'replace'`
- [ ] Two consecutive `arbiter update` runs touch zero files on the second run (resolves F6 idempotence as a side effect)
- [ ] `arbiter diff --json` includes `remoteSideEffect` field for each entry that would call gh (binds with ADR-001)
- [ ] L1 + L2 green
- [ ] Reviewed by Claude

## Open questions

1. Does the existing `notary/delta.ts` (also matches "delta" grep) already partially do this? Survey before duplicating.
2. Should `getManifest` be sync or async? Async is more flexible (e.g., generators that read existing files), suggest async.
3. Should we deprecate `--json` shape changes in this PR or maintain backward compat? Both `diff --json` and `update --json` consumers might exist (likely just Luca; check).
4. F6 (idempotence) and this ADR overlap. If F6 turns out to be partially solved by this work, mark F6 closed in MILESTONES at PR-merge time.
