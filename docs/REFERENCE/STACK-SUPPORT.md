# Stack Support Reference

Per-language reference for Arbiter's detection, build commands, CI configuration, hooks, and governance.

Source files: `src/detectors/language.ts`, `src/detectors/build.ts`, `src/detectors/framework.ts`, `src/detectors/language-hooks.ts`.

---

## Language Detection

Arbiter checks for marker files in priority order. The first match wins.

| Priority | Marker File(s)                                      | Detected Language |
| -------- | --------------------------------------------------- | ----------------- |
| 1        | `package.json`                                      | TypeScript        |
| 2        | `Cargo.toml`                                        | Rust              |
| 3        | `pom.xml`, `build.gradle`, or `build.gradle.kts`    | Java              |
| 4        | `go.mod`                                            | Go                |
| 5        | `pyproject.toml`, `setup.py`, or `requirements.txt` | Python            |
| —        | None of the above                                   | `unknown`         |

**Note:** `package.json` always wins. A project with both `package.json` and `Cargo.toml` (e.g., a Tauri app) is detected as TypeScript. Framework detection then identifies the Tauri sub-stack.

---

## Framework Detection

After language detection, Arbiter checks for framework signals.

### TypeScript Frameworks

Detected by scanning `package.json` dependencies/devDependencies/peerDependencies and filesystem markers.

| Signal                         | Detected Framework |
| ------------------------------ | ------------------ |
| `src-tauri/` dir + `react` dep | `tauri+react`      |
| `src-tauri/` dir + `vue` dep   | `tauri+vue`        |
| `src-tauri/` dir (alone)       | `tauri`            |
| `next` dep                     | `next`             |
| `express` + `react` deps       | `express+react`    |
| `express` + `vue` deps         | `express+vue`      |
| `express` dep (alone)          | `express`          |
| `fastify` dep                  | `fastify`          |
| `vue` dep (alone)              | `vue`              |
| `react` dep (alone)            | `react`            |

Priority order matches the table above (first match wins).

### Rust Frameworks

| Signal           | Detected Framework |
| ---------------- | ------------------ |
| `src-tauri/` dir | `tauri`            |
| Default          | `rust`             |

### Java Frameworks

Detected by scanning `build.gradle` or `pom.xml` content.

| Signal                      | Detected Framework |
| --------------------------- | ------------------ |
| `spring-boot` in build file | `spring-boot`      |
| `quarkus` in build file     | `quarkus`          |
| Default                     | `java`             |

### Go / Python

No framework detection implemented. Returns `null`.

---

## Per-Language Reference

### TypeScript

| Property           | Value                                                                    |
| ------------------ | ------------------------------------------------------------------------ |
| **Detection**      | `package.json` present                                                   |
| **Build tool**     | `npm`                                                                    |
| **Build command**  | `npm run build` (or from `package.json` scripts)                         |
| **Test command**   | `npm test` (or from `package.json` scripts)                              |
| **Lint tool**      | ESLint (detected from `package.json` scripts.lint)                       |
| **Lint command**   | `npm run lint` (or `echo "no lint configured"` if absent)                |
| **Format tool**    | Prettier (detected from `package.json` content)                          |
| **Format command** | `npx prettier --check .` (or `echo "no formatter configured"` if absent) |

**CI workflow** (`ci.yml`):

- Node.js 20, npm cache
- Steps: `npm ci` -> `npm run typecheck` -> `npm run lint` -> `npm test -- --coverage`

**Quality gate** (`check-all.mjs`):

- L1: `tsc --noEmit`, `prettier --check .`, `eslint src`, `npm test`
- L2: L1 + `npm audit --audit-level=high`

**Language-specific hooks:**

- `check-no-any.mjs` — Blocks `: any` type annotations (INV-04)

**AGENTS.md invariants:**

- INV-04: No `any` type in TypeScript
- INV-05: No unused exports (dead code elimination)

**AGENTS.md coding standards:**

- Strict mode always on
- No `any` — use `unknown` and narrow
- Prefer `const` over `let`, never `var`
- Async/await over callbacks
- Named exports preferred
- File naming: `kebab-case.ts`

**Coverage thresholds** (from AGENTS.md):

- L1: 70%
- L2: 80%
- L3: 85%

---

### Java

Build tool is auto-detected: Gradle takes priority; Maven is used when only `pom.xml` is present.

**Gradle** (detected when `gradlew`, `build.gradle`, or `build.gradle.kts` is present):

| Property           | Value                                                        |
| ------------------ | ------------------------------------------------------------ |
| **Build tool**     | `gradle`                                                     |
| **Build command**  | `./gradlew build -x test` (uses wrapper if `gradlew` exists) |
| **Test command**   | `./gradlew test`                                             |
| **Lint command**   | `./gradlew checkstyleMain`                                   |
| **Format command** | `echo "no formatter configured"`                             |

**Maven** (detected when only `pom.xml` is present, no Gradle files):

| Property           | Value                            |
| ------------------ | -------------------------------- |
| **Build tool**     | `maven`                          |
| **Build command**  | `mvn package -DskipTests`        |
| **Test command**   | `mvn test`                       |
| **Lint command**   | `mvn checkstyle:check`           |
| **Format command** | `echo "no formatter configured"` |

**CI workflow** (`ci.yml`):

- Java 21 Temurin, `actions/setup-java@v4`
- Gradle: `gradle/actions/setup-gradle@v3` + `./gradlew checkstyleMain` -> `./gradlew test`
- Maven: `mvn checkstyle:check` -> `mvn test` (no `setup-gradle`)

**Quality gate** (`check-all.mjs`):

- L1 (Gradle): `./gradlew checkstyleMain`, `./gradlew test`
- L1 (Maven): `mvn checkstyle:check`, `mvn test`
- L2: L1 + `./gradlew integrationTest` (Gradle) or `mvn verify -DskipUTs` (Maven)

**Language-specific hooks:** None (only common hooks apply).

**AGENTS.md invariants:**

- INV-03: Hexagonal architecture — domain must not import from adapters
- INV-04: No raw types — generics must be parameterized
- INV-05: Cyclomatic complexity <= 15, method length <= 65 LOC

**AGENTS.md coding standards:**

- Hexagonal architecture: domain has no framework imports
- Constructor injection exclusively
- Records for immutable DTOs
- Explicit `@Nullable` for nullable fields

**Dependabot ecosystem:** `gradle`

---

### Rust

| Property           | Value                                                                            |
| ------------------ | -------------------------------------------------------------------------------- |
| **Detection**      | `Cargo.toml` present                                                             |
| **Build tool**     | `cargo`                                                                          |
| **Build command**  | `cargo build` (appends `--manifest-path src-tauri/Cargo.toml` if Tauri detected) |
| **Test command**   | `cargo test`                                                                     |
| **Lint tool**      | Clippy                                                                           |
| **Lint command**   | `cargo clippy -- -D warnings`                                                    |
| **Format tool**    | rustfmt                                                                          |
| **Format command** | `cargo fmt --check`                                                              |

**CI workflow** (`ci.yml`):

- Rust stable toolchain with `clippy` + `rustfmt` components, Swatinem/rust-cache
- Steps: `cargo fmt --check` -> `cargo clippy -- -D warnings` -> `cargo test`

**Quality gate** (`check-all.mjs`):

- L1: `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`
- L2: L1 + `cargo audit`

**Language-specific hooks:**

- `check-no-unwrap.mjs` — Blocks `.unwrap()` calls (INV-04)

**AGENTS.md invariants:**

- INV-04: No `.unwrap()` calls — use `?` or explicit error handling
- INV-05: No `unsafe` blocks without ADR approval

**AGENTS.md coding standards:**

- All public items must have doc comments
- Error handling via `?` and typed `Result<T, E>`
- `clippy::pedantic` lint level
- Prefer `&str` over `String` in function parameters

**Dependabot ecosystem:** `cargo`

---

### Go

| Property           | Value               |
| ------------------ | ------------------- |
| **Detection**      | `go.mod` present    |
| **Build tool**     | `go`                |
| **Build command**  | `go build ./...`    |
| **Test command**   | `go test ./...`     |
| **Lint tool**      | golangci-lint       |
| **Lint command**   | `golangci-lint run` |
| **Format tool**    | gofmt               |
| **Format command** | `gofmt -l .`        |

**CI workflow** (`ci.yml`):

- Go 1.22+, `actions/setup-go@v5` with `go-version-file: 'go.mod'`
- Steps: `go vet ./...` -> `golangci-lint run` -> `go test ./... -race -coverprofile=coverage.out`

**Quality gate** (`check-all.mjs`):

- L1: `go vet ./...`, `golangci-lint run`, `go test ./...`
- L2: L1 + `staticcheck ./...`

**Language-specific hooks:**

- `check-no-unchecked-err.mjs` — Blocks `_ = ` patterns that discard error returns (INV-04)

**AGENTS.md invariants:**

- INV-04: Explicit error handling required — no `_ = err` patterns
- INV-05: `go vet` must pass clean with zero warnings

**AGENTS.md coding standards:**

- All exported functions and types must have doc comments
- Errors must be explicitly handled — never discard with `_`
- Format with `gofmt` before every commit
- `golangci-lint` lint level for consistent style
- Prefer table-driven tests with `t.Run` subtests
- File naming: `snake_case.go`

**Framework detection:** None.

**Dependabot ecosystem:** `gomod`

---

### Python

| Property           | Value                                                       |
| ------------------ | ----------------------------------------------------------- |
| **Detection**      | `pyproject.toml`, `setup.py`, or `requirements.txt` present |
| **Build tool**     | `pip`                                                       |
| **Build command**  | `pip install -e .`                                          |
| **Test command**   | `pytest`                                                    |
| **Lint tool**      | Ruff                                                        |
| **Lint command**   | `ruff check .`                                              |
| **Format tool**    | Ruff                                                        |
| **Format command** | `ruff format --check .`                                     |

**CI workflow** (`ci.yml`):

- Python 3.12, `actions/setup-python@v5`
- Steps: `pip install -e ".[dev]"` -> `ruff check .` -> `ruff format --check .` -> `pytest --cov`

**Quality gate** (`check-all.mjs`):

- L1: `ruff check .`, `ruff format --check .`, `pytest`
- L2: L1 + `pip-audit`

**Language-specific hooks:**

- `check-no-bare-except.mjs` — Blocks bare `except:` clauses (always specify exception type)

**AGENTS.md invariants:**

- INV-04: Type annotations required on all public function signatures
- INV-05: `ruff check` must pass clean with zero warnings

**AGENTS.md coding standards:**

- Type annotations required on all public functions and methods
- Linting and formatting via `ruff` (replaces flake8, black, isort)
- Tests with `pytest` using fixtures, not bare unittest
- No bare `except:` — always specify the exception type
- File naming: `snake_case.py`
- Prefer dataclasses or Pydantic for structured data

**Framework detection:** None.

**Dependabot ecosystem:** `pip`

---

## Feature Matrix

Summary of what is fully implemented per language versus planned.

| Feature                      | TypeScript              | Java (Gradle/Maven)    | Rust                  | Go                           | Python                     |
| ---------------------------- | ----------------------- | ---------------------- | --------------------- | ---------------------------- | -------------------------- |
| Language detection           | Yes                     | Yes                    | Yes                   | Yes                          | Yes                        |
| Framework detection          | Yes (10 variants)       | Yes (3 variants)       | Yes (2 variants)      | No                           | No                         |
| Build commands               | Yes (from package.json) | Yes (Gradle + Maven)   | Yes (Cargo)           | Yes                          | Yes                        |
| CI workflow                  | Yes                     | Yes (both build tools) | Yes                   | Yes                          | Yes                        |
| Quality gate (check-all.mjs) | Yes                     | Yes (both build tools) | Yes                   | Yes                          | Yes                        |
| Language hooks               | `check-no-any.mjs`      | None                   | `check-no-unwrap.mjs` | `check-no-unchecked-err.mjs` | `check-no-bare-except.mjs` |
| AGENTS.md coding standards   | Yes                     | Yes                    | Yes                   | Yes                          | Yes                        |
| AGENTS.md invariants         | INV-04, INV-05          | INV-03, INV-04, INV-05 | INV-04, INV-05        | INV-04, INV-05               | INV-04, INV-05             |
| Dependabot ecosystem         | npm                     | gradle / maven         | cargo                 | gomod                        | pip                        |
