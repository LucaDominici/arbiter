// SPDX-License-Identifier: Apache-2.0
// conformance/gate-proofs.ts — negative proofs for `arbiter doctor --prove-gates` (#1817, A5).
//
// Handoff A5 (#1817 gold-rebaseline patterns): the anti-pattern observed on a 100k-LOC
// reference project was ~40 `test-*.sh` scripts that unit-tested the gate SCRIPTS
// themselves (meta-tax, no reality-contact). The pattern that
// WORKED was `ArchNegativeProofTest` — one intentional-violation fixture per rule, proving
// the rule actually fails when violated. This module is arbiter's generalisation of that
// pattern to its own must-pass (tier-1) conformance dimensions: every tier-1 dimension in
// dimensions.ts is a "gate" (see DimensionEntry.tier doc — "1 = must-pass gate"). For each
// one this file seeds an isolated fixture directory that intentionally VIOLATES the rule,
// runs the real probe against it, and asserts the probe reports a failing verdict.
//
// "Bites" is defined identically to score.ts's tier1Fails predicate (verdict N or P) so this
// harness proves exactly the condition that would flip `arbiter conformance` to
// NON-CONFORMANT — not a bespoke, weaker notion of failure.
//
// A gate whose negative fixture does NOT produce a failing verdict is exactly the failure
// mode this command exists to catch: a gate that looks installed but does not bite.

import { ensureDir, mkdtempTranslated, rmTranslated, writeFileTranslated } from '../utils/fs.js'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { DimensionEntry, Verdict } from './dimensions.js'
import {
  probeDTestLevels,
  probeDLiveE2e,
  probeDFeRenderGate,
  probeDDomainApi,
  probeDDoneEvidence,
  probeGateGreen,
  probeCoverageThresholds,
  probeInvariantsEnforced,
  probeNoOverclaim,
  probeCommitHygiene,
  probeFindingHygiene,
  probeE2eQuarantine,
} from './dimensions.js'

/** A single tier-1 gate's negative-proof fixture + runner. */
export interface GateProof {
  /** Same id as the DimensionEntry this proof targets (e.g. 'D-GATE-GREEN'). */
  id: string
  /** What the seeded fixture intentionally violates. */
  violation: string
  /** Populate `dir` with files that intentionally violate the gate. Never throws. */
  seed: (dir: string) => void
  /** Run the real probe against the seeded dir and return its verdict. */
  run: (dir: string) => DimensionEntry
}

/** Mirrors score.ts's tier1Fails predicate exactly: N or P is a failing (biting) verdict. */
export function verdictBites(verdict: Verdict): boolean {
  return verdict === 'N' || verdict === 'P'
}

/** Result of running one proof: whether the gate bit as designed. */
export interface GateProofResult {
  id: string
  title: string
  violation: string
  verdict: Verdict
  bites: boolean
  detail: string
}

function writeJson(dir: string, relPath: string, body: unknown): void {
  const abs = join(dir, relPath)
  ensureDir(join(abs, '..'))
  writeFileTranslated(abs, JSON.stringify(body))
}

function writeText(dir: string, relPath: string, body: string): void {
  const abs = join(dir, relPath)
  ensureDir(join(abs, '..'))
  writeFileTranslated(abs, body)
}

// ── The 12 tier-1 gate proofs (dimensions.ts) ──────────────────────────────────

const GATE_PROOFS: GateProof[] = [
  {
    id: 'D-TEST-LEVELS',
    violation: 'test-pyramid.json declares a required level with no matching test file',
    seed: (dir: string): void => {
      writeJson(dir, 'test-pyramid.json', {
        levels: [{ level: 'unit', status: 'required', globs: ['nonexistent/**/*.spec.ts'] }],
      })
    },
    run: (dir) => probeDTestLevels(dir),
  },
  {
    id: 'D-LIVE-E2E',
    violation: 'backend archetype with api-e2e.json declaring zero suites',
    seed: (dir: string): void => {
      writeJson(dir, 'api-e2e.json', { suiteCount: 0 })
    },
    run: (dir) => probeDLiveE2e(dir, 'backend'),
  },
  {
    id: 'D-FE-RENDER-GATE',
    violation: 'frontend archetype with no playwright/vitest-browser/chromatic config',
    seed: (): void => {
      /* bare directory — absence IS the violation for this existence-only gate */
    },
    run: (dir) => probeDFeRenderGate(dir, 'frontend'),
  },
  {
    id: 'D-DOMAIN-API',
    violation: 'domain-api-surface.json present with an empty checks array',
    seed: (dir: string): void => {
      writeJson(dir, 'domain-api-surface.json', { checks: [] })
    },
    run: (dir) => probeDDomainApi(dir),
  },
  {
    id: 'D-DONE-EVIDENCE',
    violation: 'done-evidence recorded with reality_contact.passed=false',
    seed: (dir: string): void => {
      writeJson(dir, '.claude/.last-done-evidence.json', { reality_contact: { passed: false } })
    },
    run: (dir) => probeDDoneEvidence(dir),
  },
  {
    id: 'D-GATE-GREEN',
    violation: 'local gate result recorded with pass=false',
    seed: (dir: string): void => {
      writeJson(dir, '.arbiter/gate/local-result.json', { pass: false })
    },
    run: (dir) => probeGateGreen(dir),
  },
  {
    id: 'D-COVERAGE-THRESHOLDS',
    violation: 'coverage summary with lines below the 80% threshold',
    seed: (dir: string): void => {
      writeJson(dir, 'coverage/coverage-summary.json', {
        total: {
          lines: { pct: 50 },
          branches: { pct: 90 },
          functions: { pct: 90 },
          statements: { pct: 90 },
        },
      })
    },
    run: (dir) => probeCoverageThresholds(dir),
  },
  {
    id: 'D-NO-OVERCLAIM',
    violation: 'done-evidence recorded with no_overclaim=false',
    seed: (dir: string): void => {
      writeJson(dir, '.claude/.last-done-evidence.json', { no_overclaim: false })
    },
    run: (dir) => probeNoOverclaim(dir),
  },
  {
    id: 'D-COMMIT-HYGIENE',
    violation: 'hooks dir and commitlint config both present but empty (substance, not presence)',
    seed: (dir: string): void => {
      ensureDir(join(dir, '.githooks'))
      writeText(dir, 'commitlint.config.js', '')
    },
    run: (dir) => probeCommitHygiene(dir),
  },
  {
    id: 'DISC-finding-hygiene',
    violation: 'open findings count rose since the recorded baseline (filed without draining)',
    seed: (dir: string): void => {
      writeText(
        dir,
        '.arbiter/findings/shard-0.jsonl',
        `${JSON.stringify({ fingerprint: 'fp-1', ts: new Date().toISOString() })}\n${JSON.stringify(
          { fingerprint: 'fp-2', ts: new Date().toISOString() },
        )}\n`,
      )
      writeJson(dir, '.arbiter/finding-hygiene-baseline.json', { openFindingsCount: 1 })
    },
    run: (dir) => probeFindingHygiene(dir),
  },
  {
    id: 'DISC-e2e-quarantine',
    violation: 'quarantine registry with one entry past its TTL (expired)',
    seed: (dir: string): void => {
      writeJson(dir, '.arbiter/e2e/quarantine.json', {
        entries: [
          {
            id: 'flaky-checkout-redirect',
            fingerprint: 'fp_0123456789abcdef',
            reason: 'intermittent redirect race under load',
            owner: 'team-payments',
            added: '2000-01-01',
            expires: '2000-01-02',
            issue: '#9999',
          },
        ],
      })
    },
    run: (dir) => probeE2eQuarantine(dir),
  },
  {
    id: 'D-INVARIANTS-ENFORCED',
    violation: 'invariants prescribed (arbiter.json invariantTiers) but no catalog present',
    seed: (dir: string): void => {
      writeJson(dir, 'arbiter.json', { invariantTiers: ['security'] })
    },
    run: (dir) => probeInvariantsEnforced(dir),
  },
]

/**
 * Run one gate proof in an isolated tmp directory. Never throws: a proof whose seed/run throws
 * is reported as a non-biting result with the error in `detail` (fail-visible, not fail-silent —
 * a crashing probe is itself evidence the gate cannot be relied on).
 */
function runOneProof(proof: GateProof): GateProofResult {
  const dir = mkdtempTranslated(join(tmpdir(), 'arbiter-gate-proof-'))
  try {
    proof.seed(dir)
    const entry = proof.run(dir)
    return {
      id: proof.id,
      title: entry.title,
      violation: proof.violation,
      verdict: entry.verdict,
      bites: verdictBites(entry.verdict),
      detail: entry.evidence.detail ?? '',
    }
    // FAIL-OPEN-INTENT: fail-closed by data — the error becomes a bites:false result carrying the message, which makes doctor --prove-gates exit 1.
  } catch (err) {
    return {
      id: proof.id,
      title: proof.id,
      violation: proof.violation,
      verdict: 'NV',
      bites: false,
      detail: `proof crashed: ${err instanceof Error ? err.message : String(err)}`,
    }
  } finally {
    rmTranslated(dir, { recursive: true, force: true })
  }
}

/** Run every registered gate proof and report which gates bite and which don't. */
export function runGateProofs(): GateProofResult[] {
  return GATE_PROOFS.map(runOneProof)
}
