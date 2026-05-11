# Architectural Decision Records

This file documents architectural decisions made in the Arbiter project.
Individual ADR files also live in `docs/ADR/` for historical records.

---

## feat(#398): ArchUnit hexagonal suite parity — 3 new templates (2026-05-10)

Adds `NamingConventionsTest.java.ejs`, `AntiCyclicTest.java.ejs`, and
`NoH2ArchTest.java.ejs` to `src/templates/archunit/`, completing viafera
parity for the hexagonal enforcement suite. `emitHexagonalSuite()` in
`src/generators/archunit.ts` now emits 7 test files (up from 4).

- **NamingConventionsTest**: enforces `*Service`, `*Repository`, `*Controller`,
  `*Port` suffixes for the four hexagonal stereotypes.
- **AntiCyclicTest**: uses `SlicesRuleDefinition.slices().matching(basePackage + ".(*)..").should().beFreeOfCycles()`.
- **NoH2ArchTest**: bans `org.h2..` imports in production code; H2 is
  test-only.

The java fixture manifest gains `architectureStyle: "hexagonal"` and
`basePackage: "com.example"` so integration tests exercise the full suite.
CANON-07 (shell-script execution in tests) does not apply — templates emit
Java test files, not shell scripts. Render-correctness assertions suffice.

---

## chore: typescript-eslint 8.58.2 → 8.59.2 (2026-05-10)

Stricter rules in 8.59.2 flagged three patterns across the codebase:

- `src/cli.ts`: removed redundant `as GovernanceLevel` cast (already typed by Commander)
- `src/config/schema.ts`: removed `as unknown as ArbiterConfigV2` cast from `migrateV1ToV2` return (object literal now satisfies the type directly)
- `src/decomposition/github-backend.ts`: `Promise.reject(err as Error)` → guard that wraps non-Error values

---

## Fix #298: drop redundant ProjectConfig intersection cast in archunit (2026-05-01)

`emitHexagonalSuite` in `src/generators/archunit.ts` no longer takes
`ProjectConfig & { basePackage: string }`; `basePackage` is passed as a
separate `string` parameter from the if-guarded call site. The previous
cast at the call site would have silently lied if the guard at
`generateArchUnit:139` (`config.architectureStyle === "hexagonal" && config.basePackage`)
were ever relaxed, leading to `basePackage.replace(...)` throwing on
`undefined` inside the function body. The new signature makes the
non-empty contract local to the call site and removes the intersection
cast entirely.

---

## Fix #300: route check-no-pii.mjs emit through renderTemplate (2026-05-01)

`src/generators/security.ts` now emits the PII hook via
`renderTemplate("claude/hooks/check-no-pii.mjs", data)` instead of a
direct `readFileSync(import.meta.dirname/...)`. `renderTemplate` resolves
its templates via `fileURLToPath(import.meta.url)`, which is portable
across all Node versions; `import.meta.dirname` is Node 20.11+ only and
is undefined under some bundler configurations. The change also aligns
the security generator with the pattern already used in
`src/generators/claude.ts` for sibling static `.mjs` hooks
(`stop-dangerous`, `enforce-read-only`, `pre-edit-ssot-guard`,
`check-no-orphan-todo`). The template contains no `<%`/`%>` delimiters
so EJS pass-through is byte-identical.

---

## Fix #297: guard parse + shape of existing .claude/settings.json (2026-05-01)

`generateClaude` in `src/generators/claude.ts` now routes the read of
the existing `.claude/settings.json` through a new
`parseExistingSettings` helper. The helper wraps `JSON.parse` in a
`try`/`catch` (preserving the original error via `{ cause }`) and then
shape-validates the parsed value with an `isPlainObject` predicate
(`typeof === "object" && !== null && !Array.isArray`). On malformed
JSON or a non-object root (`null`, array, primitive), the helper
throws an `Error` prefixed with
`"Failed to parse existing .claude/settings.json: <msg>. Fix or delete and re-run."`.
Previously a malformed file killed `arbiter init` with a bare
`SyntaxError`, and a non-object root silently corrupted the file:
`mergeSettingsJson` does `{ ...existing }`, which turns arrays/strings
into `{ "0": ..., "1": ... }` objects and writes the result back to
disk without erroring.

---

## ADR-030: Consolidate /start-task + /complete-task → /task

**Date:** 2026-04-17
**Status:** Accepted
**Reference:** viafera PR #2698 (ADR-094)

**Context:** The two-file split between start-task and complete-task created drift over time as the commands diverged. The PLAN→EXEC boundary is enforced by the MANDATORY STOP line, not by file separation.

**Decision:** Merge both commands into a single `/task` command that covers the full lifecycle: branch enforcement → plan → STOP → implement (TDD) → gate → commit → PR → merge.

**Consequences:** Simpler maintenance (one file to update), single entry point for all task lifecycle operations, reduced documentation surface. Breaking change: `/start-task` and `/complete-task` no longer exist in generated projects — consumers must update to `/task`.

---

## ADR-031: `CliError.notFound` + stricter Kotlin detection

**Date:** 2026-04-24
**Status:** Accepted
**Reference:** PR #339 (closes #330, #331, #332)

**Context:** Two defects in the compatibility probe layer collapsed distinct failure modes into one status. `CliError` exposed only `timedOut`/`exitCode`, so ENOENT was only detectable via a message regex or `exitCode === -1` convention. `probeTool` collapsed every `CliError` into `skipped: toolchain-missing`, making a 10-second timeout look identical to an uninstalled tool. Separately, the `runProbes` dispatch lacked a `kotlin` branch, so Kotlin projects received `entries=[]` despite `matrix.json` defining a kotlin row.

**Decision:**

1. `CliError` gains a discriminated `notFound: boolean` field set only on `ENOENT`. `probeTool` / `runBuildProbe` / `fetchGithubData` branch on `notFound → timedOut → default non-zero` to produce precise reasons (`probe timeout (Nms)`, `exit N: <stderr>`, `build tool missing: <cmd>`, `build-file-not-found: <path>`).
2. `detectLanguage` returns `"kotlin"` only when `src/main/kotlin` exists **and** contains at least one `.kt` source (bounded recursive walk, budget 200). IDE-created empty directories do not reclassify Java projects.
3. `matrix.json`'s kotlin row includes `gradle` so mixed Java+Kotlin Gradle projects keep their gradle version probe.
4. `validateMatrix` (exported from `probe.ts`) replaces the load-time `matrixJson as RawMatrix` cast; malformed JSON throws with the offending key path. `LanguageMatrix` / `MatrixEntry` in `schema.ts` are the single type source.

**Consequences:** CLI callers that previously pattern-matched on `/not found/` regex can now branch on `err.notFound`. The `kotlin` language becomes addressable in the Language union; the `src/main/kotlin` heuristic is conservative and will miss exotic project layouts (pure Kotlin with sources outside `src/main/kotlin`), which is acceptable given the alternative is misclassifying Java projects. `validateMatrix` throws at module load on malformed `matrix.json`; `init.ts` already wraps `runProbes` with user-facing error handling, so the failure mode is loud rather than silent.

---

## ADR-032: Codex CLI hook parity via adapter shim

**Date:** 2026-05-10
**Status:** Accepted
**Reference:** PR #416

**Context:** Arbiter-governed projects gain hook-based invariant enforcement through `.claude/hooks/*.mjs` scripts (orphan TODO check, SSOT guard, PII scan, dangerous-command block, etc.). Developers who use Codex CLI instead of Claude Code lose this enforcement entirely: Codex does not read `.claude/settings.json` and fires hooks from `.codex/config.toml`. The issue originally proposed adding `process.env.CODEX_TOOL_INPUT_PATH` fallbacks inside every hook. This was rejected: Codex never sets env vars — it pipes a JSON payload on stdin. The env var fallbacks would be dead code.

**Decision:** Generate a thin adapter shim (`.codex/codex-adapter.mjs`) alongside `.codex/config.toml` at `arbiter init` time. The adapter:

1. Reads the Codex stdin JSON payload
2. For `bash` tool: sets `CLAUDE_TOOL_INPUT_COMMAND` from `tool_input.command`
3. For `apply_patch` tool: parses `*** Update File: <path>` lines from the unified diff in `tool_input.command`, sets `CLAUDE_TOOL_INPUT_PATH`, runs the hook once per file
4. Delegates to the target `.claude/hooks/*.mjs` via `execFileSync`, propagating the exit code
5. Exits 0 on unknown tools (safe no-op for future Codex tools)

The existing hook scripts remain the SSOT — zero changes to their source. The adapter is generated as a static copy (not EJS-rendered); `config.toml` is EJS-rendered with the same governance-level guards as `settings.json`.

The `.arbiter/hooks-manifest.json` gains a `tools` field per entry (`["claude"]` default, `["claude","codex"]` for statically-spawnable HARD hooks). `check-hardness-inventory.mjs` verifies that every `tools:["codex"]` manifest entry has a corresponding adapter reference in `config.toml.ejs`.

**Consequences:** Developers on Codex CLI receive the same enforcement as Claude Code users for the five statically-spawnable HARD hooks. EJS-rendered hooks (plan-anchor, completion-guard, done-evidence, etc.) are Claude Code-only and remain so — they depend on session-level state that Codex does not expose. The `apply_patch` hook coverage depends on Codex emitting `apply_patch` PreToolUse/PostToolUse events reliably; as of May 2026 this is tracked upstream (openai/codex#16732).

---

## ADR-033: check-no-pii.mjs hook template renamed to .mjs.ejs (CANON-04)

**Date:** 2026-05-11
**Status:** Accepted
**Reference:** Issue #164

**Context:** `src/templates/claude/hooks/check-no-pii.mjs` was a static JavaScript file emitted via `renderTemplate()` without the `.ejs` extension. CANON-04 requires every file consumed by `renderTemplate()` to carry the `.ejs` suffix so tooling (drift checks, template audits) can distinguish rendered templates from static assets.

**Decision:** Rename the file to `check-no-pii.mjs.ejs`. No content changes — the file contains no EJS tags and renders identically. Update the generator reference in `security.ts` and the `.arbiter/hooks-manifest.json` entry accordingly. Add a CANON-04 render test.

**Consequences:** The `.mjs.ejs` suffix makes the file's role explicit. The hardness-inventory `spawnable: true` classification is retained because the file remains pure JavaScript with no EJS syntax, so the empirical exit-code test continues to pass by spawning the file directly. Codex parity check strips the `.ejs` suffix when verifying the codex config template, so no change to `codex/config.toml.ejs` is needed.

---

## ADR-034: INV-41 and INV-42 — Schema Registry testCompatibility and Pact broker env-gate

**Date:** 2026-05-11
**Status:** Accepted
**Reference:** Issues #362 (#344 F3), #364 (#344 F5)

**Context:** Audit finding F3 revealed that `src/templates/contract-testing/message-queue/` performed reachability checks (HTTP GET /subjects) rather than actual schema compatibility verification. Finding F5 found that `check-all.mjs.ejs` packed `'pactPublish pactVerify'` as a single spawnSync argv element (shell:false) causing silent failures, and emitted no `PACT_BROKER_BASE_URL` / `PACT_BROKER_TOKEN` forwarding.

**Decision (INV-41):** All 5 language message-queue templates must call `testCompatibility()` (or language-equivalent REST POST to `/compatibility/subjects/{s}/versions/latest`) and assert BACKWARD or FULL compatibility level. Reachability-only checks do not satisfy the invariant.

**Decision (INV-42):** All Pact broker runCheck invocations in `check-all.mjs.ejs` and CI workflow steps must be wrapped in a `PACT_BROKER_BASE_URL` environment check. When unset, the gate emits a visible SKIP log and does not error. When set, `PACT_BROKER_TOKEN` is forwarded as a system property or env var. No hardcoded broker URL is permitted.

**Consequences:** Message-queue contract tests now provide genuine schema evolution safety. Pact broker steps no longer silently fail against a missing broker. The `.env.pact` scaffold (committed with empty values) and `.gitignore` pattern ensure tokens are never committed to source control.

---

## ADR-035: Inline arbiter-suppress directive parser (F8 from #344, INV-31 extension)

**Date:** 2026-05-11
**Status:** Accepted
**Reference:** Issue #367

**Context:** Audit finding F8 identified that INV-31 (suppression expiry) was only enforced for file-based `suppressions/` entries. Inline comment suppressions (e.g. `// arbiter-suppress(INV-04, ...)`) were silently vacuous — no validator ran, so any expired or malformed directive passed undetected. Additionally, five PostToolUse hooks (`check-no-any`, `check-no-orphan-todo`, `check-no-pii`, `check-no-direct-spawn`, `check-no-placeholders`) blocked violations with no escape hatch, making it impossible to legitimately suppress a finding in source code.

**Decision:** Add `scripts/check-inline-suppressions.mjs` (and matching EJS template `src/templates/scripts/check-inline-suppressions.mjs.ejs`) that scans source files for `// arbiter-suppress(INV-NN, until=YYYY-MM-DD, reason="...", owner=@handle)` directives and validates: non-expired `until=` date, `reason` ≥ 10 chars, `owner` present, INV-NN known in catalog. Wire this check unconditionally in the L1 gate (CANON-09) so it runs regardless of the `enableSuppressions` flag — CANON-01 dual-sided enforcement applies. Extend `check-no-any`, `check-no-orphan-todo`, and `check-no-pii` hooks to consult the inline suppression parser before blocking; hooks remain HARD when no directive or directive invalid/expired. Extract `parseArgs` (quote-aware comma tokenizer) to `scripts/lib/suppressions-shared.mjs` to eliminate divergence between the script and hook implementations.

**Consequences:** INV-31 now covers both file-based and inline-comment suppressions. Hooks honor legitimate inline directives without becoming soft. `check-no-direct-spawn` and `check-no-placeholders` bypass wiring deferred to a follow-up (no catalog INV for direct-spawn; placeholder hook uses incompatible JSON env-var convention). INV-36 hardness-sentinel tests lock in the guarantee that all modified hooks still block on violations without a valid directive.

---

## ADR-037: Batch gap-fill #127–#161 — publicApiSurface, static hooks, L3 fixtures, unused-exports, formatter configs, frontend-spa boundaries, Go mutation omission, classify-changes L2

**Date:** 2026-05-11
**Status:** Accepted
**Reference:** Issues #127, #151, #153, #156, #157, #158, #160, #161

**Context:** Bulk sweep of issues #127–#161. #154 and #155 were already shipped (closed as superseded). The remaining 8 issues covered gaps across five categories: (1) missing publicApiSurface metric in `debt-lib.mjs.ejs`; (2) `check-no-placeholders` and `check-no-unused-exports` hook templates not emitted; (3) L3 governance level absent from 15 real-project fixture manifests; (4) missing `rustfmt.toml` for Rust and `gofmt -l` gate for Go; (5) frontend-spa archetype lacking ESLint import-boundary enforcement; (6) no test asserting Go projects never emit a mutation gate; (7) `classify-changes` CI job gated on L3-only, leaving L2 single-lane projects without change-set awareness.

**Decision (per issue):** #127 — add `<% if (metricsProfile.includePublicApiSurface) %>` block in `debt-lib.mjs.ejs` using `grep -rh ^export` to count exported symbols; scoped to `library` archetype. #151 — add `check-no-placeholders.mjs` as a language-agnostic static hook (always emitted); direct-spawn hook deferred (no catalog INV). #153 — add `"L3"` to `levels` in all 15 fixture manifests that lacked it. #156 — add `check-no-unused-exports.mjs` (knip-based) emitted for TypeScript only, with `.mts`/`.cts` extension guard and graceful ENOENT skip. #157 — emit `rustfmt.toml` (edition + max_width 100) for Rust; add `gofmt -l .` runCheck to Go branch of `check-all.mjs.ejs`. #158 — extend `src/generators/boundaries.ts` to emit `.eslintrc-frontend-spa.cjs` for `frontend-spa` archetype with FSD (Feature-Sliced Design) layer ordering. #160 — add explicit test asserting Go `check-all.mjs` never references `go-mutesting` at any governance level. #161 — change `classify-changes` emission guard from `L3 || multiLane` to `!== L1 || multiLane` so L2 single-lane projects receive the job and its consumers wire correctly.

**Consequences:** debt-lib now tracks public API surface for library archetypes. Both new hook templates ship with all generated projects (placeholders) or TS projects (unused-exports). All 15 fixtures are L3-ready. Rust and Go projects now have formatter config/gate. frontend-spa projects enforce FSD layer import discipline. Go mutation omission is test-locked. L2 single-lane CI pipelines benefit from change-set-aware job skipping.

---

## ADR-036: Forensic fixes F9–F12 (issues #368–#371, from umbrella #344)

**Date:** 2026-05-11
**Status:** Accepted
**Reference:** Issues #368, #369, #370, #371

**Context:** Audit wave #344 surfaced four additional governance gaps: F9 — PMD `UnusedPrivateField`/`UnusedPrivateMethod` were unconditionally excluded (DI-pattern alibi no longer needed with file-based suppressions); F10 — Rust integration testing scaffold used `panic!` on missing `DATABASE_URL` instead of real testcontainers-rs setup, and the cargo invocation used an invalid `--test '*integration*'` glob (cargo doesn't support shell globs in `--test`); F11 — `generateArchUnit` accepted unknown `architectureStyle` values silently and the `ArchitectureTest.java.ejs` else-block emitted only a comment (silent vacuous green in test suite); F12 — PIT mutation testing templates did not set `failWhenNoMutations = true`, so a project with zero mutatable classes passed the mutation gate silently.

**Decision:** F9: Remove both UnusedPrivate excludes from `pmd-ruleset.xml.ejs` — legitimate DI suppressions belong in file-based `suppressions/pmd-suppressions.xml`. F10: Rewrite `db_fixture.rs.ejs` to use `testcontainers::clients::Cli` + `GenericImage` with `WaitFor::message_on_stderr`; add `appendCargoDevDep` helper in `integration-testing.ts` that idempotently appends `testcontainers = "0.23"` to `[dev-dependencies]`; fix cargo integration test invocation to `['test', '--tests']`. F11: Add a `KNOWN_STYLES` guard in `generateArchUnit` that throws on unrecognised style; replace the silent else-block in `ArchitectureTest.java.ejs` with a `@Test` method calling `Assertions.fail(...)`. F12: Add `failWhenNoMutations = true` to both `pitest.gradle.ejs` and `pitest-maven-setup.md.ejs`.

**Consequences:** All four gaps closed. PMD now flags unused private members by default. Rust integration tests use real container isolation. ArchUnit generator fails loud on misconfiguration at both generator level (throw) and runtime (failing test). PIT gate fails when no mutations exist, closing the silent-vacuous-green path.
