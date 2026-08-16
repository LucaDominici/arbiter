// SPDX-License-Identifier: Apache-2.0
// arbiter — anti-fake-green GUARD ROSTER (SSOT, #1412 / A6 #1497). The single list of guards the
// anti-fake-green aggregate runs. Extracted to a lib so the guard-flip self-test harness
// (scripts/check-guard-flip.mjs) can enumerate the SAME roster the aggregate uses: a guard added
// here without a discrimination proof in the flip harness is presumed vacuous and FAILS CI.
// Pure data export — no entry point, no process.exit (see check-fail-closed-audit SKIP_FILES).
//
// class: 'file-scan' (deterministic, exit1=hard aggregate fail) | 'gh-audit' (remote,
// exit1=advisory) | 'context-rot' (flip-proof required, aggregate-exempt — see below).

/** @typedef {{ name: string, script: string, class: 'file-scan' | 'gh-audit' | 'context-rot' }} Guard */

/** The anti-fake-green guard roster. @type {Guard[]} */
export const GUARDS = [
  { name: 'min-review-time', script: 'scripts/check-min-review-time.mjs', class: 'gh-audit' },
  {
    name: 'ownership-distribution',
    script: 'scripts/check-ownership-distribution.mjs',
    class: 'gh-audit',
  },
  // file-scan guards (#1412): deterministic, fail-closed; child exit 1 is a hard aggregate fail.
  // #1 muted-test — a skip/disable marker on a gate test (NO-DATA on no tests is a skip at 0).
  { name: 'muted-test', script: 'scripts/check-muted-test.mjs', class: 'file-scan' },
  // #6 skip-critical-e2e — a skipped e2e spec (NA when no e2e config exists).
  { name: 'skip-critical-e2e', script: 'scripts/check-skip-critical-e2e.mjs', class: 'file-scan' },
  // E10 no-stub-redirects — a stale "Moved →" stub .md husk (allowlist needs a hard EXPIRES).
  { name: 'no-stub-redirects', script: 'scripts/check-no-stub-redirects.mjs', class: 'file-scan' },
  // grace-window — an over-long / stale-level ADR-028 grace in arbiter.json (#1491): the classic
  // L2 fake-green via a hand-edited far-future graceEndsAt. NO-DATA (no active grace) is a PASS.
  { name: 'grace-window', script: 'scripts/check-grace-window.mjs', class: 'file-scan' },
  // secret-presence — a workflow run-step that depends on a secret, tests it for emptiness and
  // then `exit 0` (silent skip) without an explicit `vars.SKIP_<NAME>` opt-out (#1497). A missing
  // secret would otherwise turn the gate green with the real work never done. NO-DATA (no secret
  // steps) is a PASS.
  { name: 'secret-presence', script: 'scripts/check-secret-presence.mjs', class: 'file-scan' },
  // continue-on-error (A3, #1497) — a GATING job/step that swallows its failure via a const-true
  // `continue-on-error`. Parser-backed: catches the YAML-1.1 `on`/`yes` and `${{ true }}` forms the
  // regex sibling (check-workflow-test-integrity) misses, and also vets the shipped `.ejs`
  // templates. Sole exempt step = artifact up/download. NO-DATA (no workflows) is a PASS.
  { name: 'continue-on-error', script: 'scripts/check-continue-on-error.mjs', class: 'file-scan' },
  // no-empty-suite (A2, #1497) — a `test:*` script (or CI run-step) carrying `--passWithNoTests`
  // silently passes on an empty test directory: the classic "0 executed = green" false-green.
  // Folding the standalone INV-25 guard into the aggregate makes it disarm-proof (a broken guard
  // exit fails the aggregate). It stays individually wired in check-all too, so the named INV-25
  // gate remains visible + parity-tracked. NO-DATA (no offending scripts) is a PASS.
  { name: 'no-empty-suite', script: 'scripts/check-no-passwithnotests.mjs', class: 'file-scan' },
  // assertion-delta (#2161) — a diff removes test assertions with none added, or the skip-marker
  // count rises, without an Assertion-Delta-Override trailer: the reward-hacking shape
  // ImpossibleBench (arxiv 2510.20270) found models reach for most. Applies to any test stack
  // (unlike oracle-discrimination, which is Playwright-only and therefore NOT in this self/flip
  // SSOT — see src/generators/check-all.ts emitOracleDiscrimination and its doc comment).
  // NO-DATA (range unresolvable, or no test files touched) is a PASS.
  { name: 'assertion-delta', script: 'scripts/check-assertion-delta.mjs', class: 'file-scan' },
  // fixture-isolation (#2181) — fixture/smoke output must never land in a real evidence root:
  // the #2176 study found fake-* finding IDs leaked into real results, caught only by the semantic
  // judge. NO-DATA (no evidence roots) is a PASS.
  { name: 'fixture-isolation', script: 'scripts/check-fixture-isolation.mjs', class: 'file-scan' },
]

// Anti-context-rot gate roster (E1-E7 #1943, M11 flip-coverage — design doc
// docs/design/anti-context-rot-enforcers.md §Red-path proof: "a check proven only green is
// ceremony"). Enumerated by the guard-flip harness ONLY — deliberately NOT part of GUARDS:
// the anti-fake-green AGGREGATE spawns each GUARDS entry with no argv against the live repo,
// while these gates take bespoke argv (--evidence-dir/--dir/--file/--plan) and are already
// individually wired advisory in check-all.mjs. Adding them to GUARDS would double-run four
// and hard-error the fifth (check-touched-vs-manifest exits 2 without --plan/--group/--base).
// class 'context-rot': flip-proof required, aggregate-exempt.
//
// Five of the seven E1-E7 gate scripts are listed. The two absentees are named here rather
// than left to be discovered: check-bypass-ceremony.mjs (E4 #1949) and
// check-review-completion.mjs (E1a #2177). Both carry planted-bad/planted-clean fixtures in
// __tests__/scripts/, which is the red-path proof the design doc §0 requires; what they lack
// is a bespoke-argv entry in guard-flip-registry.mjs, which is the playbook §T3 extension.
// That is exactly why the M11 "flip-coverage 100% of emitted gates" row in
// docs/methodology/agent-orchestration-and-context-hygiene.md §5 is still PARTIAL. Adding
// either name here without its registry fixture would make check-guard-flip.mjs error on an
// unknown guard, so the roster and the registry move together or not at all.

/** @type {Guard[]} */
export const CONTEXT_ROT_GATES = [
  { name: 'agent-return', script: 'scripts/check-agent-return.mjs', class: 'context-rot' },
  {
    name: 'refutation-verdicts',
    script: 'scripts/check-refutation-verdicts.mjs',
    class: 'context-rot',
  },
  { name: 'audit-dry-pass', script: 'scripts/check-audit-dry-pass.mjs', class: 'context-rot' },
  { name: 'handoff-doc', script: 'scripts/check-handoff-doc.mjs', class: 'context-rot' },
  {
    name: 'touched-vs-manifest',
    script: 'scripts/check-touched-vs-manifest.mjs',
    class: 'context-rot',
  },
]
