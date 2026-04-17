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
  ├─ cp fixture → $RUNNER_TEMP/project
  ├─ node dist/cli.js init --yes --no-verify --level=$LEVEL
  ├─ node dist/cli.js verify
  └─ node scripts/check-all.mjs $LEVEL  (inside the staged project)

aggregate job
  └─ node scripts/aggregate-matrix-result.mjs
       queries GitHub Jobs API for this run
       asserts ≥10 cells with conclusion=success
```

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
  "note":       "optional human note"
}
```

Three fields are required: `language`, `archetype`, and `levels`. `buildTool` is optional — include it when applicable (e.g., `"gradle"` for Java), omit or set to `null` otherwise. `note` is optional.

---

## v1 Fixture Set

| Fixture                      | Language   | Archetype      | Levels |
| ---------------------------- | ---------- | -------------- | ------ |
| `ts-library`                 | typescript | library        | L1, L2 |
| `ts-backend-web-db`          | typescript | backend-web-db | L1, L2 |
| `ts-frontend-spa`            | typescript | frontend-spa   | L1, L2 |
| `java-library-gradle`        | java       | library        | L1, L2 |
| `java-backend-web-db-gradle` | java       | backend-web-db | L1, L2 |
| `rust-library`               | rust       | library        | L1, L2 |
| `go-library`                 | go         | library        | L1, L2 |
| `python-library`             | python     | library        | L1, L2 |

8 fixtures × 2 levels = 16 matrix jobs. The aggregate step requires ≥10 to pass.

---

## Language Detection

`arbiter init` has no `--language` or `--archetype` flags. It detects both from files on disk:

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

For TypeScript fixtures:

```bash
cp -r __tests__/fixtures/real-projects/ts-library /tmp/ts-smoke
cd /tmp/ts-smoke
npm install --legacy-peer-deps
node /path/to/arbiter/dist/cli.js init --yes --no-verify --level=L1
node scripts/check-all.mjs L1
```

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

## Troubleshooting

### `arbiter init` fails with "unknown language"

The fixture is missing its build marker file. Check that `package.json`, `Cargo.toml`, `build.gradle`, `go.mod`, or `pyproject.toml` exists at the project root.

### `check-all.mjs L1` fails for Java with "checkstyle" errors

The fixture's `config/checkstyle/checkstyle.xml` must exist and be valid. Checkstyle runs at L1 for Java+Gradle. Keep the ruleset minimal — the fixtures use only `IllegalImports`, `UpperEll`, `NoFinalizer`, `EmptyCatchBlock`.

### `check-all.mjs` fails with "gradlew: Permission denied"

The workflow adds a `chmod +x gradlew` step for Java fixtures. Locally, run `chmod +x gradlew` in the staged directory before invoking `check-all.mjs`.

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
