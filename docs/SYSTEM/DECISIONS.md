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
