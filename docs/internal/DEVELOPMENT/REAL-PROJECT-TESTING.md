---
title: 'Real-Project Testing'
doc_version: '1.0.0'
status: active
last_review: '2026-07-09'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/method']
related: []
---

# Real-Project Testing

> **STALE (found during A4, wave1 action plan):** `real-project-matrix.yml` and
> `__tests__/scripts/real-project-matrix-workflow.test.ts`, referenced throughout
> this page, do not exist in this repo — confirmed by exhaustive grep. The
> `manifest.json`-driven fixture set under `__tests__/fixtures/real-projects/`
> IS real and current, but its actual consumers today are the vitest harnesses
> in `__tests__/integration/e2e/bake/` (structure-only) and
> `__tests__/integration/e2e/functional/` (executes the generated gate) — not a
> GitHub Actions workflow. `scripts/build-matrix.mjs` and
> `scripts/aggregate-matrix-result.mjs`, which this page's "How It Works"
> section names, were removed as zero-invoker dead code (A4) — nothing in the
> repo ever called them. The rest of this page (fixture schema, adding a
> fixture, dog-fooding locally, troubleshooting) has not been re-audited against
> the vitest harnesses and may also be stale; treat it as unverified until a
> dedicated pass reconciles it. Tracked for follow-up — not fixed wholesale here
> (out of scope for a dead-code-removal pass).

Arbiter's real-project fixtures exercise the full pipeline — `arbiter init → arbiter verify → check-all.mjs` — against each one. This document explains how the system works, how to add a new fixture, and how to debug failures.

See ADR-027 for the architectural rationale.

---

## How It Works

The vitest harnesses (see stale-notice above) drive each fixture through the
same pipeline shape, in-process rather than via a GitHub Actions matrix:

```
fixture-bake.test.ts (structure only — no gate exec)
  reads __tests__/fixtures/real-projects/*/manifest.json (loadFixtureManifest)
  runs `arbiter init` in-process, snapshots the generated file set + content hashes

fixture-functional.test.ts (executes the generated gate)
  ├─ stage fixture → tmpdir (stageFixture)
  ├─ `arbiter init` in-process
  ├─ install per-language deps
  └─ node scripts/check-all.mjs $LEVEL  (inside the staged project)
```

At L1, the workflow only needs the language toolchain plus Node for Arbiter itself. At L2, the staged project executes the full generated gate, so the runner must also provide the binaries that the generated project expects to call. The current nightly workflow installs these explicitly rather than assuming they are present on `docker-ci-build`.

Current L2 extras:

- All languages: `gitleaks`
- Go: `staticcheck`, `govulncheck`
- Rust: `cargo-audit`, `cargo-tarpaulin`
- Python: `pip-audit`, `pytest-cov`

Treat these as part of the nightly contract, not incidental workflow glue. If a generator starts invoking a new L2 tool, the nightly workflow and this document must be updated in the same PR.

---

## Fixture Structure

Every fixture lives under `__tests__/fixtures/real-projects/<name>/` and must contain:

| File              | Purpose                                                                     |
| ----------------- | --------------------------------------------------------------------------- |
| `manifest.json`   | Declares language, archetype, levels (required by INV-32)                   |
| Real build config | `package.json`, `Cargo.toml`, `build.gradle`, `go.mod`, or `pyproject.toml` |
| ≥1 source file    | Minimal compilable/importable code                                          |
| ≥1 test file      | At least one passing test that the toolchain can run                        |
| `.gitignore`      | Exclude build artefacts                                                     |

### manifest.json Schema

```jsonc
{
  "language":   "typescript" | "java" | "rust" | "go" | "python",
  "archetype":  "library" | "backend-web-db" | "frontend-spa" | …,
  "buildTool":  "gradle" | "maven" | null,
  "levels":     ["L1"] | ["L1", "L2"],   // levels to exercise
  "tier":       "snapshot" | "bake" | "functional",
  "note":       "optional human note"
}
```

Four fields are required: `language`, `archetype`, `levels`, and `tier`. `buildTool` is optional — include it when applicable (e.g., `"gradle"` for Java), omit or set to `null` otherwise. `note` is optional.

#### `tier` — bake-and-run harness layer (#1041)

The `tier` field selects which E2E layer exercises the fixture:

| Tier         | What runs against the fixture                                                   | Use when                                                                                                                                                                                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `snapshot`   | Manifest validation only — no `arbiter init`, no exec                           | Pure data/docs fixtures (`markdown-only`); also a non-GA stack declassified pre-publish (`kotlin-backend-web-db-gradle`, #1840 F4 tranche-2, 2026-07-09 — re-promotion path: #1803)                                                                                                                                       |
| `bake`       | `arbiter init` → structural snapshot diff → parse generated manifests (no exec) | Most fixtures (`backend-*`, `bdd`, `frontend-spa` …)                                                                                                                                                                                                                                                                      |
| `functional` | `bake` + execute the generated project's own L1 gate inside a clean tmpdir copy | Cheapest fixture per stack (`*-library`); promoted to the dedicated `generator-matrix.yml` workflow (dispatchable + weekly + pre-release, #1840 F4 tranche-2). Also the `backend-web-db` archetype's 3 GA fixtures (`ts-backend-web-db`, `python-backend-web`, `go-backend-web-gcr`) as of #1840 F4 tranche-3 — see below |

The bake-and-run harness lives in `__tests__/e2e/bake/` and `__tests__/e2e/functional/`. Industry pattern reference: Nx (`create-nx-workspace` Verdaccio), Cookiecutter (`pytest-cookies`), Spring Initializr (`initializr-generator-test`).

#### Packaged-artifact outsider simulation (#1770)

`__tests__/integration/e2e/functional/packaged-artifact.test.ts` goes one layer beyond
`functional`: instead of running arbiter from the repo's `dist/`, it simulates a true
outsider install. It runs `npm pack` on the repo, installs the resulting tarball into a
fresh tmpdir project staged from the `ts-library` fixture, runs `arbiter init` through the
**installed** package's bin, asserts the generated project's own L1 gate passes, and
round-trips the task engine (`task init` → real failing test → `record-red` → evidence
validated → advance to green). This catches packaging-only bug classes invisible to every
other suite: `prepack` scripts polluting `npm pack --json` stdout, runtime dependencies
misclassified as devDependencies, and generated content tripping the generated project's
own scanners (#1772). Gated behind `VITEST_L2=1` like its siblings; it costs a pack plus
two full npm installs plus a generated-gate run (~1 min), so it runs at L2/nightly depth,
not in per-PR fast lanes.

#### Generator Matrix workflow (#1840 F4 tranche 2)

`.github/workflows/generator-matrix.yml` gives the DEEP `functional`-tier cells their own
dispatchable + weekly (Sun 05:00 UTC) + pre-release (`release: types: [prereleased]`) surface,
independent of the broad nightly sweep that already runs them bundled inside
`_nightly.yml`'s `generated-gate-e2e` job. It is hand-authored, not `.ejs`-rendered — it tests
arbiter's own generator against arbiter's own fixtures, which has no meaning in a downstream
project (same category as `kit-self-canary.yml` / `probe-writer-audit.yml`).

Cells (closed list, per the #1840 tranche-2 decision comment, 2026-07-09):

| Stack      | Test                                                              |
| ---------- | ----------------------------------------------------------------- |
| TypeScript | `packaged-artifact.test.ts` (#1770 T8, outsider npm-pack install) |
| Python     | `fixture-functional.test.ts -t python`                            |
| Go         | `fixture-functional.test.ts -t go`                                |
| Rust       | `fixture-functional.test.ts -t rust`                              |
| Java       | `fixture-functional.test.ts -t java` (post-#1858 un-skip)         |

Kotlin is excluded — see the `snapshot` tier row above. Toolchain-pin coherence (the
#1854/#1856 incident class) is locked by
`__tests__/scripts/generator-matrix-workflow.test.ts`, sharing the `MIN_GO_FOR_PINNED_TOOL`
registry in `__tests__/helpers/go-pinned-tool-minimums.ts` with the `_nightly.yml.ejs` guard.

#### `backend-web-db` GA promotion (#1840 F4 tranche 3, 2026-07-09)

Tranche 2 parked the `backend-web-db` archetype's fixture promotion for TS/Python/Go
(the README's "3 GA stacks") with an honest reason: `python-backend-web`'s only test was a
`pytest-playwright` suite requiring a live server, and `go-backend-web-gcr` had no source at
all — neither was a real project. This tranche authors both as minimal-but-real apps
(`python-backend-web`: FastAPI + SQLAlchemy over an in-memory sqlite DB, unit + integration
tests; `go-backend-web-gcr`: net/http + an in-memory `ItemStore` behind an interface, unit +
integration tests; `ts-backend-web-db` already had real content) and flips all three to
`tier: functional`.

Actually _executing_ the generated L1 gate for `backend-web-db` for the first time (bake tier
never runs it) surfaced several arbiter-side gaps that were never observable before — fixed in
the same tranche because a fixture promotion that doesn't survive its own gate is not a
promotion:

- **TS `test:unit` swept in the live-server/browser suites.** `vitest run` (unscoped) also
  collected `tests/api/**` (INV-126, needs `supertest` + a live server) and `tests/e2e/**`
  (a11y, needs `@playwright/test`) — neither ships as a devDependency, so a fresh
  `backend-web-db` init RED'd on `Cannot find package 'supertest'` before any team code was
  added. Fixed by scoping `test:unit` to `vitest run src` (`src/generators/debt-gates.ts`),
  mirroring the substring-filter mechanism the `test:contract`/`test:integration`/
  `test:behavioral` scripts already used. `check-min-test-execution.mjs.ejs`'s `vitest list`
  needed the same `src` scope to count the same surface the gate actually runs.
- **Arbiter's own generated TS templates ignore the target project's prettier style.**
  `api-middleware.ts`, `api-e2e.ts` (TS suite), and `playwright-ts.ts` are hand-authored in
  arbiter's internal style (single-quote, no semicolons) and were written straight to disk —
  any project whose `.prettierrc` differs (the common case) fails its own generated `format`
  gate on arbiter's OWN files. Fixed by running each through `formatContent` (`src/utils/
prettier-format.ts`, #933 F13 — the same post-emit reformat `commitlint.config.js` already
  used, #1325) before `writeFile`.
- **Generated middleware tripped the generated lint gates.** `error-handler.ts`'s
  Express-required `_next` param tripped `@typescript-eslint/no-unused-vars` (no
  `argsIgnorePattern: '^_'` in the generated `eslint.config.mjs`); its `console.error` tripped
  the static-analysis gate's `no-console`. Both fixed at the template/config level.
- **Python's own generated a11y helper failed its own naming-convention gate.**
  `check-test-naming.mjs.ejs`'s python branch flagged `tests/e2e/a11y/run_axe.py` (a non-test
  helper module) for not matching `test_*.py`. Fixed with the same content-based exemption
  (`def test_` sniff) the Go/Java branches already use for glue/support files.
- **A Python fixture's own venv poisoned the generic repo-wide scanners.** `sqlalchemy`/
  `uvicorn` pull in `greenlet`, which ships its OWN `@unittest.skipIf`-decorated test suite
  inside `site-packages` — `check-muted-test.mjs.ejs` (and its `check-skip-critical-e2e.mjs.ejs`
  / `check-no-stub-redirects.mjs.ejs` siblings) walked into `.venv/` and flagged a dependency's
  bundled tests as if they were the project's own. Fixed by adding `.venv`/`venv`/`__pycache__`
  to the shared `SKIP_DIRS` (`src/templates/scripts/lib/glob-walk.mjs.ejs` + the three literal
  duplicates) — `post-edit-dispatch.mjs.ejs` already excluded these paths; the walk-based
  checks had not caught up.

None of this required touching L2+ (the functional harness always runs the generated gate at
L1) — the pre-existing TS `testcontainers` note above and the equivalent Go
`testcontainers-go` gap in the generated `tests/main_test.go` (L2-only integration test) are
untouched, same as every other `backend-web-db` fixture today.

`examples/` viventi (generated projects committed under `examples/`, regenerated by a
drift-checking job, linked from the README) — the other half of #1836's F4 design line — is
**parked, not started**: today's `examples/` are hand-written Markdown walkthroughs, not
generated/committed projects, and there is no regeneration/drift-detection mechanism at all.
Building one is a new feature (a regenerate script + a CI drift check + README wiring), not a
tier flip; estimated 0.5–1 day once scoped as its own PR.

#### `examples/` viventi (#1840 F4 tranche 4, 2026-07-09) — DONE, closes #1840

Built exactly as parked above: `scripts/regenerate-examples.mjs` stages each of the 3 GA
`*-library` fixtures (TypeScript/Python/Go — same `library` archetype the Generator Matrix's
DEEP cells actually exercise, see the workflow's own header comment) into an isolated tmpdir
git repo, runs a REAL `arbiter init` through the BUILT `dist/cli.js` (a child process — proves
the packaged CLI path, not just the in-process generator), and either writes the result into
`examples/<lang>-library/` (`npm run examples:regenerate`) or diffs it against what's committed
(`npm run examples:check` / `--check`), failing on any divergence.

Reproducibility required two fixes, both reusing an existing determinism mechanism rather than
inventing a new one:

- `arbiter init` appends `.evidence/cmd-log.jsonl` (timestamp + duration + git HEAD sha) as a
  side effect of the invocation itself — a runtime audit log, not generator output. Suppressed
  at the source with `--no-evidence` (the flag already existed) rather than post-hoc-excluded.
- `.arbiter/detected-integrations.json` is written only when the CALLING MACHINE's `$HOME/
.claude` has skills installed — present on a dev host, absent in CI. No CLI flag suppresses
  the detection itself, so `regenerate-examples.mjs` deletes it post-generation, reusing the
  SAME exclusion the bake harness already applies to this exact file
  (`__tests__/integration/e2e/helpers.ts` `EXCLUDE_RELS`, #1685).
- The staging directory's basename leaks into rendered docs (derived project name) — pinned by
  always staging under a directory named after the fixture (e.g. `ts-library`), never a
  tmp-prefixed name.

Committing full generated output into the repo (rather than staging it into an ephemeral tmpdir
the way every other E2E harness here does) surfaced two repo-wide gates that had never seen
generated content before: `format` (`prettier --check .`, walks the whole repo) and `doc style`
(`check-doc-style.mjs`, frontmatter-checks every `.md` under `docs/`, `.claude/`, `examples/`,
…) both flagged the generated subtrees, because arbiter's OWN templates don't uniformly run
through `formatContent` (the tranche-3 finding — see above — fixed it for 3 `backend-web-db`
templates, not the whole corpus) and don't emit arbiter's OWN doc frontmatter convention (nor
should they — they're output for a DOWNSTREAM project). Fixed the same way
`__tests__/fixtures/real-projects/**/target/` is already excluded from `.prettierignore`:
added `examples/{ts,python,go}-library/` to `.prettierignore` and to
`check-doc-style.mjs`'s `SKIP_PATH_SEGMENTS` — narrowly, so the hand-written walkthroughs
directly under `examples/` (which DO carry arbiter's frontmatter convention) stay checked.

Wired into `.github/workflows/generator-matrix.yml`: a "Living examples drift" step runs
`node scripts/regenerate-examples.mjs --check --stack=${{ matrix.stack }}` in the typescript/
python/go cells only (Rust/Java have no living example — README §Stack support declares them
Experimental, not GA). TDD proof: tampering with a committed example file turns the check red
(`FAIL drift detected`); regenerating turns it green — see `__tests__/scripts/
regenerate-examples.test.ts` (pure `diffDirs`/`parseArgs` logic, offline/L1) and the
`generator-matrix-workflow.test.ts` addition locking the step's wiring and stack scope.

`examples/README.md` now documents the split explicitly (generated vs. hand-written), and
`examples/go-library.md` cross-links to the generated `examples/go-library/` since both cover
the same archetype — the walkthrough narrates the fuller `--level L2` tour by hand, the
generated directory is the literal, CI-verified `--level L1` output. Root `README.md` gained a
"See it for real" section linking all three.

This was the last open item under #1836's F4 line — closes #1840.

---

## v1 Fixture Set

| Fixture                      | Language   | Archetype      | Levels     |
| ---------------------------- | ---------- | -------------- | ---------- |
| `ts-library`                 | typescript | library        | L1, L2     |
| `ts-backend-web-db`          | typescript | backend-web-db | L1, L2     |
| `ts-frontend-spa`            | typescript | frontend-spa   | L1, L2     |
| `java-library-gradle`        | java       | library        | L1, L2     |
| `java-backend-web-db-gradle` | java       | backend-web-db | L1, L2     |
| `rust-library`               | rust       | library        | L1, L2     |
| `rust-cli`                   | rust       | cli            | L1, L2, L3 |
| `rust-embedded`              | rust       | embedded       | L1         |
| `go-library`                 | go         | library        | L1, L2     |
| `python-library`             | python     | library        | L1, L2     |
| `python-data-pipeline`       | python     | data-pipeline  | L1, L2, L3 |

11 fixtures (with varying levels) = 25 matrix jobs. The aggregate step requires ≥10 to pass.

Notes on archetype-specific fixtures:

- `rust-embedded`: `#![no_std]` library for Cortex-M targets (`thumbv7em-none-eabihf`). L1 only — cross-compilation requires `rustup target add thumbv7em-none-eabihf`. Tests run with the native toolchain via `#![cfg_attr(not(test), no_std)]`.
- `rust-cli`: binary crate with `clap` arg parsing. Buildable with stable Rust toolchain.
- `python-data-pipeline`: ETL module (read → transform → emit) with pytest. No build tool (`buildTool: null`).

---

## Language Detection

`arbiter init` auto-detects language and archetype from files on disk. Use `--language` or `--archetype` to override detection:

| Marker file                                        | Detected language |
| -------------------------------------------------- | ----------------- |
| `package.json`                                     | typescript        |
| `Cargo.toml`                                       | rust              |
| `build.gradle` / `pom.xml`                         | java              |
| `go.mod`                                           | go                |
| `pyproject.toml` / `requirements.txt` / `setup.py` | python            |

Archetype is derived from dependencies: fastify → `backend-web-db`, react → `frontend-spa`, spring-boot plugin → `backend-web-db`. Go/Python/Rust currently default to `library`.

Your fixture must include the appropriate marker file for detection to work.

---

## Adding a New Fixture

1. Create `__tests__/fixtures/real-projects/<your-fixture>/`.
2. Add a valid `manifest.json` (see schema above).
3. Add a real build config + source + test. The test must pass with `go test ./...` / `cargo test` / `pytest` / `npm test` / `./gradlew test`.
4. Run `node scripts/check-matrix-fixtures.mjs` locally — it should exit 0.
5. Run the relevant vitest harness (`fixture-bake.test.ts` / `fixture-functional.test.ts`, `VITEST_L2=1`) — confirm your fixture is picked up (`loadFixtureManifest`/`listFixtures`).
6. Dog-food locally (see below).

If you are adding a language that is already listed as "proven" in `src/compatibility/cross-language-matrix.json`, the L1 gate (`check-matrix-fixtures.mjs`) already requires a fixture for that language. Your new fixture satisfies that requirement.

If you are adding a new language to `cross-language-matrix.json` as "proven" for any category, you **must** add a fixture in the same PR. The L1 gate will fail otherwise.

---

## Dog-Fooding Locally

Copy a fixture to a temp directory, then run the full pipeline against it:

```bash
# Example: rust-library at L1
cp -r __tests__/fixtures/real-projects/rust-library /tmp/rust-smoke
cd /tmp/rust-smoke
node /path/to/arbiter/dist/cli.js init --yes --no-verify --level=L1
node /path/to/arbiter/dist/cli.js verify
node scripts/check-all.mjs L1
```

You need the language toolchain installed locally. If `cargo` / `go` / `python` / `./gradlew` is not in `PATH`, the `check-all.mjs` step will fail.

For L2 dog-fooding, mirror the nightly environment instead of relying on whatever happens to be installed on your machine. The generated gate now reports missing binaries explicitly as `FAIL (binary not found: <cmd>)`, which makes absent runner tooling a real regression signal instead of a vague spawn failure.

Recommended local L2 checklist:

- Install the base language toolchain for the fixture under test.
- Install `gitleaks` because every L2 fixture can invoke it.
- For Go fixtures, install `staticcheck` and `govulncheck`.
- For Rust fixtures, install `cargo-audit` and `cargo-tarpaulin`.
- For Python fixtures, install `pip-audit` and `pytest-cov`.
- For Java fixtures, ensure `gradlew` is executable after copying the fixture.

For TypeScript fixtures:

```bash
cp -r __tests__/fixtures/real-projects/ts-library /tmp/ts-smoke
cd /tmp/ts-smoke
npm install
node /path/to/arbiter/dist/cli.js init --yes --no-verify --level=L1
node scripts/check-all.mjs L1
```

For the TypeScript `backend-web-db` fixture at L2, install dependencies before running the generated gate and keep `testcontainers` in the fixture's devDependencies. `arbiter init --level=L2` generates `src/test/test-setup.ts` that imports `testcontainers`; if the fixture omits it, `tsc --noEmit` fails before the integration setup is exercised.

---

## Triggering the Nightly Manually

Use `workflow_dispatch` from the GitHub Actions UI or CLI:

```bash
gh workflow run real-project-matrix.yml --ref your-branch
```

Watch progress:

```bash
gh run watch
```

---

## Regression Coverage

The highest-friction nightly failures now have dedicated repo-level regression tests in addition to the end-to-end workflow itself:

- `__tests__/scripts/real-project-matrix-workflow.test.ts` locks the self-hosted workflow contract: Actions API permissions, pinned Gradle setup, and the extra L2 tools that the generated gates invoke.
- `__tests__/scripts/real-project-fixtures.test.ts` locks the fixture contract for the cells that previously regressed: TypeScript backend `testcontainers`, Python `pytest-cov`, Java fixture build/config wiring, and Rust `#[must_use]` annotations relied on by clippy pedantic.

If a future change updates the nightly workflow or one of the real-project fixtures, update these tests in the same PR. They exist to catch breakage before the nightly matrix becomes the first place a regression appears.

`greenfield-first-run.test.ts`, `go-debt-node-modules.test.ts`, and `record-red-runner.test.ts` (all under `__tests__/integration/e2e/functional/`) were, until #2257, wired into no CI workflow and no gate script — RED, but invisible. They now run nightly in `_nightly.yml`'s `generated-gate-e2e-greenfield` job (its own job, not folded into `generated-gate-e2e-misc`, because it needs Rust and Python toolchains neither sibling job installs).

That job's step must carry `GH_TOKEN: ${{ github.token }}` (#2314). `greenfield-first-run.test.ts`'s useGitHub cell runs `arbiter init --github`, and `src/detectors/github.ts` honours `--github` only when a live `gh auth status` reports an authenticated CLI. Without a token in the step env the flag resolves false, `init` emits no `.github/workflows` at all, and the cell's workflow-gate assertions fail — a suite that is green on any developer machine whose `gh` is logged in, and red in CI. `__tests__/templates/_nightly-render.test.ts` pins the token to the step so the env cannot be dropped again. (That `init --github` degrades silently rather than warning is the separate product defect #2315.)

---

## Troubleshooting

### `arbiter init` fails with "unknown language"

The fixture is missing its build marker file. Check that `package.json`, `Cargo.toml`, `build.gradle`, `go.mod`, or `pyproject.toml` exists at the project root.

### `check-all.mjs L1` fails for Java with "checkstyle" errors

The fixture's `config/checkstyle/checkstyle.xml` must exist and be valid. Checkstyle runs at L1 for Java+Gradle. Keep the ruleset minimal — the fixtures use only `IllegalImports`, `UpperEll`, `NoFinalizer`, `EmptyCatchBlock`.

Do not reference an external DTD from the fixture checkstyle file. The self-hosted runner may not be able to fetch remote DTDs, which turns a syntax-valid ruleset into a network-coupled failure before any Java code is checked.

### `check-all.mjs` fails with "gradlew: Permission denied"

The workflow adds a `chmod +x gradlew` step for Java fixtures. Locally, run `chmod +x gradlew` in the staged directory before invoking `check-all.mjs`.

### `check-all.mjs L2` fails with `binary not found`

The staged project invoked a tool that is part of the generated L2 gate, but the runner or local shell does not provide it. Match the installed tools to the fixture language:

- all L2 fixtures: `gitleaks`
- Go: `staticcheck`, `govulncheck`
- Rust: `cargo-audit`, `cargo-tarpaulin`
- Python: `pip-audit`, `pytest-cov`

If the workflow is missing one of these, fix the workflow. If your local repro is missing one of these, install it before treating the cell as a product regression.

### TypeScript coverage is unexpectedly low because `scripts/*.mjs` are counted

Vitest coverage for generated TypeScript projects must be scoped to `src/**`. Without that include filter, V8 coverage can absorb generated scripts and support files, which drags the total below the intended threshold even when the library or app code is adequately tested.

When debugging a TypeScript fixture:

- inspect `vitest.config.ts` after generation;
- confirm coverage includes `src/**`;
- treat coverage over helper scripts as a generator/config bug, not a fixture weakness.

### Java fixture fails before tests because a referenced Gradle/config file is missing

The Java fixtures are intentionally real, so `build.gradle` must not reference files or plugins that are absent from the fixture. Common examples are `apply from: 'gradle/jacoco.gradle'` and `config/checkstyle/checkstyle.xml`.

If Gradle fails during configuration:

- verify every referenced file exists inside the fixture;
- keep checkstyle self-contained so it does not depend on network fetches;
- keep the test dependencies aligned with the files Arbiter generates, including AssertJ and ArchUnit when the generated tests import them.

### TypeScript `backend-web-db` fixture fails at L2 with missing `testcontainers`

This fixture must declare `testcontainers` in `devDependencies`. L2 generation emits integration-test setup that imports `testcontainers`, so the dependency is required even before any container-backed test is executed.

### Python or Rust fixture passes L1 but fails L2

L2 is expected to be stricter than L1 because it adds coverage and security/dependency checks. Verify the fixture can satisfy the actual gate, not just the base test runner:

- Python fixtures need `pytest-cov` available for coverage and `pip-audit` for dependency audit.
- Rust fixtures need `cargo-audit` and `cargo-tarpaulin`, and public functions should satisfy the stricter lint surface that the generated project enables.

### Aggregate step fails with "only N of ≥10 passed"

Fewer than 10 matrix cells reported `conclusion === "success"` via the GitHub Jobs API. Check the individual run cells in the Actions UI — look for infra failures vs. real Arbiter regressions.

### `check-matrix-fixtures.mjs` fails with "language X has proven cells but no fixture"

A language is marked "proven" in `src/compatibility/cross-language-matrix.json` but has no fixture. Add a fixture for that language (see "Adding a New Fixture" above) or downgrade the maturity cell.

---

## INV-32

INV-32 is the invariant that links the fixture set to the maturity matrix:

> Every language with ≥1 proven cell in `src/compatibility/cross-language-matrix.json` must have a fixture under `__tests__/fixtures/real-projects/` with a valid `manifest.json`.

Enforced by:

- `scripts/check-matrix-fixtures.mjs` — runs at L1 gate, blocks PRs.
- `real-project-matrix.yml` — nightly workflow runs the fixtures end-to-end.
