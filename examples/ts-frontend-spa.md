---
title: 'Example: ts-frontend-spa'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Example: ts-frontend-spa

End-to-end walkthrough of `arbiter init` on a TypeScript + React single-page-app starter. The starter mirrors the reference fixture at `__tests__/fixtures/real-projects/ts-frontend-spa/`.

## 1. Starter project (before `arbiter init`)

A minimal Vite + React + TypeScript skeleton. The manifest declares the project as a `frontend-spa` archetype detected automatically from the `react` dependency.

```
ts-frontend-spa/
├── package.json          # react, react-dom, typescript, vitest, prettier, eslint
├── tsconfig.json
├── manifest.json         # { language: "typescript", archetype: "frontend-spa", levels: ["L1","L2","L3"] }
└── src/
    ├── index.ts
    └── index.test.ts
```

`package.json` (reference shape):

```json
{
  "name": "ts-frontend-fixture",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "format": "prettier --check ."
  },
  "dependencies": { "react": "^18.2.0", "react-dom": "^18.2.0" },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.4.0",
    "prettier": "^3.2.0",
    "eslint": "^8.57.0"
  }
}
```

## 2. Run `arbiter init`

```bash
npx @arbiter/cli init \
  --dir ./ts-frontend-spa \
  --tools claude \
  --level L2
```

Arbiter detects the archetype automatically. To override, pass `--archetype frontend-spa --language typescript`.

## 3. Generated artifacts

Grouped by purpose. Exact filenames are produced by `src/generators/` and the templates under `src/templates/typescript/frontend-spa/`.

**Governance contract**

- `AGENTS.md` — canonical AI-agent rules, invariants, gate command.
- `arbiter.json` — installer-level config (governance level, tools, archetype, options).
- `.arbiter-generated.json` — manifest of every file arbiter emitted (used by `arbiter ratchet` and update flows).

**Gate scripts**

- `scripts/check-all.mjs` — orchestrator (L1 / L2 / L3).
- `scripts/check-bloat-ratchet.mjs`, `scripts/check-no-orphan-todo.mjs`, `scripts/check-no-any.mjs`, and other invariant-specific check scripts referenced by `check-all.mjs`.

**Git hooks**

- `.githooks/pre-commit` — runs `node scripts/check-all.mjs L1`.
- `.githooks/pre-push` — runs `node scripts/check-all.mjs L2`.

**AI-tool configs (Claude Code, because `--tools claude`)**

- `.claude/CLAUDE.md` — thin pointer to AGENTS.md.
- `.claude/settings.json` — hook wiring.
- `.claude/hooks/check-no-any.mjs`, `check-no-orphan-todo.mjs`, `check-no-direct-spawn.mjs`, `pre-edit-ssot-guard.mjs`, `pre-edit-plan-anchor.mjs`, `stop-dangerous.mjs`, `enforce-read-only.mjs`, `guard-task-completion.mjs`, `post-commit-check.mjs`, `pre-compact.mjs`.
- `.claude/rules/*.md` — always-loaded rules (canon enforcement, TODO policy, refactor-first, exec protocol).

**CI**

- `.github/workflows/ci.yml` — runs `node scripts/check-all.mjs L2` on every PR.
- `.github/workflows/codeql.yml` (L2+) — security scanning.

**Tooling configs**

- `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `commitlint.config.js`, `.editorconfig`, `.gitleaks.toml`.
- `tsconfig.json` is patched to include `"types": ["node"]` (TS6 migration requirement) without overwriting user-defined options.

**Templates and docs**

- `docs/SYSTEM/DECISIONS.md` — empty ADR scaffold.
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (L2+) — thin pointers.

## 4. Run the gate

```bash
npm install                       # installs hooks via the prepare script
node scripts/check-all.mjs L1     # fast: lint + format + typecheck + unit tests
node scripts/check-all.mjs L2     # full: L1 + coverage thresholds + integration + security
```

L1 should complete in under a minute on the starter. L2 adds coverage checks and the security scan.

## 5. See the enforcement chain fire

Open `src/index.ts` in Claude Code and add an `any`:

```ts
export function double(x: any): number {
  return x * 2
}
```

The `check-no-any.mjs` hook fires on save and rejects the edit before the file is written to disk (INV-04). The fix is to use `number` or `unknown` with a runtime check.

Now bypass the editor and write the same code directly to disk, then `git commit`:

```bash
git add src/index.ts
git commit -m "feat: double"
```

The pre-commit hook runs the L1 gate, which re-runs the same invariant check via `scripts/check-no-any.mjs`. The commit is rejected. You cannot bypass with `--no-verify` because that flag is blocked by hook policy.

## 6. Typical follow-up edits

- Add a new component under `src/`. The `pre-edit-plan-anchor.mjs` hook requires an active plan when in `implementation` phase; advance the task lifecycle with `arbiter task advance --to implementation`.
- Add an ADR for any architectural shift in `docs/SYSTEM/DECISIONS.md`.
- Promote stack support to `proven` in the matrix only after adding a real-project fixture (CANON-02 / INV-32).
