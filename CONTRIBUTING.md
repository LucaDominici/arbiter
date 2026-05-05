# Contributing to arbiter

Thank you for considering contributing to **arbiter**.

## Getting Started

1. Fork the repository
2. Create a task branch: `git checkout -b task/#NNN-short-description`
3. Make your changes following the guidelines below
4. Run the quality gate: `npm run test`
5. Commit with the [conventional format](#commit-format)
6. Open a Pull Request

## Branch Naming

```
task/#NNN-short-description
```

Where `#NNN` is the GitHub issue number. No direct commits to `main`.

## Commit Format

```
type(scope): summary

- Detail of what changed
- Detail of what changed
```

**Types:** `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`

## Code Standards

See `AGENTS.md` for the full coding standards, invariants, and testing policy.

Key rules:

- All code must pass the quality gate before committing
- No `any` types — use proper type annotations
- No orphan TODOs — every `TODO` must reference a task ID (`TODO(#NNN)`)
- Tests required for new functionality

## Quality Gate

```bash
npm run test
```

**Lint:** `npm run lint`
**Format:** `echo &#34;no formatter configured&#34;`

### Enforcement Chain

Code changes pass through four enforcement layers in sequence: edit-time Claude Code hooks (`.claude/hooks/`) block bad edits before they land on disk; pre-commit `.githooks/pre-commit` runs the L1 gate on every `git commit` regardless of editor; pre-push `.githooks/pre-push` runs the L2 gate before any push; and CI verifies all PRs. To activate the git hooks run `git config core.hooksPath .githooks` (Node projects also auto-install this via `npm install` through the `prepare` script; non-Node projects use `./scripts/setup-hooks.sh`).

## Hook Hardness Manifest

All hooks in `src/templates/claude/hooks/` are classified in `.arbiter/hooks-manifest.json` with an explicit `classification` field (`HARD` or `ADVISORY`). The L1 gate verifies this classification empirically on every CI run (INV-36).

**When adding a new hook:**

1. Write the hook file.
2. Add an entry to `.arbiter/hooks-manifest.json` with the correct `classification` and, if `HARD`, a `fixture` describing how to trigger a violation.
3. Run `node scripts/check-hardness-inventory.mjs` — it must exit 0.
4. Run the full gate: `node scripts/check-all.mjs L1`.

**When modifying a HARD hook:**

Ensure the hook still exits non-zero on the fixture defined in the manifest. Changing a HARD hook to exit 0 (advisory) without updating the manifest will fail CI.

### SSOT and plan bypass env vars

Two hooks block edits to high-authority documents. For legitimate edits, use session-scoped bypass:

| Hook                       | Guards                                                                                        | Bypass                             |
| -------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------- |
| `pre-edit-ssot-guard.mjs`  | `AGENTS.md`, `.claude/CLAUDE.md`, `docs/METHOD/`, `docs/SYSTEM/DECISIONS`, `.agents/CODEX.md` | `ARBITER_SSOT_BYPASS=1 claude ...` |
| `pre-edit-plan-anchor.mjs` | Implementation-phase edits without an active plan                                             | `ARBITER_PLAN_BYPASS=1 claude ...` |

**Warning:** Do not set these in your shell profile — session-scoped only. Legitimate edits should reference a corresponding ADR or amendment in the commit message.

## Pull Requests

- Fill out the PR template completely
- Link the related issue
- Ensure the gate passes in CI
- Request review from a code owner

## Questions?

Open a [discussion](https://github.com/LucaDominici/arbiter/discussions) or reach out to the maintainers.
