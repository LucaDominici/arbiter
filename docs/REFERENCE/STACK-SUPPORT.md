# Stack Support Reference

Per-language reference for Arbiter's detection, build commands, CI configuration, hooks, and governance.

Source files: `src/detectors/language.ts`, `src/detectors/build.ts`, `src/detectors/framework.ts`, `src/detectors/language-hooks.ts`.

---

## Language Detection

Arbiter checks for marker files in priority order. The first match wins.

| Priority | Marker File(s) | Detected Language |
|----------|----------------|-------------------|
| 1 | `package.json` | TypeScript |
| 2 | `Cargo.toml` | Rust |
| 3 | `pom.xml`, `build.gradle`, or `build.gradle.kts` | Java |
| 4 | `go.mod` | Go |
| 5 | `pyproject.toml`, `setup.py`, or `requirements.txt` | Python |
| — | None of the above | `unknown` |

**Note:** `package.json` always wins. A project with both `package.json` and `Cargo.toml` (e.g., a Tauri app) is detected as TypeScript. Framework detection then identifies the Tauri sub-stack.

---

## Framework Detection

After language detection, Arbiter checks for framework signals.

### TypeScript Frameworks

Detected by scanning `package.json` dependencies/devDependencies/peerDependencies and filesystem markers.

| Signal | Detected Framework |
|--------|--------------------|
| `src-tauri/` dir + `react` dep | `tauri+react` |
| `src-tauri/` dir + `vue` dep | `tauri+vue` |
| `src-tauri/` dir (alone) | `tauri` |
| `next` dep | `next` |
| `express` + `react` deps | `express+react` |
| `express` + `vue` deps | `express+vue` |
| `express` dep (alone) | `express` |
| `fastify` dep | `fastify` |
| `vue` dep (alone) | `vue` |
| `react` dep (alone) | `react` |

Priority order matches the table above (first match wins).

### Rust Frameworks

| Signal | Detected Framework |
|--------|--------------------|
| `src-tauri/` dir | `tauri` |
| Default | `rust` |

### Java Frameworks

Detected by scanning `build.gradle` or `pom.xml` content.

| Signal | Detected Framework |
|--------|--------------------|
| `spring-boot` in build file | `spring-boot` |
| `quarkus` in build file | `quarkus` |
| Default | `java` |

### Go / Python

No framework detection implemented. Returns `null`.

---

## Per-Language Reference

### TypeScript

| Property | Value |
|----------|-------|
| **Detection** | `package.json` present |
| **Build tool** | `npm` |
| **Build command** | `npm run build` (or from `package.json` scripts) |
| **Test command** | `npm test` (or from `package.json` scripts) |
| **Lint tool** | ESLint (detected from `package.json` scripts.lint) |
| **Lint command** | `npm run lint` (or `echo "no lint configured"` if absent) |
| **Format tool** | Prettier (detected from `package.json` content) |
| **Format command** | `npx prettier --check .` (or `echo "no formatter configured"` if absent) |

**CI workflow** (`ci.yml`):
- Node.js 20, npm cache
- Steps: `npm ci` -> `npm run typecheck` -> `npm run lint` -> `npm test -- --coverage`

**Quality gate** (`check-all.sh`):
- L1: `tsc --noEmit`, `prettier --check .`, `eslint src`, `npm test`
- L2: L1 + `npm audit --audit-level=high`

**Language-specific hooks:**
- `check-no-any.sh` — Blocks `: any` type annotations (INV-04)

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

| Property | Value |
|----------|-------|
| **Detection** | `pom.xml`, `build.gradle`, or `build.gradle.kts` present |
| **Build tool** | `gradle` |
| **Build command** | `./gradlew build -x test` (uses wrapper if `gradlew` exists) |
| **Test command** | `./gradlew test` |
| **Lint tool** | Checkstyle |
| **Lint command** | `./gradlew checkstyleMain` |
| **Format tool** | None configured by default |
| **Format command** | `echo "no formatter configured"` |

**CI workflow** (`ci.yml`):
- Java 21 Temurin, Gradle setup via `gradle/actions/setup-gradle@v3`
- Steps: `./gradlew checkstyleMain` -> `./gradlew test`

**Quality gate** (`check-all.sh`):
- L1: `./gradlew checkstyleMain -q`, `./gradlew test -q`
- L2: L1 + `./gradlew integrationTest -q`

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

| Property | Value |
|----------|-------|
| **Detection** | `Cargo.toml` present |
| **Build tool** | `cargo` |
| **Build command** | `cargo build` (appends `--manifest-path src-tauri/Cargo.toml` if Tauri detected) |
| **Test command** | `cargo test` |
| **Lint tool** | Clippy |
| **Lint command** | `cargo clippy -- -D warnings` |
| **Format tool** | rustfmt |
| **Format command** | `cargo fmt --check` |

**CI workflow** (`ci.yml`):
- Rust stable toolchain with `clippy` + `rustfmt` components, Swatinem/rust-cache
- Steps: `cargo fmt --check` -> `cargo clippy -- -D warnings` -> `cargo test`

**Quality gate** (`check-all.sh`):
- L1: `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`
- L2: L1 + `cargo audit`

**Language-specific hooks:**
- `check-no-unwrap.sh` — Blocks `.unwrap()` calls (INV-04)

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

| Property | Value |
|----------|-------|
| **Detection** | `go.mod` present |
| **Build tool** | `go` |
| **Build command** | `go build ./...` |
| **Test command** | `go test ./...` |
| **Lint tool** | golangci-lint |
| **Lint command** | `golangci-lint run` |
| **Format tool** | gofmt |
| **Format command** | `gofmt -l .` |

**CI workflow:** Not yet implemented (no Go-specific branch in `ci.yml.ejs`).

**Quality gate:** Not yet implemented (no Go-specific branch in `check-all.sh.ejs`).

**Language-specific hooks:** None.

**AGENTS.md invariants:** Common invariants only (INV-01, INV-02, INV-06 through INV-10).

**AGENTS.md coding standards:** Not yet implemented (no Go-specific branch in `AGENTS.md.ejs`).

**Framework detection:** None.

**Dependabot ecosystem:** Not yet configured (no Go branch in `dependabot.yml.ejs`).

---

### Python

| Property | Value |
|----------|-------|
| **Detection** | `pyproject.toml`, `setup.py`, or `requirements.txt` present |
| **Build tool** | `pip` |
| **Build command** | `pip install -e .` |
| **Test command** | `pytest` |
| **Lint tool** | Ruff |
| **Lint command** | `ruff check .` |
| **Format tool** | Ruff |
| **Format command** | `ruff format --check .` |

**CI workflow:** Not yet implemented (no Python-specific branch in `ci.yml.ejs`).

**Quality gate:** Not yet implemented (no Python-specific branch in `check-all.sh.ejs`).

**Language-specific hooks:** None.

**AGENTS.md invariants:** Common invariants only (INV-01, INV-02, INV-06 through INV-10).

**AGENTS.md coding standards:** Not yet implemented (no Python-specific branch in `AGENTS.md.ejs`).

**Framework detection:** None.

**Dependabot ecosystem:** Not yet configured (no Python/pip branch in `dependabot.yml.ejs`).

---

## Feature Matrix

Summary of what is fully implemented per language versus planned.

| Feature | TypeScript | Java | Rust | Go | Python |
|---------|-----------|------|------|----|--------|
| Language detection | Yes | Yes | Yes | Yes | Yes |
| Framework detection | Yes (10 variants) | Yes (3 variants) | Yes (2 variants) | No | No |
| Build commands | Yes (from package.json) | Yes (Gradle) | Yes (Cargo) | Yes | Yes |
| CI workflow | Yes | Yes | Yes | Planned | Planned |
| Quality gate (check-all.sh) | Yes | Yes | Yes | Planned | Planned |
| Language hooks | `check-no-any.sh` | None | `check-no-unwrap.sh` | None | None |
| AGENTS.md coding standards | Yes | Yes | Yes | Planned | Planned |
| AGENTS.md invariants | INV-04, INV-05 | INV-03, INV-04, INV-05 | INV-04, INV-05 | Common only | Common only |
| Dependabot ecosystem | npm | gradle | cargo | Planned | Planned |
