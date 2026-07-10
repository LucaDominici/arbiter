---
title: 'Reference: Java gold tooling wiring'
doc_version: '1.0.0'
status: active
last_review: '2026-07-10'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: []
---

# Reference: Java gold tooling wiring

How arbiter wires the Java static-analysis kit (checkstyle, pmd, spotbugs, spotless, pitest)
and the scaffolded test suites into a target's **Gradle root build** (#1884, the #1835-class
"scaffolded but not wired" fix). Before this, the generated gate called
`./gradlew checkstyleMain spotlessCheck pmdMain spotbugsMain pitest` on a build that never
applied a single plugin — `Task 'checkstyleMain' not found` on the very first run.

## Architecture (empirically constrained — Gradle 8.8)

Two Gradle facts force injection into the **root build script** rather than `apply from:` alone:

1. The `plugins {}` DSL is **illegal inside applied scripts** — third-party plugins (spotless,
   spotbugs, pitest) can only be declared in the root build's plugins block.
2. Applied scripts **cannot see the root plugin classpath** (script-plugin classloader
   isolation): an applied Groovy script cannot even `import com.github.spotbugs.snom.Effort`,
   so enum-typed extension config (SpotBugs `effort`/`reportLevel`) must live in the root
   build too. In the Groovy DSL a direct enum-constant reference (`Confidence.MEDIUM`)
   resolves to the constant's **inner class** (constants with bodies), so the injected Groovy
   uses `valueOf('MEDIUM')`.

`src/utils/gradle.ts` (`injectGradleWiring`) is the single read-modify-write choke-point — the
`mutatePackageJson` of the JVM lane:

- **plugins** → into the root `plugins {}` block (created after imports/`buildscript` when
  absent), Kotlin or Groovy dialect chosen by the build file on disk;
- **config blocks + `apply(from=…)` + test deps** → into one marker-delimited managed block
  (`>>> arbiter:java-tooling` … `<<< arbiter:java-tooling`) appended at EOF;
- **fill-gaps-only**: every piece has a presence signature (plugin id, `checkstyle {` block,
  `group:artifact`) — brownfield declarations and pinned versions always win, re-runs are
  byte-identical;
- **guarded apply**: a target script still carrying the pre-fix `plugins {}` shape (possible
  when a user-modified file is withheld from template fixes, #1344) is NOT applied — wiring it
  would turn a dormant scaffold into a hard build failure. A logger warning explains the skip.
- **guarded apply — brownfield-inline (#1898)**: `safeApplyFromSnippet` also withholds when
  either (a) the root build already configures the same tooling **inline** (`rootBuildSignatures`
  option — brownfield authored `spotless {}`/`spotbugs {}`/the archunit dependency directly, or a
  pre-#1884 arbiter run did before config moved into the root managed block), or (b) the
  standalone script still `import`s a plugin-provided class (`com.github.spotbugs.*` /
  `com.diffplug.*` — the pre-#1884 shape, which can never resolve under classloader isolation
  regardless of inline config). Confirmed on a real brownfield repo: a relic `spotbugs.gradle`
  importing `com.github.spotbugs.snom.Effort` crashed the build the instant it was applied
  (`unable to resolve class ...Effort`) — both guards are logged (`gradle.apply_from_withheld`).

## What is wired, when

| Tier                                             | Emitted                                                                                                                     | Wired into root build                                                                                                                                                                   |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every Java init (even L1)                        | `config/checkstyle.xml`, `spotless.gradle`                                                                                  | `checkstyle` + `com.diffplug.spotless` plugins, checkstyle config block, `apply from: 'spotless.gradle'` — the L1 gate already runs `checkstyleMain spotlessCheck test` (B4/#1491 rule) |
| `enableDebtGates` (L2+)                          | `config/pmd-ruleset.xml`, `config/spotbugs-exclude.xml`, `spotbugs.gradle`, `verify-spotbugs.mjs`, `spotbugs-baseline.json` | `pmd` + `com.github.spotbugs` plugins, pmd/spotbugs config blocks, `apply from: 'spotbugs.gradle'`                                                                                      |
| ArchUnit tests emitted (gradle)                  | `gradle/arch-test-deps.gradle` (spring-only deps EJS-gated on a spring framework)                                           | `apply from: 'gradle/arch-test-deps.gradle'`                                                                                                                                            |
| Java BDD example suite emitted (gradle)          | —                                                                                                                           | AssertJ / JUnit 5 / Cucumber / junit-platform-suite (+ launcher `testRuntimeOnly`) as fill-gaps `dependencies { … }` lines                                                              |
| Mutation config emitted (L3+ / release-enforced) | `gradle/pitest.gradle`                                                                                                      | `info.solidsoft.pitest` plugin, `apply from: 'gradle/pitest.gradle'`                                                                                                                    |

Maven wiring (pom.xml injection) is out of scope — the maven gate invokes plugin goals by full
coordinates. Multi-module Gradle roots: injection targets the root build script (single-module
assumption).

## Brownfield adoption

- **Spotless ratchet**: when the target repo has an `origin/main` (or `origin/master`) ref at
  scaffold time, `spotless.gradle` is rendered with `ratchetFrom '<ref>'` — formatting is
  enforced **only on files changed since that ref**, so a legacy repo passes `spotlessCheck`
  without a repo-wide reformat; touching a legacy file requires formatting it. Greenfield (no
  remote ref) gets full enforcement. Remove the line (after a one-off `spotlessApply`) to
  enforce repo-wide.
- **Muted-tests baseline**: pre-existing `@Disabled`/skip markers are grandfathered via
  `node scripts/check-muted-test.mjs --update-baseline` — see
  [anti-fake-green](anti-fake-green.md#muted-tests-baseline).
- **Checkstyle has no ratchet concept**: legacy unformatted code stays RED on `checkstyleMain`
  until a one-off `./gradlew spotlessApply` (fixes the whitespace violation class) or a tuned
  `config/checkstyle.xml`.
