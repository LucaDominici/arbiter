---
title: 'Stack Support Reference'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Stack Support Reference

Per-language reference for Arbiter's detection, build commands, CI configuration, hooks, and governance.

---

## Language Detection

Arbiter checks for marker files in priority order. The first match wins.

| Priority | Marker File(s)                                       | Detected Language |
| -------- | ---------------------------------------------------- | ----------------- |
| 0        | `package.json` + JVM build file (root or `backend/`) | `multi`           |
| 1        | `package.json` alone                                 | TypeScript        |
| 2        | `Cargo.toml`                                         | Rust              |
| 3        | `pom.xml`, `build.gradle`, or `build.gradle.kts`     | Java              |
| 4        | `go.mod`                                             | Go                |
| 5        | `pyproject.toml`, `setup.py`, or `requirements.txt`  | Python            |
| —        | None of the above                                    | `unknown`         |

---

## Per-Language Reference

### TypeScript

| Property          | Value                                                         |
| ----------------- | ------------------------------------------------------------- |
| **Detection**     | `package.json` present                                        |
| **Build tool**    | `npm`                                                         |
| **Test command**  | `npm test`                                                    |
| **Lint tool**     | ESLint                                                        |
| **Format tool**   | Prettier                                                      |
| **Language hook** | `check-no-any.mjs` — blocks `: any` type annotations (INV-04) |

**AGENTS.md invariants:** INV-04 (no `any`), INV-05 (no unused exports)

---

### Java

Build tool auto-detected: Gradle when `gradlew`/`build.gradle` present; Maven when only `pom.xml`.

| Property          | Gradle                     | Maven                     |
| ----------------- | -------------------------- | ------------------------- |
| **Build command** | `./gradlew build -x test`  | `mvn package -DskipTests` |
| **Test command**  | `./gradlew test`           | `mvn test`                |
| **Lint command**  | `./gradlew checkstyleMain` | `mvn checkstyle:check`    |

**AGENTS.md invariants:** INV-03 (hexagonal architecture), INV-04 (no raw types), INV-05 (cyclomatic complexity)

---

### Rust

| Property          | Value                 |
| ----------------- | --------------------- |
| **Detection**     | `Cargo.toml` present  |
| **Build tool**    | `cargo`               |
| **Lint tool**     | Clippy                |
| **Format tool**   | rustfmt               |
| **Language hook** | `check-no-unwrap.mjs` |

**AGENTS.md invariants:** INV-04 (no `.unwrap()`), INV-05 (no `unsafe` without ADR)

---

### Go

| Property          | Value                        |
| ----------------- | ---------------------------- |
| **Detection**     | `go.mod` present             |
| **Build tool**    | `go`                         |
| **Lint tool**     | golangci-lint                |
| **Format tool**   | gofmt                        |
| **Language hook** | `check-no-unchecked-err.mjs` |

**AGENTS.md invariants:** INV-04 (explicit error handling), INV-05 (`go vet` clean)

---

### Python

| Property          | Value                                                       |
| ----------------- | ----------------------------------------------------------- |
| **Detection**     | `pyproject.toml`, `setup.py`, or `requirements.txt` present |
| **Build tool**    | `pip`                                                       |
| **Test command**  | `pytest`                                                    |
| **Lint tool**     | Ruff                                                        |
| **Format tool**   | Ruff                                                        |
| **Language hook** | `check-no-bare-except.mjs`                                  |

**AGENTS.md invariants:** INV-04 (type annotations), INV-05 (`ruff check` clean)

---

## Feature Matrix

| Feature              | TypeScript        | Java (Gradle/Maven)    | Rust              | Go                       | Python                 |
| -------------------- | ----------------- | ---------------------- | ----------------- | ------------------------ | ---------------------- |
| Language detection   | Yes               | Yes                    | Yes               | Yes                      | Yes                    |
| Framework detection  | Yes (10 variants) | Yes (3 variants)       | Yes (2 variants)  | No                       | No                     |
| CI workflow          | Yes               | Yes (both build tools) | Yes               | Yes                      | Yes                    |
| Language hooks       | `check-no-any`    | None                   | `check-no-unwrap` | `check-no-unchecked-err` | `check-no-bare-except` |
| Dependabot ecosystem | npm               | gradle / maven         | cargo             | gomod                    | pip                    |
