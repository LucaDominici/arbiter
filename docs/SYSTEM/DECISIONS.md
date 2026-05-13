# Architectural Decision Records

This file documents architectural decisions made in the Arbiter project.
Individual ADR files also live in `docs/ADR/` for historical records.

---

## feat(#263): time-travel governance — arbiter blame (2026-05-13)

**Status:** Accepted
**Reference:** Issue #263; CANON-16

**Context:** The Provenance Graph (Wave-1, #259) captures static relationships between governance artefacts. Issue #263 extends it with a temporal dimension: given a node id (INV-NN, ADR-NNN, FILE:path), reconstruct its governance history from git commits and Notary footer records, and render a blame timeline.

**Decisions:**

- **`src/graph/history.ts` — temporal harvester**: Runs `git log --format=...` (via existing `runCli` utility, INV-12 compliant) and maps raw commit entries to `HistoryEvent` objects. For INV/ADR/CANON nodes, filters by node id appearing in commit subject or Notary `Intent:` field. For `FILE:` nodes, scopes the log to the file's pathspec for performance. Returns events sorted oldest-first; deterministic for the same repo state.
- **`src/graph/blame.ts` — timeline builder + formatters**: Pure functions over `HistoryEvent[]`. `buildTimeline()` classifies each event (CREATED/ENFORCED/MODIFIED/MENTIONED/UNKNOWN) using keyword matching on commit text. Four renderers: `text` (human-readable), `json` (machine-readable), `mermaid` (timeline diagram), `markdown-audit` (table report).
- **`src/commands/blame.ts` — CLI entry**: Mirrors the `trace.ts` pattern — load snapshot, resolve node, harvest history, render. `skipGitLog` flag for unit tests avoids git dependency in test environment. `BlameFormat` union type: `text | json | mermaid | markdown-audit`.
- **`src/compliance/loader.ts` — optional compliance.yaml**: Reads `.arbiter/compliance.yaml` if present; maps INV IDs to SOC2/ISO/PCI control IDs. Custom minimal YAML parser — no external dependency. Returns `undefined` when file absent (graceful degradation).
- **`GraphNode` temporal fields**: Extended `src/graph/model.ts` with optional `created_at?: string` and `commit_ref?: string` fields. Backwards-compatible: existing snapshots without these fields deserialise without change.
- **NDJSON history store**: `.arbiter/graph.history.ndjson` (append-only) for future incremental harvesting. `appendHistoryEntry` / `readHistoryEntries` functions in `history.ts`. File is optional — blame falls back to real-time git log when absent.
- **Performance**: Blame on single INV node < 2s enforced by integration test (5s CI budget). FILE: nodes use pathspec-scoped git log; INV/ADR nodes use full log filtered in memory. No git operations against remote.
- **Dogfood**: `__tests__/integration/blame-dogfood.test.ts` runs blame on INV-01 against the arbiter repo itself and asserts non-empty output and < 5s wall time.
- **CLI registration**: `arbiter blame` added to `src/cli.ts` after `arbiter trace`, consistent naming convention (top-level command, not nested).

**Consequences:** `arbiter blame INV-NN` provides a full governance audit trail for any invariant. Optional `compliance.yaml` maps invariants to SOC2/ISO/PCI controls, enabling compliance reporting. The temporal extension is additive — no existing graph functionality is modified.

---

## feat(#470): soloDevMode — trade-offs and invariant design (2026-05-13)

**Status:** Accepted
**Reference:** Issue #470; INV-58, INV-59

**Context:** Solo-dev workflow: single developer wants to merge directly after local L2 passes, without waiting for PR CI and review ceremony. Premise: "local gate ≡ CI gate, so CI on PR is redundant." Phase A–F of #470 reinforces parity first (INV-58 Node SSOT, INV-59 gate result hash), then introduces the option.

**Decisions:**

- **PR ceremony retained:** INV-23 (direct push to main banned) remains enforced. `soloDevMode` relaxes branch protection (no required reviews, no required CI status checks) but PR still exists. Merge is via `gh pr merge --admin --squash`.

- **No-op CI on PR:** When `soloDevMode=true`, the generated `ci.yml` emits a solo-dev-gate job that exits immediately (echo only). Full CI still runs on push to `main`. Branch protection is permissive so the no-op job is sufficient to merge.

- **Nightly drift shadow:** A separate `drift-shadow.yml` workflow runs nightly to catch parity regression (INV-59 hash comparison). On mismatch it opens a GitHub issue tagged `inv-59-drift`. This substitutes for the per-PR CI second opinion.

- **Parity prerequisite:** `soloDevMode` is meaningful only when INV-59 parity holds. The feature flag is documented to require parity evidence; drift detected by the nightly shadow should block enabling solo mode.

- **Team conversion risk:** Branch protection is permissive. If collaborators join the repo, `arbiter doctor` (future) should warn when `soloDevMode=true` and >1 collaborator detected.

**Consequences:** Solo developer can merge PRs after local L2 green without PR CI delay. Nightly drift shadow catches environmental divergence within 24 hours. Parity invariant (INV-59) must hold for the premise to be valid.

---

## feat(#470): Gate result parity — INV-59, parityContentHash, CI aggregation (2026-05-13)

**Status:** Accepted
**Reference:** Issue #470; INV-59

**Context:** soloDevMode (Phases C-F of #470) requires proof that local L1 gate results are idempotent to CI gate results. Without a structured artifact and a hash comparison, "local ≡ CI" is an untested claim. Phase B addresses this: emit JSON on every gate run, compare hashes in L2.

**Decisions:**

- **Gate result JSON (schema `arbiter-gate-v1`)**: `check-all.mjs` now always writes `.arbiter/gate/local-result.json` (gitignored under `.arbiter/`). `--json <path>` overrides the destination (used by CI gate-aggregation to write `gate-result.json`).

- **Parity subset (27 static L1 gates)**: `parityContentHash` = sha256 over sorted `[{name, pass}]` for deterministic L1 gates only. Excluded: `commitlint` (PR-only in CI), `docs` (PR-only in CI), `unit tests` (split 4-way in CI vs single `npm test` locally). All other 27 L1 gates are structurally identical in both environments.

- **CI gate-aggregation job**: Runs `node scripts/check-all.mjs L1 --json gate-result.json` after `lint-and-test` passes, uploads `gate-result` artifact (30-day retention). Added to `ci-required` needs.

- **INV-59 enforcement (`check-local-ci-parity.mjs`, L2)**: Downloads latest CI artifact via `gh run download`, compares `parityContentHash`. Neutral skip (exit 0) when `gh` unavailable, no CI artifact, or no local result — ensuring the gate doesn't block projects without CI configured. Hard fail (exit 1) on hash mismatch.

- **`check-ci-alignment.mjs` exemptions**: Added `scripts/check-local-ci-parity.mjs` (local-only L2 gate) and `scripts/check-all.mjs` (CI aggregation runner, not a quality gate) to `DESIGN_EXEMPTIONS`.

**Consequences:** Every `check-all.mjs` run (L1 or L2) now produces a machine-readable artifact. L2 includes a parity check. When parity drifts, the hash mismatch surfaces the specific differing gates. soloDevMode can now gate on `parityContentHash` equality as a prerequisite check.

---

## feat(#470): Node version SSOT — INV-58, .nvmrc canonical source (2026-05-13)

**Status:** Accepted
**Reference:** Issue #470; INV-58

**Context:** Node 20 was hardcoded in 10 workflow files and 14 EJS templates. Local dev ran on Node 22. This made local↔CI parity impossible by construction — a prerequisite for the soloDevMode invariant (INV-59, coming in Phase B of #470).

**Decisions:**

- **INV-58 — Node version SSOT**: `.nvmrc` at repo root is the single source of truth. All CI workflows use `node-version-file: '.nvmrc'`. EJS templates emit the same pattern to target projects. `process.version` major must match `.nvmrc` major. Enforced by `scripts/check-node-version-ssot.mjs` (L1 gate).

- **Version**: `22.21.1` (local dev version). `package.json#engines.node` bumped to `>=22.0.0`.

- **Pre-push guard**: `.githooks/pre-push` and `src/templates/githooks/pre-push.ejs` now assert Node major matches `.nvmrc` before running the L2 gate. Fails fast with `nvm use` hint.

- **GIT_COMMON_DIR fix**: `.githooks/pre-commit` and `src/templates/githooks/pre-commit.ejs` now unset `GIT_COMMON_DIR` alongside other git env vars. This was causing integration test timeouts in worktrees where `GIT_COMMON_DIR` leaked into spawned git processes.

- **Template**: `src/templates/.nvmrc.ejs` emits a single-line `.nvmrc` to target projects via the github generator.

**Consequences:** Local and CI now use the same Node major. The Node version drift defect (one of 6 blocking parity) is resolved. `check-node-version-ssot.mjs` fails the L1 gate if any literal `node-version: 'N'` pin is found anywhere in workflows or templates.

---

## feat(#258): HA1 self-validation harness + exit-code universal contract (2026-05-12)

**Status:** Accepted
**Reference:** Issue #258; INV-53

**Context:** Arbiter gates claimed behavioral semantics (pass/fail) but never proved them. A gate that silently misbehaves (exits 0 on a violation, or crashes without an exit code) is indistinguishable from a healthy gate to orchestrators. Additionally, no standard governed which exit codes gates should use — some gates used only 0/1, others could theoretically exit any value.

**Decisions:**

- **INV-53 — Exit-code universal contract**: Every Arbiter-emitted script must exit `0=PASS / 1=FAIL / 2=ERROR`. Enforced by `check-exit-code-contract.mjs` (L1 gate) which scans `scripts/*.mjs` and `src/templates/scripts/*.ejs` for `process.exit(N)` where N ∉ {0,1,2}.

- **A/B/C drill harness**: `scripts/self-validation.mjs` (generated by `src/generators/self-validation.ts`) runs three phases per gate — A (clean fixture → expect 0), B (drift fixture → expect 1), C (bad args → expect expected error code). Registered as L2 gate. Template at `src/templates/scripts/self-validation.mjs.ejs`; materialized copy kept at `scripts/self-validation.mjs` (INV-45 dogfood pattern — template and materialized must be identical).

- **Advisory pipe/tee hazard**: `check-pipe-tee-hazard.mjs` detects `| tee` without `set -o pipefail` or `PIPESTATUS[0]` guard. Advisory only (always exits 0). Registered as L1 but self-advisory; promotion to blocking deferred pending noise-floor measurement.

- **Name disambiguation**: Issue #258 specified `harness.ts` but "harness" was already overloaded by `evidence-harness` (`enableEvidenceHarness`, `evidence-retention` generator). Renamed to `self-validation` throughout: `src/generators/self-validation.ts`, `scripts/self-validation.mjs`, `enableSelfValidationHarness`.

- **INV slot**: Issue specified INV-42 but that slot is taken by Pact-broker env-gating (INV-42, catalog line 658). Used INV-53 (next free slot after INV-52).

- **Staged rollout**: Initial drill covers 2 gates (exit-code-contract, pipe-tee-hazard). Full 18-gate fixture expansion tracked as a follow-up issue to avoid 50+ fixture proliferation in this PR.

**Consequences:** L1 gate now enforces exit-code discipline across all emitted scripts. L2 gate proves each registered gate's behavioral contract. New gates added to Arbiter must declare their A/B/C expected codes in the drill manifest.

---

## feat(#241,#242,#243): evidence schema hardening, INV-31 suppression wiring, BACKLOG generator (2026-05-12)

**#241 — EvidenceSummary schema enforcement:**
`head_sha`, `head_sha_short`, `obs_gate`, `tests`, `coverage`, `mutation`, `security`
promoted to REQUIRED fields in `src/evidence/summary.ts`. `validateSummarySchema`
now wired into `runVerifyEvidence` (after SHA check) so the L2 gate actually rejects
malformed SUMMARY.json. `evidence-collect.mjs.ejs` emits both SHA fields inline.

**#242 — INV-31 suppression expiry wiring (CANON-09):**
`check-suppressions.mjs` added unconditionally to `scripts/check-all.mjs` and CI
(was missing; AGENTS.md claimed enforcement but script was never called). Registry
`suppressions` entry changed to `enabled: true`; generator internally guards
file-based suppression files on `enableSuppressions`, but always emits
`check-inline-suppressions.mjs`.

**#243 — BACKLOG.md generator:**
New `evidence-backlog` generator emits `.evidence/BACKLOG.md.template` at L2+
(`skipIfExists: true`). Registered in registry with `GeneratorKey "evidence-backlog"`.
`task.md.ejs` Phase 1 step 5 instructs Standard-tier tasks to copy template into
task-scoped evidence directory.

---

## feat(#240): check-ci-alignment.mjs — L1 CI/manifest gate parity check (2026-05-11)

Adds `scripts/check-ci-alignment.mjs` as an L1 gate that parses
`scripts/check-all.mjs` (manifest) and `.github/workflows/ci.yml` (CI),
derives normalized gate keys, and fails if any gate is present in one but
not the other.

Key design decisions:

- **DESIGN_EXEMPTIONS**: `scripts/check-docs.mjs` (CI runs inline shell),
  `npx:commitlint` (conditional PR-only), `npm:test` (CI splits into jobs),
  `npm:audit` (CI before L2), `npx:knip` (CI in lint-and-test).
- **Block scalar parsing**: `run: |` detected before single-line `run:`.
- **Target only `ci.yml`**: Avoids false positives from matrix workflows.
- **CI alignment fix**: Added 5 missing L1 steps; replaced npm scripts with
  direct binary calls for key matching.
- **Generator**: `src/generators/check-all.ts` emits `check-ci-alignment.mjs`
  via new EJS template (CANON-05, CANON-11 satisfied).

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

## ADR-038: Add commitlint.config.js.ejs template and wire into root generator (#202)

**Date:** 2026-05-11
**Status:** Accepted
**Reference:** Issue #202

**Context:** `src/generators/githooks.ts` emits `commit-msg` and `pre-push` hooks to target projects that reference commitlint, but no `commitlint.config.js.ejs` template existed. Generated target projects were referencing commitlint without shipping the configuration file that defines the ruleset.

**Decision:** Add `src/templates/root/commitlint.config.js.ejs` with a static `@commitlint/config-conventional` config (no EJS variables — pure static content). Wire emission via `src/generators/root.ts` for all projects (no language or governance gate) using `skipIfExists: true` for brownfield safety. Add CANON-04-required render test at `__tests__/templates/commitlint-render.test.ts` and CANON-05-required generator tests in `__tests__/generators/root.test.ts`.

**Consequences:** All generated target projects now receive a `commitlint.config.js` that correctly configures the commit-msg hook already emitted by githooks.ts. Brownfield projects with a custom config are unaffected (skipIfExists). Gate passes with no regressions.

---

## ADR-037: Batch gap-fill #127–#161 — publicApiSurface, static hooks, L3 fixtures, unused-exports, formatter configs, frontend-spa boundaries, Go mutation omission, classify-changes L2

**Date:** 2026-05-11
**Status:** Accepted
**Reference:** Issues #127, #151, #153, #156, #157, #158, #160, #161

**Context:** Bulk sweep of issues #127–#161. #154 and #155 were already shipped (closed as superseded). The remaining 8 issues covered gaps across five categories: (1) missing publicApiSurface metric in `debt-lib.mjs.ejs`; (2) `check-no-placeholders` and `check-no-unused-exports` hook templates not emitted; (3) L3 governance level absent from 15 real-project fixture manifests; (4) missing `rustfmt.toml` for Rust and `gofmt -l` gate for Go; (5) frontend-spa archetype lacking ESLint import-boundary enforcement; (6) no test asserting Go projects never emit a mutation gate; (7) `classify-changes` CI job gated on L3-only, leaving L2 single-lane projects without change-set awareness.

**Decision (per issue):** #127 — add `<% if (metricsProfile.includePublicApiSurface) %>` block in `debt-lib.mjs.ejs` using `grep -rh ^export` to count exported symbols; scoped to `library` archetype. #151 — add `check-no-placeholders.mjs` as a language-agnostic static hook (always emitted); direct-spawn hook deferred (no catalog INV). #153 — add `"L3"` to `levels` in all 15 fixture manifests that lacked it. #156 — add `check-no-unused-exports.mjs` (knip-based) emitted for TypeScript only, with `.mts`/`.cts` extension guard and graceful ENOENT skip. #157 — emit `rustfmt.toml` (edition + max_width 100) for Rust; add `gofmt -l .` runCheck to Go branch of `check-all.mjs.ejs`. #158 — extend `src/generators/boundaries.ts` to emit `.eslintrc-frontend-spa.cjs` for `frontend-spa` archetype with FSD (Feature-Sliced Design) layer ordering. #160 — add explicit test asserting Go `check-all.mjs` never references `go-mutesting` at any governance level. #161 — change `classify-changes` emission guard from `L3 || multiLane` to `!== L1 || multiLane` so L2 single-lane projects receive the job and its consumers wire correctly.

**Consequences:** debt-lib now tracks public API surface for library archetypes. Both new hook templates ship with all generated projects (placeholders) or TS projects (unused-exports). All 15 fixtures are L3-ready. Rust and Go projects now have formatter config/gate. frontend-spa projects enforce FSD layer import discipline. Go mutation omission is test-locked. L2 single-lane CI pipelines benefit from change-set-aware job skipping.

---

## ADR-039: Parallel test category jobs in CI (#219)

**Date:** 2026-05-11
**Status:** Accepted
**Reference:** Issue #219

**Context:** The generated `ci.yml` ran all tests in a single sequential `lint-and-test` job. Contract test failures (fast, ~2min) waited behind unit tests (~8min) for feedback. Splitting into parallel jobs reduces mean-time-to-feedback.

**Decision:** Split the TS and Java `lint-and-test` job into: `lint-and-test` (lint/typecheck only), `unit-tests`, `contract-tests` (parallel with unit), `integration-tests` (needs unit), `behavioral-tests` (needs unit). The `ci-required` aggregator waits for all. `check-all.mjs.ejs` L1 uses `npm run test:unit`; L2 runs all categories. `injectTestScripts()` in `debt-gates.ts` adds `test:unit/contract/integration/behavioral` scripts to target package.json.

**Consequences:** Target projects gain parallelized feedback. The `test:unit` script isolates fast-only tests from slower integration/behavioral suites.

---

## ADR-037: SpotBugs security hard-block baseline script (#212)

**Date:** 2026-05-11
**Status:** Accepted
**Reference:** Issue #212, INV-44

**Context:** Java projects generated by arbiter previously had no mechanism to prevent SpotBugs security-category findings (SQL_INJECTION, XSS, COMMAND_INJECTION, XXE, LDAP_INJECTION, HARD_CODE_PASSWORD) from being silently baselined. The `spotbugs.gradle` was emitted but no script enforced the invariant that security bugs must never be suppressed.

**Decision:** Add `scripts/verify-spotbugs.mjs.ejs` template — a Node.js script emitted to Java target projects. It enforces a `SECURITY_HARD_BLOCK` set that causes `process.exit(1)` even when `--update-baseline` is passed. Non-security findings may be baselined in `spotbugs-baseline.json`. Wire the script into `check-all.mjs.ejs` L2 Java path. Codify as INV-44 (security tier, Java-only) in the invariant catalog and AGENTS.md.

**Consequences:** Java projects cannot silence security-class SpotBugs findings via baseline. The `--update-baseline` flag correctly updates non-security baselines while blocking security ones. Gate failures for security findings are immediate and unconditional.

---

## ADR-036: Forensic fixes F9–F12 (issues #368–#371, from umbrella #344)

**Date:** 2026-05-11
**Status:** Accepted
**Reference:** Issues #368, #369, #370, #371

**Context:** Audit wave #344 surfaced four additional governance gaps: F9 — PMD `UnusedPrivateField`/`UnusedPrivateMethod` were unconditionally excluded (DI-pattern alibi no longer needed with file-based suppressions); F10 — Rust integration testing scaffold used `panic!` on missing `DATABASE_URL` instead of real testcontainers-rs setup, and the cargo invocation used an invalid `--test '*integration*'` glob (cargo doesn't support shell globs in `--test`); F11 — `generateArchUnit` accepted unknown `architectureStyle` values silently and the `ArchitectureTest.java.ejs` else-block emitted only a comment (silent vacuous green in test suite); F12 — PIT mutation testing templates did not set `failWhenNoMutations = true`, so a project with zero mutatable classes passed the mutation gate silently.

**Decision:** F9: Remove both UnusedPrivate excludes from `pmd-ruleset.xml.ejs` — legitimate DI suppressions belong in file-based `suppressions/pmd-suppressions.xml`. F10: Rewrite `db_fixture.rs.ejs` to use `testcontainers::clients::Cli` + `GenericImage` with `WaitFor::message_on_stderr`; add `appendCargoDevDep` helper in `integration-testing.ts` that idempotently appends `testcontainers = "0.23"` to `[dev-dependencies]`; fix cargo integration test invocation to `['test', '--tests']`. F11: Add a `KNOWN_STYLES` guard in `generateArchUnit` that throws on unrecognised style; replace the silent else-block in `ArchitectureTest.java.ejs` with a `@Test` method calling `Assertions.fail(...)`. F12: Add `failWhenNoMutations = true` to both `pitest.gradle.ejs` and `pitest-maven-setup.md.ejs`.

**Consequences:** All four gaps closed. PMD now flags unused private members by default. Rust integration tests use real container isolation. ArchUnit generator fails loud on misconfiguration at both generator level (throw) and runtime (failing test). PIT gate fails when no mutations exist, closing the silent-vacuous-green path.

---

## ADR-038: Self-dogfood check for EJS templates (#239)

**Date:** 2026-05-11
**Status:** Accepted
**Reference:** Issue #239, INV-45

**Context:** arbiter generates `.claude/` configuration files from EJS templates under `src/templates/claude/`. Over time, the materialized `.claude/` files in the arbiter repository diverged from their template sources (extended with arbiter-specific hooks, batch workflow commands, CI runner notes). There was no automated check to detect this drift, risking template degradation where future improvements to the materialized files would not be back-ported to the templates shipped to target projects.

**Decision:** Add `scripts/check-self-dogfood.mjs` — a Node.js script that renders every EJS template under `src/templates/claude/` with arbiter's own config (read from `arbiter.json`), normalizes both rendered and materialized content via Prettier, and diffs them line by line. Files with intentional divergences are registered in `.dogfood-divergences.json` with documented reasons. Config-gated templates (e.g. `guard-done-evidence.mjs` when `evidenceHarness=false`) are skipped. Wire the check into `scripts/check-all.mjs` L2 block. Codify as INV-45 (governance tier, alwaysActive) in the invariant catalog and AGENTS.md.

**Consequences:** Future template modifications will be caught at L2 gate if the corresponding materialized file diverges without a documented reason in `.dogfood-divergences.json`. Intentional arbiter-internal extensions remain explicitly documented. The check prevents silent template drift in both directions.

---

## ADR-040: Hook audit + anti-bloat discipline (CANON-16)

**Date:** 2026-05-12
**Status:** Accepted
**Reference:** Audit 2026-05-12

**Context:** Audit of all 18 active Claude Code hooks revealed three weaknesses: (1) `post-commit-check.mjs` exited 0 (warning-only), making conventional commit enforcement advisory despite commitlint already running in the L1 gate; (2) `check-no-unused-exports.mjs` ran a full-project knip scan (60s) on every TypeScript file edit, including test files and configs — the hook served no purpose outside `src/`; (3) no process rule required AI agents to survey existing code before creating new files, causing gradual bloat via redundant abstractions. The `guard-done-evidence.mjs` absence from settings.json was confirmed as correct: it is config-gated behind `evidenceHarness=true`, which arbiter itself does not declare. The `check-circular-deps.mjs` soft-skip was confirmed non-issue: madge is a declared devDependency.

**Decision:** (1) Upgrade `post-commit-check.mjs` to `process.exit(1)` — commits with non-conventional messages are now hard-blocked at the Claude Code hook level, consistent with the L1 commitlint gate. Template `src/templates/claude/hooks/post-commit-check.mjs.ejs` updated to match; adds guard for `git log` failure (non-git dirs) so the hook exits 0 when no commit is available to check. Empirical fire-tests updated: renamed "warning-only" test, added exit-1 and exit-0 cases with real git repos, added CANON-04 render test to `hooks-advanced-render.test.ts`. (2) Add early-exit to `check-no-unused-exports.mjs` when the edited file is not under `src/`; reduce timeout from 60s to 30s. Per CANON-14: `check-no-unused-exports.mjs.ejs` intentionally has no template — knip is a TypeScript-ecosystem meta tool that arbiter uses to self-govern, not a governance artifact emitted to target projects (which have their own coverage tools). (3) Add `.claude/rules/35-refactor-first.md` implementing CANON-16: every plan for new `src/` files must include an "Existing Code Survey" section. Add CANON-16 to `docs/SYSTEM/CANON.md`.

**Consequences:** Commit messages are enforced at two levels (hook + gate). Unused-export scan overhead reduced by ~80% for non-src edits (0ms vs 60s). Template parity for post-commit-check is now maintained (materialized hook = rendered template). AI agents must document refactoring-vs-creation decisions in plans, creating a paper trail and imposing cognitive friction that favors refactoring.

## ADR-041: Anti-bloat enforcement automation (INV-46)

**Date:** 2026-05-12
**Status:** Accepted
**Reference:** Issue #458; ADR-040

**Context:** ADR-040 introduced CANON-16 (Refactor-First Rule) as a prose rule enforced only at human review time. The rule required an "Existing Code Survey" in every plan that creates `src/` files, but nothing prevented an agent from bypassing it. Three additional enforcement gaps: (1) no automated duplication detector caught near-identical functions across `src/generators/` (40+ files) or `scripts/`; (2) no file-count or LOC ceiling existed — `src/templates/` had grown to 225+ files without a metric ceiling; (3) `src/templates/` could not be scanned by jscpd (EJS syntax), so a tighter per-bucket ratchet was needed to compensate.

**Decision:** Four enforcement layers (INV-46):

- **L1 — Survey gate**: `pre-edit-plan-anchor.mjs` hard-blocks (exit 2) any `Write` to a new `src/` file if the active plan lacks a valid `## Existing Code Survey` block matching that file's exact relative path. Deterministic parse (h2-section split) — not regex theater. Block requires: Target anchor, Decision keyword (one of six), ≥3 grep/ls evidence rows, ≥200 non-whitespace-char Rationale. Bypass: `ARBITER_PLAN_BYPASS=1`. Scope: all new `src/` files, excluding `__tests__/`, `*.test.*`, `*.spec.*` (EJS templates are NOT excluded — they count as `src/` scope).
- **L2 — Duplication**: `jscpd` (threshold 5%, minTokens 50). `src/templates/**` excluded — EJS variants across 20+ language stacks intentionally share scaffolding; scanning erodes signal. `eslint-plugin-sonarjs`: `no-identical-functions: error`, `no-duplicate-string: warn` scoped to `src/**/*.ts`.
- **L1 — Bloat ratchet**: `check-bloat-ratchet.mjs` measures 4 disjoint buckets: (a) `src/` direct children only, (b) `src/generators/`, (c) `src/commands/`, (d) `src/templates/`. Default threshold: +10% or +5 files per bucket. `src/templates/` tighter: +5% or +3 files (compensates for jscpd exclusion). Bypass: `ALLOW_BLOAT=1` env var (not commit footer — L1 runs pre-commit; no commit exists yet). Baseline advanced with `node scripts/update-bloat-baseline.mjs --task=#NNN`.
- **L4 — Doctrine**: `senior-survey` skill emits canonical parseable Survey block; `task.md` + `review-plan.md` updated with Survey template; INV-46 in catalog; this ADR.

**Design choices:**

- _Structured-block parse vs regex_: The skill emits a canonical block with exact anchor text; the hook validates by h2-section split + field extraction. Regex on free-form text is easy to fool by coincidental match; section-split is deterministic and survives whitespace variation.
- _ALLOW_BLOAT env var vs commit footer_: L1 gate runs in `pre-commit` context before a commit exists; commit-footer bypass (`ALLOW_BLOAT=true`) is unreachable at that point. Env var is the correct surface.
- _CANON-01/14 generated-project exemption_: The Survey hook is arbiter's internal harness. Generated projects receive CANON-16 doctrine (`.claude/rules/35-refactor-first.md`) but NOT the hook validator — generated projects have different plan file conventions and the hook would false-positive on their plans. Divergence documented in `.dogfood-divergences.json`.
- _jscpd first-run_: Current codebase duplication is 1.55% (well below 5% threshold) — no grace period required. Baseline runs cleanly on the PR that ships the check.

**Consequences:** New `src/` file creation requires a documented survey — agents can no longer silently add files. Duplication above 5% blocks L2. File/LOC growth above per-bucket thresholds blocks L1. Total bypass surfaces: two session-scoped env vars, both documented in CONTRIBUTING.md. `src/templates/` gets tighter ratchet to compensate for jscpd exclusion.

---

## ADR-039: V1 Verification Bridge (#253)

**Date:** 2026-05-13
**Status:** Accepted
**Reference:** Issue #253; ADR-039

**Context:** Plans submitted to arbiter lacked machine-readable invariant checks. Human review missed Italian UI strings, skipped tests, orphan TODOs, and out-of-scope drive-by files. A CLI-only bridge (per ADR-020) was needed to gate plan merges deterministically.

**Decision:** Add `arbiter verify plan <file>` command implementing 4 rules: VB-INV-EN-UI (Italian stopword check on UI strings), VB-INV-NO-SKIP (skip pattern detection in test files), VB-INV-NO-ORPHAN (TODO without task reference), VB-INV-NO-DRIVEBY (files outside declared scope). Zod validates PlanJsonV1 schema on input. Results written to `.arbiter/plan/REVIEW.json` (pointer) and `.arbiter/plan/runs/<runId>/REVIEW.json` (archive). Exit 0 = APPROVED/SKIPPED; exit 2 = REJECTED/ERROR. Plugin field `verifyPlanRules` allows rule injection; duplicate IDs produce REGISTRY ERROR. `review_bridge.enabled:false` short-circuits to SKIPPED for incremental adoption.

**Consequences:** Plan files violating the 4 invariants are blocked before merge. Archive is append-only per run. Plugin rules extend without forking the binary. No MCP surface added.

---

### ADR-042 — Four-Pillar SSOT Infrastructure (AC#1 Deviation)

**Status:** Accepted
**Reference:** Issue #255; INV-47..INV-50

**Context:** Issue #255 (AC#1) named `src/generators/ssot-four-pillar.ts` as the implementation target for the four-pillar Viafera SSOT model (Authority / Routing / Aliasing / Gates). However, `src/generators/ssot.ts` already emits three of the four pillars via a clean dispatch over `ProjectConfig.governanceLevel`. Adding a fourth pillar (CANONICAL_PATHS) is a one-line extension to the existing `files.push(...)` loop.

**Decision:** Extend `src/generators/ssot.ts` rather than create a new `ssot-four-pillar.ts` file. CANON-16 forbids new files when a refactor of an existing module is viable. The deviation from AC#1's naming is documented here per CANON-01.

**Design choices:**

- _CANONICAL_PATHS uses `skipIfExists`_: Like KNOWLEDGE_MAP, alias entries accumulate manual edits over time. Re-running `arbiter init` must not clobber user-defined redirects.
- _Four gates as L1 checks_: INV-47 (ssot-core), INV-48 (doc-links), INV-49 (knowledge-map), INV-50 (canonical-paths) are all wired into the L1 block of `check-all.mjs`. Bootstrap mode (missing SSOT files) exits 0, so fresh projects are not blocked before the SSOT files are populated.
- _CANON-01 dual-sided_: Each gate ships as both an arbiter-self script (`scripts/check-X.mjs`) and an emitted template (`src/templates/scripts/check-X.mjs.ejs`) for target projects.
- _`arbiter harness --fast`_: CLI command wrapping the four gates for target project use. `--fast` stops at first failure; without the flag all four run and all failures are reported.

**Consequences:** The Viafera four-pillar model (Authority / Routing / Aliasing / Gates) is fully realised in both arbiter-self and generated target projects. Moved/renamed docs no longer silently break links (CANONICAL_PATHS + check-canonical-paths). Missing SSOT entries are detected at L1 (check-ssot-core). KM line count drift is detected at L1 (check-knowledge-map). All four gates bootstrap safely on new projects.

---

## feat(#247): gate script consolidation — inline workflow-runners and ci-alignment into check-all.mjs.ejs (2026-05-13)

**Status:** Accepted
**Reference:** Issue #247; CANON-04, CANON-05

**Context:** The generator `generateCheckAll` emitted three separate files: `check-all.mjs`, `check-workflow-runners.mjs`, and `check-ci-alignment.mjs`. This violated the principle that the gate manifest should be self-contained: target projects received three loose script files, two of which were only ever invoked via `runCheck(...)` from the third.

**Decisions:**

- **Templates deleted**: `src/templates/scripts/check-workflow-runners.mjs.ejs` and `src/templates/scripts/check-ci-alignment.mjs.ejs` removed. Generator now emits ≤1 gate script per project.
- **Logic inlined**: Workflow-runners check uses `_wr`-prefixed variables; ci-alignment check uses `_ca`-prefixed variables. Both are IIFE-style blocks that push `{name, status, elapsed}` to `results[]` and increment `failed` on violation, consistent with the existing Go/BDD inline patterns.
- **No `gitleaks` case in `_caNormalizeKey`**: The standalone `check-ci-alignment.mjs.ejs` had `case 'gitleaks': return 'gitleaks'`. This was dropped from the inline helper because the ci-alignment checker never needs to track gitleaks as a manifest gate — both sides return `null`, so no spurious mismatch is produced. The gitleaks step is guarded by `enableSecurityScanning` at the EJS level; the ci-alignment inline logic must be gitleaks-free to not pollute renders where `enableSecurityScanning=false`.
- **`readdirSync` added** to the `node:fs` import in `check-all.mjs.ejs` to support the inline workflow-runners directory scan.
- **Baseline updated**: Template-tests baseline updated from 128 → 127 (two templates removed, no new template added).

**Consequences:** Each generated project receives a single `scripts/check-all.mjs` that self-contains all L1 gate logic. The two formerly-separate scripts are no longer emitted, reducing surface area and eliminating the risk of accidental deletion of a "helper" script that breaks the gate.

---

## feat(#248): hook dispatcher pattern — single entry point per event (#248) (2026-05-13)

**Status:** Accepted
**Reference:** Issue #248; CANON-04, CANON-05, CANON-14

**Context:** Generated `.claude/hooks/` directories contained up to 17 separate hook files, each registered individually in `settings.json`. This created maintenance overhead (17 command entries per settings.json, per-hook conditional registrations in the EJS template) and made brownfield upgrades fragile — new hooks required both a new file AND a new settings.json entry.

**Decisions:**

- **`hooks.mjs.ejs` dispatcher template added**: A single entrypoint template emits `hooks.mjs` for every generated project. The file contains a `HANDLERS` config table mapping `"EventType:Matcher"` keys to ordered arrays of handler filenames. Handlers run sequentially via `spawnSync`; first non-zero exit aborts the chain. stdin is buffered once and forwarded to every handler that may need it.
- **`settings.json.ejs` consolidated**: Instead of registering 4–10 individual hook commands per event, each event+matcher now registers one command: `node .claude/hooks/hooks.mjs <EventType:Matcher>`. This reduces the settings.json hook surface from 10–14 entries to 6 (one per event/matcher combination).
- **EJS conditionals preserved in dispatcher**: `hooks.mjs.ejs` uses the same `language`, `governanceLevel`, `enableSecurityScanning`, `enableEvidenceHarness`, and `languageHooks` variables to conditionally include handler names — language/governance gating moves from settings.json into the dispatcher config table.
- **Brownfield upgrade**: `mergeSettingsJson` updated to recognise the dispatcher pattern — when incoming entry has `hooks.mjs`, all previously arbiter-managed hook basenames are removed from the existing entry before the dispatcher is added. Non-arbiter custom hooks are preserved.
- **`ARBITER_HOOK_BASENAMES` constant** added to `src/utils/fs.ts` — exhaustive list of all hook basenames arbiter may emit; used by the merge logic to distinguish arbiter-managed from user-custom entries.
- **INV-48 baseline unchanged** (127): the new `hooks.mjs.ejs` template is covered by `__tests__/templates/hooks-dispatcher-render.test.ts`.
- **Manifest updated**: `hooks.mjs.ejs` added to `.arbiter/hooks-manifest.json` with classification `ADVISORY` (the dispatcher itself is advisory; individual handlers carry their own HARD/ADVISORY classification).

**Consequences:** Generated projects have a single dispatcher registered per event in settings.json. Adding or removing a handler requires editing `hooks.mjs` only (not settings.json). Brownfield projects that already have arbiter-managed hook entries are upgraded cleanly on the next `arbiter init` run. The 17-file hook surface is preserved on disk (individual handlers still emitted) but the registration surface collapses to 6 entries.

---

## feat(#254): context-pack generator + two-phase checker (P7 primitive) (2026-05-13)

**Status:** Accepted
**Reference:** Issue #254; CANON-04, CANON-05, CANON-11

**Context:** Issue #253 (V1 verification bridge) established a `verify plan` CLI but had no structured way to produce the two-input bundle (CONTEXT_PACK.md + plan.json) that the two-phase checker consumes. Without a deterministic generator, the "plan review" workflow required manual file assembly — fragile and not repeatable.

**Decisions:**

- **`src/context-pack/` module created**: Three files — `generator.ts` (core deterministic generator), `track-mapping.ts` (A/B/C/D track → INV-set mapping), `review-context.ts` (Zod schema + `combinedVerdict()` function for two-phase checker output aggregation).
- **Track-to-INV mapping is SSOT**: `track-mapping.ts` maps each governance track (A/B/C/D) to the INV IDs that must be checked; generator and checker both import from this single source rather than duplicating the list.
- **Deterministic output guaranteed**: Generator sorts all file/INV lists alphabetically and uses no `Date.now()` or random values. Fixture tests verify that tracks A and B produce different but stable output.
- **`fromPlanJson()` adapter**: Bridges `PlanJsonV1` (emitted by `verify plan`) → `ContextPackInput`; allows the end-to-end flow (`verify plan` → `generate context-pack`) without a separate CLI flag.
- **`writeContextPackFile()` wrapper**: Writes `CONTEXT_PACK.md` to a project root; used by the generator CLI step and tested via brownfield fixture.
- **Agent templates added**: `context-checker.md.ejs` and `bridge-reviewer.md.ejs` emitted under `.claude/agents/` for generated projects; wired into `agents-claude.ts` generator; dogfooded into arbiter's own `.claude/agents/`.
- **`contextPack.adrMappings` schema field**: Optional config key maps ADR IDs to INV IDs, allowing the checker to cross-reference plan ADR citations against the INV catalog. Validated by `validateContextPack()`.

**Consequences:** `arbiter verify plan` can now produce a fully-structured `CONTEXT_PACK.md` bundle consumed by the two-phase checker agents. The track→INV mapping is version-controlled and enforced. All four acceptance criteria (deterministic generator, track-INV mapping, ADR mapping config, combined-verdict schema) are covered by tests.
