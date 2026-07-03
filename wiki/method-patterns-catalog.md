---
generated: true
source: 'docs/METHOD/PATTERNS_CATALOG.md'
source_sha: '0d04e2bac910b2db2f2a6493fde7528afae4811f'
last_updated: '2026-07-03'
---

# arbiter Patterns Catalog

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/METHOD/PATTERNS_CATALOG.md](../docs/METHOD/PATTERNS_CATALOG.md)

# arbiter Patterns Catalog

**Purpose:** A curated registry of arbiter-original code patterns surveyed from this repository.
Each entry is anchored to a literal directory under `src/` or `scripts/` and answers six questions:
when to use it, when to avoid it, what varies, how it is tested, and what was rejected.

**Audience:** contributors building new detectors, generators, verify rules, or hardening gates.
Read this before opening a new file under `src/` (CANON-16: refactor-first / existing-code survey).

**Scope and limits:**

- This catalog is not a tutorial. Each entry is a pointer plus the design decisions worth knowing.
- Entries describe patterns observed in this repository; they are not borrowed from external sources.
- Maximum 12 entries. The structure gate (`__tests__/docs/patterns-catalog-structure.test.ts`)
  rejects entries with missing fields or non-literal registry paths.

---

## 1. Detector emitter

- **Use when:** you need a pure synchronous probe that maps a filesystem fingerprint
  (a `package.json`, a `pom.xml`, a `Cargo.toml`, a `pyproject.toml`) to a typed label
  consumed by the wizard or generators.
- **Avoid when:** the input requires network I/O, long-running computation, or shells out
  to another tool. Detectors must run in milliseconds during wizard init.
- **Registry path:** `src/detectors/`
- **Variation axis:** input language and the dimension being detected
  (framework, build tool, lane, GitHub remote, module structure).
- **Test approach:** input fixtures under `__tests__/fixtures/real-projects/` plus
  per-detector unit tests that pin the returned label for each fingerprint.
- **Rejected alternatives:** a single mega-detector switching on language; tossed
  because branching one file per concern keeps each probe small enough to reason about
  in isolation and to test without a matrix.

## 2. Verify rule registry

- **Use when:** you need a structural plan-review check that can fail or warn on a
  plan JSON before any code lands. The registry composes the rules; each rule is a
  pure function `(plan) => Finding[]`.
- **Avoid when:** the check needs runtime evidence (build output, test results). Those
  belong in `scripts/check-*.mjs` gate scripts, not the plan-review pipeline.
- **Registry path:** `src/verify/`
- **Variation axis:** the dimension being audited (drive-by scope, orphan TODOs, UI
  language, skip patterns). Each rule lives in its own file under `rules/` and is
  composed via `rules/registry.ts`.
- **Test approach:** golden plan fixtures driven through `runVerify()`; assert the
  `ReviewJsonV1` shape, status, and per-rule findings.
- **Rejected alternatives:** runtime-only enforcement; rejected because catching a bad
  plan before implementation is orders of magnitude cheaper than catching a bad commit
  after the gate has run.

## 3. Kit catalog wrapper

- **Use when:** you need a versioned, JSON-shaped catalog of policy thresholds and
  baselines that survives template regeneration unchanged.
- **Avoid when:** the value is per-project configuration (use `arbiter.json`) or
  per-generator constant (inline it).
- **Registry path:** `src/kit/`
- **Variation axis:** the policy domain — coverage thresholds, gate counts per
  governance level, stack-specific gap ratios. Each domain owns a top-level key in the
  baseline JSON.
- **Test approach:** schema validation on the baseline JSON plus snapshot tests that
  pin the published thresholds. The snapshot deliberately fails when a threshold
  changes so reviewers must accept the new floor explicitly.
- **Rejected alternatives:** embedding thresholds in `thresholds-l1-l2-l3.ts` only;
  rejected because external tooling and audits read the JSON directly and a code
  constant cannot be consumed without a build.

## 4. Generator EJS pipeline

- **Use when:** you need to emit a target file (workflow YAML, hook script, CLAUDE.md
  fragment) that varies along the `(language, archetype, governanceLevel)` axes.
- **Avoid when:** the output is a single static file with no variation. Just check
  the static file into the templates tree.
- **Registry path:** `src/generators/`
- **Variation axis:** the target tool (claude / codex / cursor / aider / windsurf /
  gemini / copilot) and the domain (CI, hooks, agents, boundaries, security).
- **Test approach:** snapshot tests that render each EJS template against three
  matrix points per language and diff against committed fixtures. The full matrix
  is covered by `__tests__/fixtures/real-projects/`.
- **Rejected alternatives:** templated string concatenation in TypeScript; rejected
  because `.ejs` files are the unit of audit and review, and conditionals in EJS
  are first-class (see CANON-13).

## 5. Evidence-bundle schema

- **Use when:** you need to persist verifiable artefacts (TDD red-phase capture,
  gate output, mutation-test reports) that prove an invariant was honoured for a
  specific task.
- **Avoid when:** the data is transient (CI cache, build logs). Evidence is durable
  by design and is validated by INV-90.
- **Registry path:** `scripts/`
- **Variation axis:** the evidence kind — TDD, mutation, contract, gauntlet — each
  with its own JSON shape under `schemas/`.
- **Test approach:** every emitter writes through `writeTddEvidence`-style helpers
  that validate against `schemas/evidence-bundle.schema.json`. The gate script
  `check-evidence-bundle.mjs` re-validates every bundle pre-commit.
- **Rejected alternatives:** free-form Markdown evidence; rejected because audits
  must be machine-readable and stable across tool upgrades.

## 6. Run-helpers trinity

- **Use when:** you need a gate step that distinguishes hard failures, informational
  warnings, and CI-aware tool gates (SKIP locally, FAIL in CI when the binary is
  missing).
- **Avoid when:** the call has no semantics worth distinguishing — use a plain
  `spawnSync` only inside the gate runner itself, which is the documented exception
  to INV-12.
- **Registry path:** `scripts/lib/`
- **Variation axis:** the semantic — HARD (`runCheck`), WARN (`runWarnCheck`),
  TOOL (`runToolCheck`). Each gate step picks exactly one; INV-NN-backed checks
  must use `runCheck`.
- **Test approach:** unit tests under `__tests__/scripts/` that stub `spawnSync`
  and assert the returned status, the failure counter, and the summary entries.
  Plus `check-inv-enforcement-wired.mjs` audits that no INV-backed step uses WARN.
- **Rejected alternatives:** one runner with three flags; rejected because three
  named entrypoints are self-documenting at the call site and let the audit script
  identify mis-classified checks with a literal name match.

## 7. Agent-rules emitter

- **Use when:** you need to generate the always-loaded rules tree
  (`.claude/rules/*.md`, `.codex/rules/*.md`) for a target project so its agents
  inherit arbiter's invariants and CANON rules.
- **Avoid when:** the content is per-conversation context (use a slash command) or
  per-edit guardrail (use a hook). Rules are always-loaded prose.
- **Registry path:** `src/templates/claude/`
- **Variation axis:** the target agent runtime (claude / codex / aider) and the
  governance level (L1 / L2 / L3). EJS `<% if (governanceLevel >= 'L2') %>` guards
  gate optional rules.
- **Test approach:** template render snapshots per tool × governance level, plus a
  dogfood gate that asserts the self-applied rules under `.claude/rules/` match
  what the generator would emit for this repo (`scripts/check-self-dogfood.mjs`).
- **Rejected alternatives:** a single shared rules tree across all agents; rejected
  because each agent runtime has its own loader semantics and file naming
  conventions, and one tree would have forced lowest-common-denominator content.

## 8. Gauntlet emitter

- **Use when:** you need to expand a parametric test specification into deterministic
  test files across multiple language stacks, with a content hash that proves the
  emitted tests are still in sync with the spec.
- **Avoid when:** the test is

*[content truncated — see source for full text]*
