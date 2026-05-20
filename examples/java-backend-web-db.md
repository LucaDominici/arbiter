---
title: 'Example: java-backend-web-db'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Example: java-backend-web-db

End-to-end walkthrough of `arbiter init` on a Java 21 + Spring Boot 3 + Gradle backend with a database layer. The starter mirrors the reference fixture at `__tests__/fixtures/real-projects/java-backend-web-db-gradle/`.

## 1. Starter project (before `arbiter init`)

A minimal Spring Boot starter with Gradle wrapper, hexagonal layout, and pre-wired static-analysis configs (Checkstyle, PMD, SpotBugs, JaCoCo). The manifest declares the project as `backend-web-db`, detected from the `org.springframework.boot` plugin in `build.gradle`.

```
java-backend-web-db/
├── build.gradle            # spring-boot, jacoco, checkstyle, pmd, spotbugs
├── settings.gradle
├── gradlew
├── gradle/jacoco.gradle
├── config/
│   ├── checkstyle/checkstyle.xml
│   ├── pmd/ruleset.xml
│   └── spotbugs/spotbugs-exclude.xml
├── manifest.json           # { language: "java", archetype: "backend-web-db", buildTool: "gradle", architectureStyle: "hexagonal", basePackage: "com.example" }
└── src/                    # main/java + test/java skeleton
```

## 2. Run `arbiter init`

```bash
npx @arbiter/cli init \
  --dir ./java-backend-web-db \
  --tools claude \
  --level L2
```

Arbiter detects Gradle as the build tool from `build.gradle` and infers `hexagonal` from the manifest. To override on a brownfield project, pass `--architecture-style hexagonal --base-package com.example`.

## 3. Generated artifacts

Grouped by purpose. Filenames come from `src/generators/` and templates under `src/templates/java/backend-web-db/`.

**Governance contract**

- `AGENTS.md`, `arbiter.json`, `.arbiter-generated.json` — same canonical trio as every other stack.

**Gate scripts**

- `scripts/check-all.mjs` — orchestrator with Java-aware invocations of `./gradlew check`, JaCoCo coverage, and architecture probes.
- `scripts/check-arch-unit.mjs` — runs the ArchUnit suite (when present). Until M22 lands, the suite ships with `NoMockMvcTest` only and `scripts/check-all.mjs` skips additional ArchUnit rules with an explicit note.

**Git hooks**

- `.githooks/pre-commit` — runs `node scripts/check-all.mjs L1` (Gradle's `check` plus invariant scripts).
- `.githooks/pre-push` — runs `node scripts/check-all.mjs L2`.

**AI-tool configs (Claude Code)**

- `.claude/CLAUDE.md`, `.claude/settings.json`.
- `.claude/hooks/` — same hook set as the TypeScript example, plus Java-aware variants where applicable.
- `.claude/rules/*.md` — canon enforcement, TODO policy, refactor-first, exec protocol.

**CI**

- `.github/workflows/ci.yml` — runs the gate on every PR with Java 21 + Gradle cache.
- `.github/workflows/codeql.yml` (L2+).

**Java tooling**

- `build.gradle` is patched (not overwritten) to register Checkstyle, PMD, SpotBugs, and JaCoCo tasks under the umbrella `check` task. Existing user blocks are preserved.
- `config/checkstyle/checkstyle.xml`, `config/pmd/ruleset.xml`, `config/spotbugs/spotbugs-exclude.xml` are emitted only if missing.
- `gradle/jacoco.gradle` — coverage thresholds wired to the gate.

**Docs**

- `docs/SYSTEM/DECISIONS.md` ADR scaffold. CONTRIBUTING and CoC pointers at L2+.

## 4. Run the gate

```bash
./gradlew --version                # sanity check Java 21 toolchain
node scripts/check-all.mjs L1      # ./gradlew check + invariant scripts
node scripts/check-all.mjs L2      # adds JaCoCo coverage thresholds, ArchUnit, security scans
```

L1 wraps `./gradlew check` so it runs Checkstyle, PMD, SpotBugs, unit tests, and the invariant scripts. L2 enforces coverage and architecture rules. The Gradle daemon is reused across invocations.

## 5. Demo: ratchet on a brownfield clone

This is the highest-value demonstration for Java. Clone any real Spring Boot project, run `arbiter init`, and run the gate. The initial run records a ratchet baseline at `.arbiter/ratchet-baseline.json` capturing the current count of pre-existing violations.

Subsequent edits must not increase that count. If you add a new method without a unit test, the gate fails with a delta against the baseline. If you fix five existing violations, the baseline is automatically tightened on the next clean run.

```bash
# After arbiter init, in a brownfield repo:
git add .
node scripts/check-all.mjs L1
# Baseline recorded. Subsequent edits ratchet downward.
```

This is the mechanism that makes arbiter adoptable on legacy codebases without a Big Bang cleanup.

## 6. See the enforcement chain fire

Add a `TODO` without a task ID in any `*.java` file:

```java
// TODO: refactor this later
```

The `check-no-orphan-todo.mjs` hook rejects the edit (INV-21). The fix is `TODO(#NNN): refactor this later` with a real issue number.

Try `git commit` after writing the same code directly to disk — the pre-commit hook re-runs the check and rejects the commit.

## 7. Typical follow-up edits

- Add a new aggregate under `src/main/java/com/example/<bounded-context>/`. ArchUnit (when M22 lands) will enforce hexagonal boundaries on the bounded context.
- Add a new ADR in `docs/SYSTEM/DECISIONS.md` for any new external dependency.
- Adjust coverage thresholds in `gradle/jacoco.gradle` only after recording the rationale as an ADR.
