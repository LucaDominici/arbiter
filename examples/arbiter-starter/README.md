---
title: 'arbiter-starter'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# arbiter-starter

A minimal TypeScript skeleton that demonstrates running `arbiter init` from scratch. Use this as a reference for the "zero to governed" flow.

## What this is

`arbiter-starter` is the local fixture backing the "Try it now" Codespaces flow. It represents the state of a project _before_ `arbiter init` runs: a bare TypeScript module with a test, no governance tooling.

## Layout (before `arbiter init`)

```
arbiter-starter/
├── package.json          # bare TypeScript + vitest
├── tsconfig.json
└── src/
    ├── index.ts
    └── index.test.ts
```

## Run `arbiter init` in Codespaces

1. Open this repository in a GitHub Codespace (Node 22 + gh CLI pre-installed via `.devcontainer/`).
2. Navigate to this folder:

   ```bash
   cd examples/arbiter-starter
   npm install
   ```

3. Run arbiter from the workspace root:

   ```bash
   npx @arbiter/cli init --dir . --tools claude --level L1
   ```

4. Inspect what was generated:

   ```bash
   ls -la
   cat AGENTS.md
   node scripts/check-all.mjs L1
   ```

## Stackblitz feasibility

Investigated during #541. Conclusion: **not yet viable** for a CLI tool at this stage.

Stackblitz WebContainers run in-browser and do not support filesystem hooks (`.githooks/`, `core.hooksPath`), which arbiter requires for enforcement. The generated hook scripts would be present but would never fire. Users would see the files but not experience enforcement — a misleading demo.

**Decision:** Codespaces (via `.devcontainer/devcontainer.json` in repo root) is the recommended zero-install path.

## package.json

```json
{
  "name": "arbiter-starter",
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```
