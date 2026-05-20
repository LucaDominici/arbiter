---
title: 'Recipe: Adopting arbiter in a Monorepo'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: []
---

# Recipe: Adopting arbiter in a Monorepo

**Issue:** #645

## Context

Multi-package repositories add complexity: shared lockfiles, workspace-relative paths, and lint config inheritance all affect how arbiter gates propagate. This recipe covers three patterns.

## Pattern 1: Root-Level arbiter

One `AGENTS.md` at repo root. One gate command. All packages share the same invariants.

**Best when:** All packages share a language, toolchain, and governance rules.

```bash
# Init at root
cd my-monorepo
arbiter init

# Gate runs across all packages
node scripts/check-all.mjs L1
```

**Gotcha:** Root-level `check-all.mjs` must aggregate test results from all workspaces. If your test runner is workspace-aware (Turborepo, nx), wire arbiter's gate command to call the workspace runner:

```json
// package.json (root)
{
  "scripts": {
    "test": "turbo run test",
    "gate:l1": "node scripts/check-all.mjs L1"
  }
}
```

## Pattern 2: Per-Package arbiter

Each package has its own `AGENTS.md`, `.claude/settings.json`, and gate. Packages are governed independently.

**Best when:** Packages have different languages, frameworks, or governance requirements.

```bash
# Init each package separately
cd packages/api
arbiter init

cd ../web
arbiter init
```

**Gotcha:** Hooks in `.claude/settings.json` reference paths relative to the project root where Claude Code is opened. If Claude Code is opened at the monorepo root, per-package hook paths must be absolute or use `${workspaceRoot}` variables.

**Gotcha:** Each package gets its own `node_modules/` symlinks if using pnpm hoisting. Check that `arbiter` resolves correctly from within each package:

```bash
cd packages/api && npx arbiter doctor
```

## Pattern 3: Hybrid (Shared INVs + Per-Package Gates)

One root `AGENTS.md` defines shared invariants. Each package has its own gate that runs only local tests but references root invariants.

**Best when:** Teams want consistent governance rules but independent CI jobs per package.

```
my-monorepo/
  AGENTS.md          ← shared invariants
  packages/
    api/
      .claude/
        settings.json  ← hooks wired to local package
    web/
      .claude/
        settings.json
```

The root `AGENTS.md` is referenced by package-level settings via `@../../AGENTS.md` import (Claude Code `@` directive).

## Worked Examples

### turborepo

```bash
# Turbo pipeline: arbiter gate as a pipeline step
# turbo.json
{
  "pipeline": {
    "gate:l1": {
      "dependsOn": ["^gate:l1"],
      "outputs": []
    }
  }
}
```

```bash
turbo run gate:l1 --filter=./packages/api
```

### nx

```bash
# project.json (per package)
{
  "targets": {
    "gate": {
      "executor": "@nx/js:node",
      "options": {
        "main": "scripts/check-all.mjs",
        "args": ["L1"]
      }
    }
  }
}
```

### pnpm workspaces

```bash
# pnpm-workspace.yaml defines packages
# Run gate across all workspaces:
pnpm -r run gate:l1
```

## Decision Matrix

| Scenario                           | Recommended pattern  |
| ---------------------------------- | -------------------- |
| All packages same language + stack | Root-level           |
| Packages have different languages  | Per-package          |
| Shared rules, independent CI jobs  | Hybrid               |
| Single team owns all packages      | Root-level or Hybrid |
| Multiple independent teams         | Per-package          |

## Gotchas

- **Workspace-relative paths in hooks**: Hooks execute in the context of the directory where Claude Code is running. Use `process.env.INIT_CWD` or `__dirname` to construct absolute paths inside hook scripts.
- **Shared lockfiles**: `pnpm-lock.yaml` and `package-lock.json` are shared. Do not let per-package arbiter init overwrite root lockfile by accident. Always run `arbiter init` with `--dir packages/<name>` to target a subdirectory.
- **Lint config inheritance**: Per-package `.eslintrc` may extend root config. Ensure arbiter's generated lint step uses the correct config path for each package.
- **Coverage thresholds**: Root-level coverage aggregation can mask low-coverage packages. Set per-package thresholds in each `vitest.config.ts` or equivalent.
