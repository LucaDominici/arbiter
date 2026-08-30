---
scenario: greenfield-init-ts
sha: 72a7d3c0426cecaf6913a87f9b453556ea6fb3fd
date: 2026-08-30
persona: TypeScript library author installing arbiter into an empty repo for the first time
steps: 7
findings:
  blocker: 0
  major: 4
  minor: 3
---

# Tabletop — greenfield-init-ts

It is Friday afternoon. I have a two-file TypeScript library and no governance at all. I read
the README, then `docs/QUICKSTART.md`, and I want to end the day with a repo where the gate is
green and I understand what each check is for. I preview with `--dry-run` first, because I do
not trust a tool that writes two hundred files into my repo sight unseen — and the preview
tells me almost nothing. I run the real thing, it reports 271 files, and three of the five
rows the quickstart's own table promised me are not among them. Then I run the one command
init tells me to run next and it comes back red on four checks, none of which is my code.

| step | doc claim (path:line) | observed | severity | class | proposed permanent check | owner |
| ---- | --------------------- | -------- | -------- | ----- | ------------------------ | ----- |
| 2 | docs/internal/METHOD/TABLETOP-SCENARIOS.md:44 — "every file the quickstart promises appears in the dry-run plan" | `node dist/cli.js init --yes --dry-run` printed exactly three create entries (AGENTS.md, .claude/, .agents/); the same config without `--dry-run` reported "Done! 271 files created, 0 skipped." `src/commands/init/generate.ts:373` builds the preview from `buildMigrationPlan` alone, so the plan structurally cannot list generator output | major | ux | `__tests__/commands/init-dry-run.test.ts`: assert the `--dry-run` create set is a superset of the top-level paths a real `--yes` init writes into a scratch dir | #2434 |
| 3 | docs/QUICKSTART.md:65 — "`SECURITY.md`, `.editorconfig` — Baseline repo hygiene files" (same row at README.md:134) | after a real `init --yes --quiet` reporting 271 files created, `ls SECURITY.md .editorconfig` returned "No such file or directory (os error 2)" for both. `src/generators/registry.ts:266` gates the entire `root` generator on `config.permitGitHub ?? config.useGitHub`, and `src/generators/root.ts:35` is the only writer of SECURITY.md. `examples/ts-library/` — which README.md:115 calls "exactly what `arbiter init` generates today" — contains neither file | major | doc-drift | extend `scripts/check-emission-parity.mjs`: every path named in the README and QUICKSTART "What gets generated" tables must exist in `examples/ts-library/` | #2434 |
| 3 | docs/QUICKSTART.md:63 — "`<project>/.github/workflows/ci.yml` — CI gate mirroring the local check" (same row at README.md:132) | default `init --yes` emitted no `.github/` directory at all; re-running the dry-run with `--github` names "GitHub workflows + templates (01-pr-fast.yml, PR template, issue templates)" instead, and no `ci.yml` template exists under `src/templates/github/workflows/`. `examples/ts-library/.github` does not exist | major | doc-drift | same emission-parity assertion as the row above — it covers this path too | #2434 |
| 4 | docs/QUICKSTART.md:41 — "`init` verifies the local toolchain **before creating or changing any file**" | `src/cli.ts:577` registers the flag as "Skip toolchain compatibility probes after generation", contradicting both the doc and its own `src/commands/init/types.ts:24` ("before generation"); `src/commands/init.ts:133` calls `verifyToolchainBeforeWrite` ahead of the first `ensureDir`, so the doc is right and the help text is wrong | minor | doc-drift | `scripts/check-validator-helptext.mjs` already lints help strings — add an assertion that no `init` option description contradicts the ordering words docs/QUICKSTART.md uses for the same flag | #2434 |
| 5 | docs/QUICKSTART.md:84 — "node scripts/check-all.mjs L1 # lint + format + unit tests — fast, pre-commit", reached straight from init's own epilogue "Run: node scripts/check-all.mjs L1  to verify" | that exact command on the freshly initialized repo ended "=== FAILED: 4 check(s) ===" with typecheck, lint, static analysis and unit tests red — "error TS2688: Cannot find type definition file for 'node'", "Cannot find package '@eslint/js'", "sh: 1: vitest: not found". init had injected @types/node, @eslint/js, typescript-eslint and vitest into package.json devDependencies but neither installed them nor named an install step anywhere in QUICKSTART §3. After a plain `npm install` the identical command printed "=== ALL PASSED ===" | major | ux | `__tests__/e2e/greenfield-gate.test.ts`: init a scratch TS library, run the emitted L1 gate with no manual step, and assert either exit 0 or an actionable "run your package manager's install first" message rather than four resolver failures | #2434 |
| 6 | docs/QUICKSTART.md:64 — "`scripts/check-all.mjs` — The local gate runner (`L1`/`L2`/`L3`/`L4`)" | the emitted runner disagrees with itself: its header comment at line 3 offers only the L1 and L2 levels, while the runtime usage string it prints at line 109 offers L1 through L4 | minor | doc-drift | reconcile the emitted `check-all.mjs` header comment against its runtime usage line inside `scripts/check-validator-helptext.mjs` | #2434 |
| 6 | docs/QUICKSTART.md:64 — the emitted file is presented as a "local gate runner", the first command a new user invokes by hand | `node scripts/check-all.mjs --help` exits 2 with `[GATE] FATAL: unrecognized argument "--help"` before printing its usage line; the conventional discovery flag is a fatal error in the one script the quickstart tells a first-time user to run | minor | ux | `scripts/check-validator-helptext.mjs`: require every emitted runnable script to accept `--help` and exit 0 | #2434 |

## Appendix — verbatim probe output

Pinned tree: `72a7d3c0426cecaf6913a87f9b453556ea6fb3fd`. Scratch target: a fresh git repo with
a small `package.json` (name, one `typescript` devDependency) and one `src/index.ts`.

Dry-run plan (step 2):

```
  Dry run — no files will be written.

  [create]
  + AGENTS.md
  + .claude/ (CLAUDE.md, settings.json, hooks, rules, commands)
  + .agents/ (CODEX.md, rules, plan)

  Run without --dry-run to apply.
```

Same config with `--github` added:

```
  [create]
  + AGENTS.md
  + .claude/ (CLAUDE.md, settings.json, hooks, rules, commands)
  + .agents/ (CODEX.md, rules, plan)
  + GitHub workflows + templates (01-pr-fast.yml, PR template, issue templates)
  + scripts/check-all.mjs
```

Real init epilogue (step 3):

```
  Done! 271 files created, 0 skipped.
  Git hooks activated (core.hooksPath -> .githooks) — the gate now guards every commit and push.

  Run: node scripts/check-all.mjs L1  to verify
```

Promised-path check against that same tree:

```
"…/SECURITY.md": No such file or directory (os error 2)
"…/.editorconfig": No such file or directory (os error 2)
"…/.github/workflows": No such file or directory (os error 2)
…/AGENTS.md
…/scripts/check-all.mjs
```

First L1 run, before any install (step 5):

```
[CHECK] typecheck ... FAIL (exit 2, 1642ms)
error TS2688: Cannot find type definition file for 'node'.
[CHECK] lint ... FAIL (exit 2, 2767ms)
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@eslint/js'
[CHECK] static analysis ... FAIL (exit 2, 2590ms)
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'typescript-eslint'
[CHECK] unit tests ... FAIL (exit 127, 191ms)
sh: 1: vitest: not found

=== FAILED: 4 check(s) ===
Failed checks:
- typecheck (FAIL)
- lint (FAIL)
- static analysis (FAIL)
- unit tests (FAIL)
```

The identical command after a plain `npm install`:

```
tabletop evidence (#2429)               PASS    16ms
-------------------------------------------------------
Total                                           5858ms

=== ALL PASSED ===
```
