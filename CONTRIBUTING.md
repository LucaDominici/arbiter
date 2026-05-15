# Contributing to arbiter

Thank you for considering contributing to **arbiter**. This document is the on-ramp for new contributors. Read it once end to end before opening your first PR.

arbiter is distributed under the [Apache License 2.0](./LICENSE). All contributors agree to the [Code of Conduct](./CODE_OF_CONDUCT.md).

---

## 1. Mental Model

arbiter is a governance framework installer. One sentence: it generates a deterministic, opinionated quality-gate stack (lint, format, test, type-check, architecture, security, AI-agent rules) into target projects, then enforces those rules through edit-time hooks and pre-commit / pre-push / CI gates.

Architecture in three sentences:

1. **Detectors** inspect a target project and classify it by language, archetype, and build tool (`src/detectors/`).
2. **Generators** translate that classification into a set of artifacts: gate scripts, hook scripts, AI-tool configs, CI workflows (`src/generators/`).
3. **Templates** are EJS-rendered files that the generators emit (`src/templates/`).

Everything else — invariants, plugins, the matrix, the CLI surface — exists to make detection deterministic and emission reproducible.

The canonical governance contract lives in [`AGENTS.md`](./AGENTS.md). Every other doc is a thin pointer to it. See [`docs/SYSTEM/DECISIONS.md`](./docs/SYSTEM/DECISIONS.md) for ADR-001 (AGENTS.md as SSOT) and ADR-002 (thin-pointer policy).

---

## 2. Self-Application Philosophy

arbiter dogfoods at L3. The same gate that arbiter generates for target projects is the gate this repository must pass before any merge.

- The gate command is `node scripts/check-all.mjs L1` (fast, pre-commit) and `node scripts/check-all.mjs L2` (full, pre-push).
- It is invoked by `.githooks/pre-commit` and `.githooks/pre-push`. CI re-runs the same script.
- `--no-verify` is blocked by hook policy. If the gate fails, you fix the root cause; you do not skip.

The development philosophy is documented in [`docs/SYSTEM/CANON.md`](./docs/SYSTEM/CANON.md). The 15 CANON-NN rules are not style preferences — they are process constraints derived from prior audit waves. Read CANON before adding a new generator, template, or hook.

---

## 3. Contribution Paths

Three contributor archetypes map to three concrete entry points.

### A. Adding stack support (new language or archetype)

1. Add a detector heuristic in `src/detectors/` (manifest-file lookup, dependency probe, file-extension scan).
2. Add or extend a generator in `src/generators/` for the relevant archetype.
3. Add templates under `src/templates/<language>/<archetype>/`.
4. Register a fixture in `__tests__/fixtures/real-projects/<language>-<archetype>/` with a valid `manifest.json` listing `language`, `archetype`, `levels`. This is required by [INV-32](./AGENTS.md) once the matrix cell is promoted to `proven`.
5. Update `src/compatibility/cross-language-matrix.json`. CANON-02 / CANON-03 apply when promoting cells.

### B. Adding AI-tool support (new agent CLI, e.g. a future tool)

1. Add a generator that emits the tool's config file (settings, hooks, rules).
2. Add a template under `src/templates/<tool>/`.
3. Wire the tool into `AGENTS.md` via a generated tool-specific imports block.
4. CANON-15 governs config-file emission.

### C. Adding plugins (per ADR-031)

1. Scaffold a plugin with `arbiter plugin add <name>`.
2. Implement the minimal contract exported from `@arbiter/cli/plugin`.
3. See `examples/plugins/` and `examples/plugin-spring-boot/` for the current exemplar.

---

## 4. Local Development Workflow

```bash
nvm use                       # respects .nvmrc (Node 22+)
npm install                   # installs deps and wires git hooks via the prepare script
npm run build                 # tsc + copy templates
npm test                      # vitest unit suite
npm run typecheck             # tsc --noEmit
node scripts/check-all.mjs L1 # full L1 gate
node scripts/check-all.mjs L2 # full L2 gate
```

**Test on a real project:**

```bash
node dist/cli.js init --dir /path/to/some-project --tools claude --level L2
```

**Test layout by category:**

| Category    | Path                                | Purpose                               |
| ----------- | ----------------------------------- | ------------------------------------- |
| unit        | `__tests__/unit/`                   | Pure logic, no I/O                    |
| contract    | `__tests__/contract/`               | Generator output shapes               |
| integration | `__tests__/integration/`            | CLI end-to-end against fixtures       |
| behavioral  | `__tests__/behavioral/`             | Gate behavior on real projects        |
| fixtures    | `__tests__/fixtures/real-projects/` | Per-stack reference projects (INV-32) |

---

## 5. PR Conventions

- **Branch naming:** `task/#NNN-short-description` where `NNN` is the issue number. Direct commits to `main` are blocked.
- **Commit format:** [Conventional Commits](https://www.conventionalcommits.org/), validated by `commitlint.config.js`. Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`.
- **PR title:** Reference the issue ID, e.g. `feat(detectors): support Bun runtime (#NNN)`.
- **PR body:** Use the template. Fill every section. The gate must pass in CI before review.
- **`--no-verify`:** Forbidden. Blocked by hook policy. If the gate fails, fix the root cause.
- **SPDX header:** Every new file under `src/**/*.ts` must start with
  `// SPDX-License-Identifier: Apache-2.0` as its first line (after a shebang, if present).
  The L1 gate (`check-spdx-headers.mjs`) enforces this and will fail if the header is absent.

### Enforcement chain

Edit-time hooks (`.claude/hooks/`) block bad edits before they reach disk. Pre-commit `.githooks/pre-commit` runs the L1 gate on every `git commit` regardless of editor. Pre-push `.githooks/pre-push` runs the L2 gate before any push. CI re-runs both on every PR. Hook installation is wired by `npm install` via the `prepare` script; non-Node projects use `./scripts/setup-hooks.sh`.

### Task lifecycle

Arbiter tasks follow a validated five-phase lifecycle:

```
preflight → plan → implementation → verification → complete
```

Advance with `arbiter task advance --to <phase>`. Forward-only by default; commits are blocked during `preflight` and `plan` (INV-38). Claiming completion while still in `implementation` or `verification` triggers the completion guard.

### SSOT and plan bypass env vars

| Hook / Check               | Guards                                                                                           | Bypass                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| `pre-edit-ssot-guard.mjs`  | `AGENTS.md`, `.claude/CLAUDE.md`, `docs/METHOD/`, `docs/SYSTEM/DECISIONS`, `.agents/CODEX.md`    | `ARBITER_SSOT_BYPASS=1 claude ...`         |
| `pre-edit-plan-anchor.mjs` | Implementation-phase edits without an active plan; new `src/` file without Survey block (INV-46) | `ARBITER_PLAN_BYPASS=1 claude ...`         |
| `check-bloat-ratchet.mjs`  | `src/` file/LOC ceiling per bucket (INV-46)                                                      | `ALLOW_BLOAT=1 node scripts/check-all.mjs` |

Bypasses are session-scoped and must reference the corresponding task ID and ADR in the commit message. Never set them in your shell profile.

---

## 6. Decision Process

Architectural decisions are recorded as ADRs in [`docs/SYSTEM/DECISIONS.md`](./docs/SYSTEM/DECISIONS.md). Before proposing a change that:

- Adds or removes an invariant
- Changes the gate semantics
- Introduces a new top-level directory under `src/`
- Adds a new external dependency
- Changes the plugin contract

…open an issue first and reference the ADR you intend to add. Implementation PRs that change the contract must include the ADR entry in the same commit.

The 15 CANON-NN rules in `docs/SYSTEM/CANON.md` are the process-level counterpart: where ADRs record _what_ was decided, CANON records _how_ decisions are enforced.

---

## 7. Code of Conduct

This project follows the [Contributor Covenant 2.1](./CODE_OF_CONDUCT.md). Report incidents to **ulfwerenar@gmail.com**.

---

## 8. Where to Start

- Browse issues labeled `good first issue` or `help wanted`.
- Read [`docs/DEVELOPMENT/GETTING-STARTED.md`](./docs/DEVELOPMENT/GETTING-STARTED.md) for a guided first build.
- Try the end-to-end walkthroughs in [`examples/`](./examples/).
- Questions: open a [discussion](https://github.com/LucaDominici/arbiter/discussions).
