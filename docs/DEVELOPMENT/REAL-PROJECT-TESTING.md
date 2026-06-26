---
title: 'Real-Project Testing'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/method']
related: []
---

# Real-Project Testing

Arbiter's nightly CI workflow (`real-project-matrix.yml`) stages minimal real-project fixtures and runs the full pipeline — `arbiter init → arbiter verify → check-all.mjs` — against each one. This document explains how the system works, how to add a new fixture, and how to debug failures.

See ADR-027 for the architectural rationale.

---

## How It Works

```
discover job
  └─ node scripts/build-matrix.mjs
       reads __tests__/fixtures/real-projects/*/manifest.json
       emits { include: [ { fixture, language, level, archetype } … ] }

run job (matrix fan-out, one cell per fixture × level)
  ├─ checkout + build arbiter
  ├─ install per-language toolchain (setup-java/go/python/rust)
  ├─ install extra L2 binaries when the generated gate requires them
  ├─ cp fixture → $RUNNER_TEMP/project
  ├─ node dist/cli.js init --yes --no-verify --level=$LEVEL
  ├─ node dist/cli.js verify
  └─ node scripts/check-all.mjs $LEVEL  (inside the staged project)

aggregate job
  └─ node scripts/aggregate-matrix-result.mjs
       queries GitHub Jobs API for this run
       asserts ≥10 cells with conclusion=success
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

| Tier         | What runs against the fixture                                                   | Use when                                             |
| ------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `snapshot`   | Manifest validation only — no `arbiter init`, no exec                           | Pure data/docs fixtures (`markdown-only`)            |
| `bake`       | `arbiter init` → structural snapshot diff → parse generated manifests (no exec) | Most fixtures (`backend-*`, `bdd`, `frontend-spa` …) |
| `functional` | `bake` + execute the generated project's own L1 gate inside a clean tmpdir copy | Smallest cheapest fixture per stack (`*-library`)    |

The bake-and-run harness lives in `__tests__/e2e/bake/` and `__tests__/e2e/functional/`. Industry pattern reference: Nx (`create-nx-workspace` Verdaccio), Cookiecutter (`pytest-cookies`), Spring Initializr (`initializr-generator-test`).

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
5. Run `node scripts/build-matrix.mjs` — confirm your fixture appears in the output.
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
