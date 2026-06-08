---
generated: true
source: 'docs/DEVELOPMENT/REAL-PROJECT-TESTING.md'
source_sha: 'edd3092178578f2c7339526597d9f3a1ef5214e6'
last_updated: '2026-06-08'
---

# Real-Project Testing

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/DEVELOPMENT/REAL-PROJECT-TESTING.md](../docs/DEVELOPMENT/REAL-PROJECT-TESTING.md)

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
cp -r __tests__/fixtures/real-projects/rust-library /tmp

*[content truncated — see source for full text]*
```
