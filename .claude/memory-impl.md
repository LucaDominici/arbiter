---
globs:
  - 'src/**/*.ts'
  - 'src/**/*.tsx'
  - 'scripts/**/*.mjs'
  - '.claude/hooks/**/*.mjs'
last-reviewed: '2026-05-17'
title: 'Arbiter implementation gotchas'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Arbiter implementation gotchas

- No `any` types anywhere in `src/` — INV-04 enforced by post-edit hook; type-cast through `unknown` instead.
- No direct `child_process` in `src/**/*.ts` — use `runCli` wrapper from `src/utils/run-cli.ts` (INV-12). Scripts and hooks under `scripts/` and `.claude/hooks/` are exempt.
- No orphan TODOs — every `TODO` must cite a task ID: `TODO(#NNN): description` (INV-06).
- `materializeLink` in `src/worktree/links.ts` must check `lstatSync(dest).isSymbolicLink()` before treating an existing dest as already-linked — non-symlink at dest must throw, not silently pass.
- Vitest worktree path hack: if running from a path containing `#`, set `VITEST_ROOT=/tmp/wt-<branch>` (symlink) to avoid URL fragment parse error.
- Hook tests use `spawnSync('node', [HOOK], { cwd: tmpDir, env: { CLAUDE_TOOL_INPUT_PATH: ... } })` — do NOT use `exec` or shell expansion.
- `minimatch` v10+ requires bare import `'minimatch'` (not a relative path); it's a direct dep in `package.json`.
- stdin in hooks/scripts read via `readFileSync(0, 'utf-8')` (fd 0), NOT `/dev/stdin` — the latter fails with ENXIO under `spawnSync` with `input:`.
- `arbiter task advance` must be called at each phase transition — skipping it means the local state file diverges from the expected phase.
- CANON-10: every new hook entry in `settings.json` must also appear in the hooks table in `.claude/CLAUDE.md`.
