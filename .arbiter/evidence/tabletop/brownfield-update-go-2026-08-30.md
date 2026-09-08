---
scenario: brownfield-update-go
sha: ae40f0cf5f8bc78dac1fa8833a7db1e0708879cf
date: 2026-08-30
persona: Platform engineer adopting arbiter into a three-year-old Go service with its own Makefile, linter config and GitHub Actions
steps: 7
findings:
  blocker: 0
  major: 7
  minor: 0
---

# Tabletop — brownfield-update-go

I run a three-year-old Go service. It already has a Makefile, a `.golangci.yml`, `_test.go`
files and a GitHub Actions workflow, and I do not want arbiter anywhere near my CI without my
say-so. I read the three docs the catalogue points me to, run `update --help` to learn the
surface, then do the one thing a cautious engineer always does before touching a working
build: dry-run it. The dry run tells me almost nothing — not that arbiter noticed my existing
tooling, not which of my files it will touch, not even a plausible list of what it will
create. I have to run it for real to find any of that out, at which point the underlying
machinery turns out to work fine: my three files are correctly withheld. But the tool that
was supposed to let me find that out safely, in advance, never told me. Along the way, the two
of three named docs that aren't QUICKSTART turn out to be about something else entirely, the
`update`-command dry run the catalogue names doesn't exist as typed, and the one materialized
Go example in the repo is a library, not a service — so the gate-registry diff the scenario
asks for can't even exercise the code path unique to what I run.

| step | doc claim (path:line) | observed | severity | class | proposed permanent check | owner |
| ---- | --------------------- | -------- | -------- | ----- | ------------------------ | ----- |
| 1 | docs/QUICKSTART.md:14-16 — "This page covers install, what lands in your repo, running one task through the gate, and how to remove it all if arbiter isn't for you" | `grep -n "update" docs/QUICKSTART.md` returns zero hits. The doc covers `init` (with `--brownfield`), the generated-file table, running the gate, and manually restoring `AGENTS.md.arbiter-backup` / `rm -rf .claude/` to uninstall — but never once introduces `arbiter update`, the command that re-generates governance files from stored config and is this scenario's entire subject. A reader following QUICKSTART end to end has no path from it to the command their goal requires | major | doc-drift | `__tests__/docs/quickstart-command-coverage.test.ts`: for each TABLETOP-SCENARIOS.md scenario that lists QUICKSTART.md as a doc the user reads, assert every top-level command named in that scenario's probes appears at least once in QUICKSTART.md | #2451 |
| 2 | docs/internal/METHOD/TABLETOP-SCENARIOS.md:56-57 — the docs this persona reads to "adopt the governance kit without clobbering the existing build, and know exactly which files were changed and which were skipped" are QUICKSTART.md, CONFORMANCE.md, DEPRECATIONS.md | docs/internal/DEVELOPMENT/CONFORMANCE.md:17-19 opens with "this is a proposed command interface, not a registered current CLI command" — the whole document specs `arbiter conformance` / `doctor --prove-gates`, and never mentions `update`, `--adopt`, `skipIfExists`, or the generated-file manifest. Meanwhile `docs/REFERENCE/file-stability.md` — which documents exactly this goal: the three update write channels (adopt/regenerate/pristine-rewrite, :220-243), the withheld-fix visibility mechanism (:171-218), and the three protected classes safety/gate-spine/governance (:389-459) — is absent from the scenario's own reading list. The catalogue sends the persona to the wrong second and third doc and omits the right one | major | doc-drift | extend `__tests__/docs/tabletop-scenarios.test.ts` so each scenario's "Docs the user would read" is checked against the doc(s) that actually define the terms in its own "Goal"/"Exit criterion" fields (or simply swap CONFORMANCE.md for `docs/REFERENCE/file-stability.md` in scenario 2) | #2451 |
| 2 | docs/DEPRECATIONS.md:34-42 — "CLI flags follow a three-stage deprecation lifecycle managed by `src/internal/cli-deprecation-registry.ts`" (warn/hide/remove), with an Active table meant to enumerate every flag on that ladder | `node dist/cli.js update --help` labels two of its own flags, verbatim, "Accepted no-op": `--no-adopt-gate-spine` ("withholding a customized gate spine is the default since #2119") and `--no-adopt-governance` ("withholding a diverged governance file is the default since #2141") — permanently-inert flags kept only so old scripts keep working, exactly the shape the CLI Flag Lifecycle exists to track. `src/internal/cli-deprecation-registry.ts:23` defines `CLI_DEPRECATED_FLAGS` as `[]`, and DEPRECATIONS.md's own Active table (line 24) reads "(none currently active)". Neither flag carries a stderr notice, a `deprecatedIn`/`removeIn`, or a row in the one doc a reader is told answers exactly this question | major | doc-drift | `__tests__/docs/deprecations-flag-coverage.test.ts`: scan every command's `--help` text for "no-op" / "accepted no-op" and assert a matching row exists in DEPRECATIONS.md's Active or Closed table | #2453 |
| 3 | docs/internal/METHOD/TABLETOP-SCENARIOS.md:58 — the executable probe is `node dist/cli.js update --help`, immediately followed by "a dry-run update against a fixture" | `update --help`'s full option list is `--dir, --github, --json, --force, --adopt, --no-adopt-safety, --adopt-gate-spine, --adopt-governance, --no-adopt-gate-spine, --no-adopt-governance, --adopt-plan, --refresh-derived, -h` — there is no `--dry-run`. Confirmed: `node dist/cli.js update --dry-run` exits 1 with `error: unknown option '--dry-run'`. The two real analogues are different commands with different names: the standalone `arbiter diff` ("Show what arbiter update would change (dry run)") and `update --adopt-plan` ("Two-phase preview... without writing anything", adoption-only). Neither is what a reader typing the scenario's own probe literally gets | major | phantom-command | `__tests__/docs/tabletop-scenarios.test.ts`: for every quoted `<command> --<flag>` pair in a scenario's "Executable probes" line, resolve the flag against that command's real `--help` option list and fail if absent | #2452 |
| 4 | docs/QUICKSTART.md:71-73 — "Init also recognizes a brownfield project from existing tests, CI workflows, or lint configuration. If it finds one without `--brownfield`, it says so and proposes the explicit baseline route instead of silently treating the repository as greenfield" | `update` refuses to run at all with no `arbiter.json` ("No arbiter.json found. Run `arbiter init` first.", exit 78), so for a Go service with no prior arbiter kit the real entry point is `init`, not `update`. Ran `node dist/cli.js init --yes --dry-run --tools claude --level L2` against a copy of the `go-backend-web-gcr` fixture carrying `.golangci.yml`, `_test.go` files under `internal/`, and `.github/workflows/ci.yml` — all three of `isBrownfield()`'s own signals. Output: `Dry run — no files will be written. [create] + AGENTS.md + .claude/ (...) Run without --dry-run to apply.` — no brownfield mention anywhere. `src/commands/init.ts:173-176` returns from `displayDryRunPreview` before `generateAndFinalize` ever runs; the brownfield-route message (`src/commands/init/generate.ts:99-101`, `t('cli.init.brownfield_route')`) is computed and logged only inside `generateAndFinalize`, i.e. only on a real write. The identical fixture run for real prints "Existing project detected (tests, CI workflows, lint config)... To select brownfield initialization, re-run with --brownfield." The engineer this scenario defines by "a strong aversion to having its CI overwritten" — who dry-runs before writing, precisely out of that aversion — gets zero signal from the safe path that arbiter noticed their tooling at all | major | bug | `__tests__/commands/init-dry-run-brownfield.test.ts`: dry-run against a fixture where `isBrownfield(detectExisting(dir))` is true must include the brownfield-route notice in its stdout | #2452 |
| 4 | docs/internal/METHOD/TABLETOP-SCENARIOS.md:61-62 — exit criterion: "The dry-run names every write and every skip-if-exists, and no documented skip promise is contradicted by the plan" | The same dry-run above previews exactly 2 paths (`AGENTS.md`, `.claude/`). `computeDryRunPreview`/`buildMigrationPlan` (`src/commands/init/generate.ts:372-379`, `src/wizard/prompts.ts:101+`) is a separate, hand-maintained function checking ~8 fixed top-level paths (AGENTS.md, .claude, .agents, cursor/copilot/gemini/windsurf files) — it never calls the real generator registry `generateAndFinalize` uses. The real (non-dry-run) run on the identical fixture creates 243 files and explicitly reports 3 skip-if-exists files by name: "3 file(s) already exist: .gitignore, .golangci.yml, Makefile. Re-run with --force to overwrite existing files." None of those three — the exact files this persona is anxious about — nor any of the other 240 created files, appear anywhere in the dry-run preview. The exit criterion fails outright for `init --dry-run`, the only dry-run this fixture's starting state (no prior arbiter kit) can reach | major | bug | `__tests__/commands/init-dry-run-parity.test.ts`: assert `computeDryRunPreview(config)` lists every path the real run's `WriteResult[]` reports under `skipped`/`created` (or replace it with a real dry-run pass through the generator registry, as `update`'s `dryRun` plumbing already does) | #2452 |
| 6 | docs/internal/METHOD/TABLETOP-SCENARIOS.md:58-60 — "render the Go gate registry and diff it against the materialized Go example" | `examples/` contains exactly one materialized Go example: `examples/go-library` — archetype `library`, governance level L1, `enableSecurityScanning: false`, debt gates off. This persona's actual project is a Go *service* (archetype `backend-web-db`, per `__tests__/fixtures/real-projects/go-backend-web-gcr/manifest.json`). `src/generators/check-all.ts:686-687` gates an entire server-runner/e2e-harness branch on `archetypesNeedingServer = {frontend-spa, backend-web-db}` at L2+ — code the `library` archetype can never emit, at any level. Rendering the fixture's own `scripts/check-all.mjs` and diffing it against `examples/go-library/scripts/check-all.mjs` produces a diff dominated entirely by L1-vs-L2 and security/debt-flag noise (gitleaks, staticcheck, govulncheck, coverage, gocyclo, debt-ratchet — all `enableDebtGates`/`enableSecurityScanning` driven), and can never exercise, let alone validate, the one archetype-specific code path a Go *service* actually needs checked. No materialized Go service example exists anywhere in `examples/` to diff against instead | major | missing-gate | add a materialized `examples/go-backend-web-gcr` (or equivalent backend-web-db Go example) alongside `examples/go-library`, and a regression test asserting every archetype branch with distinct gate-registry code (`archetypesNeedingServer`, `hasE2eHarness` in `src/generators/check-all.ts`) has ≥1 materialized example under `examples/` exercising it | #2454 |

## Appendix — verbatim probe output

Pinned tree: `ae40f0cf5f8bc78dac1fa8833a7db1e0708879cf`, branch `docs/tabletop-brownfield-update-go`.

`node dist/cli.js update --help` (step 3) — full option surface, no `--dry-run`:

```
Usage: arbiter update [options]

Re-generate governance files using stored config (arbiter.json)

Options:
  --dir <dir>            Target directory (default: current directory)
  --github               Activate live GitHub API calls (opt-in; ARBITER_GITHUB=1 also activates)
  --json                 Emit machine-readable JSON output
  --force                Override adverse git state check
  --adopt                Force-adopt ALL currently-withheld files
  --no-adopt-safety      Opt OUT of the default-on safety-class adoption
  --adopt-gate-spine     Opt IN to force-adopting the gate spine (DESTRUCTIVE, #2119)
  --adopt-governance     Opt IN to force-adopting governance files (DESTRUCTIVE, #2141)
  --no-adopt-gate-spine  Accepted no-op: withholding a customized gate spine is the default since #2119.
  --no-adopt-governance  Accepted no-op: withholding a diverged governance file is the default since #2141.
  --adopt-plan           Two-phase preview: print what --adopt/the default safety adoption WOULD change, without writing anything.
  --refresh-derived      Force-refresh the codex-track derived file set
  -h, --help             display help for command
```

`node dist/cli.js update --dry-run` (step 3):

```
error: unknown option '--dry-run'
```

(exit 1)

`node dist/cli.js update --json` on the brownfield fixture before `init` has ever run (step 4):

```
{"command":"update","version":"1","status":"error","data":{},"errors":["No arbiter.json found. Run `arbiter init` first."],"errorClass":"config"}
```

(exit 78)

`node dist/cli.js init --yes --dry-run --tools claude --level L2` on a `go-backend-web-gcr` copy with `.golangci.yml`, `.github/workflows/ci.yml` and `_test.go` files added (step 4):

```
Arbiter — AI Development Governance Framework

  Detecting project...
  ├── Language: go (detected from go.mod)
  ├── Build: go
  ├── Git: no
  ├── GitHub: authenticated as unknown

  Dry run — no files will be written.

  [create]
  + AGENTS.md
  + .claude/ (CLAUDE.md, settings.json, hooks, rules, commands)

  Run without --dry-run to apply.
```

The same fixture, real run — `node dist/cli.js init --yes --tools claude --level L2 --no-verify` (step 4, for contrast):

```
  3 file(s) already exist: .gitignore, .golangci.yml, Makefile
  Re-run with --force to overwrite existing files.

  Existing project detected (tests, CI workflows, lint config). The first gate run will
  measure your project as it is today. To select brownfield initialization, re-run with
  --brownfield. To capture a debt baseline when debt gates are enabled, run:
  node scripts/capture-debt-baseline.mjs.

  Done! 243 files created, 3 skipped.
```

`node dist/cli.js diff --withheld` on the now-governed fixture (step 5, confirms the underlying skip machinery is actually sound even though the dry-run preview never showed it):

```
  Withheld template fixes (3) — preserved because user-modified, fix NOT applied:
  ! .gitignore  (template fix WITHHELD — user-modified)
  ! .golangci.yml  (template fix WITHHELD — user-modified)
  ! Makefile  (template fix WITHHELD — user-modified)
  These files are behind the current template. Review the upstream changes and merge them
  manually, or run `arbiter diff --withheld` for a focused list.
```

`node dist/cli.js update --adopt-plan` on the same fixture (step 5):

```
  adopt-plan: nothing to adopt (no withheld file matches the adopt policy).

  would withhold 3 file(s) (locally diverged, no adopt policy matches):
    - .gitignore
    - .golangci.yml
    - Makefile
  Re-run without --adopt-plan to apply. Nothing was written.
```

Gate-registry diff, fixture's rendered `scripts/check-all.mjs` vs `examples/go-library/scripts/check-all.mjs` (step 6) — representative excerpt of the noise dominating the diff (full diff is ~500 lines):

```
< const _projectLevel = 'L2';
---
> const _projectLevel = 'L1';
```
plus L2-only entries present only on the fixture side: `gitleaks`, `staticcheck`, `govulncheck`, `go-coverage`, `gocyclo`, `bdd-go`, `debt-ratchet`, `wiki-lint`, `doc-index-drift`, `llms-txt-drift` — all `enableSecurityScanning`/`enableDebtGates`/governance-level driven, none of it isolating the `backend-web-db`-specific server/e2e-harness branch the probe is meant to check.

Brownfield-detection code path (step 7) — `src/detectors/existing.ts:50-52`:

```ts
export function isBrownfield(state: ExistingState): boolean {
  return state.tests || state.ciWorkflows || state.lintConfig
}
```

`detectLintConfig` (`:121-157`) recognizes `.golangci.yml`/`.golangci.yaml` for Go; `isTestFile` (`:98-106`) recognizes `_test.go`; `detectCiWorkflows` (`:108-119`) recognizes any `.github/workflows/*.yml`. All three of this persona's real signals are correctly wired — the detection logic itself is sound for Go. The gap is entirely in *where its result surfaces* (findings above): never in `logExistingDetections` (`src/commands/init.ts:236-244`, which reports only AGENTS.md/.claude//.agents//gemini/windsurf/aider/ai-rulez, not tests/CI/lint), and never reached at all on the `--dry-run` path (finding row 4).
