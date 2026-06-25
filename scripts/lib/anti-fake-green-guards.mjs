// SPDX-License-Identifier: Apache-2.0
// arbiter — anti-fake-green GUARD ROSTER (SSOT, #1412 / A6 #1497). The single list of guards the
// anti-fake-green aggregate runs. Extracted to a lib so the guard-flip self-test harness
// (scripts/check-guard-flip.mjs) can enumerate the SAME roster the aggregate uses: a guard added
// here without a discrimination proof in the flip harness is presumed vacuous and FAILS CI.
// Pure data export — no entry point, no process.exit (see check-fail-closed-audit SKIP_FILES).
//
// class: 'file-scan' (deterministic, exit1=hard aggregate fail) | 'gh-audit' (remote, exit1=advisory).

/** @typedef {{ name: string, script: string, class: 'file-scan' | 'gh-audit' }} Guard */

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
]
