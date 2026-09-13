// SPDX-License-Identifier: Apache-2.0
// #2675 — dedicated flip proofs for the 12 (of 19) #2560 ABSENCE_EXEMPT candidates promoted to
// ABSENCE_FAMILY_ROSTER with a real inversion fixture (scripts/lib/guard-flip-registry.mjs),
// rather than a deferral-ledger row. This file runs each gate SCRIPT DIRECTLY (not through the
// check-guard-flip harness) against its registered plantBad/plantClean fixtures and asserts both
// the exit code AND the specific violating diagnostic — a fixture that merely exits non-zero for
// an unrelated reason (e.g. a missing directory) would be a fake flip proof.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { FLIP_REGISTRY } from '../../scripts/lib/guard-flip-registry.mjs'
import { ABSENCE_FAMILY_ROSTER } from '../../scripts/lib/gate-roster.mjs'

function withTmp<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'gate-2675-flip-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function run(
  scriptPath: string,
  entry: (typeof FLIP_REGISTRY)[string],
  plant: 'plantBad' | 'plantClean',
) {
  return withTmp((dir) => {
    entry[plant](dir)
    const spawnArgs =
      typeof entry.argv === 'function'
        ? [scriptPath, ...entry.argv(dir)]
        : entry.inject === 'dir'
          ? [scriptPath, '--dir', dir]
          : [scriptPath]
    const cwd = entry.inject === 'cwd' ? dir : process.cwd()
    return spawnSync('node', spawnArgs, { encoding: 'utf-8', cwd })
  })
}

// name → { script, badMessage } — the diagnostic substring the BAD fixture must produce.
const CASES: Record<string, { script: string; badMessage: RegExp }> = {
  'anti-drift: secret scan': {
    script: 'scripts/check-secret-scan.mjs',
    badMessage: /potential AWS Access Key found/,
  },
  'anti-drift: validator helptext': {
    script: 'scripts/check-validator-helptext.mjs',
    badMessage: /no --help flag support found/,
  },
  'anti-drift: drift manifest': {
    script: 'scripts/check-drift.mjs',
    badMessage: /drift detected in generated\.txt/,
  },
  'anti-drift: workflow docs sync': {
    script: 'scripts/check-workflow-docs-sync.mjs',
    badMessage: /not referenced in any docs\/ markdown/,
  },
  'npm-ci drift (#1684)': {
    script: 'scripts/check-npm-ci-drift.mjs',
    badMessage: /packageManager pin missing or not an exact npm@X\.Y\.Z/,
  },
  'anti-drift: pii scan config': {
    script: 'scripts/check-pii-scan.mjs',
    badMessage: /invalid regex/,
  },
  'anti-drift: tier coverage': {
    script: 'scripts/check-tier-coverage.mjs',
    badMessage: /tier "ci tiers" not found/,
  },
  'anti-drift: suppression rationale': {
    script: 'scripts/check-suppression-rationale.mjs',
    badMessage: /has thin reason/,
  },
  'anti-drift: suppression expiry': {
    script: 'scripts/check-suppression-expiry.mjs',
    badMessage: /exceed \d+-day expiry window|entry expires in \d+ day/,
  },
  'anti-drift: pr size gate': {
    script: 'scripts/check-pr-size-gate.mjs',
    badMessage: /exceeds maximum/,
  },
  'anti-drift: workflow runners': {
    script: 'scripts/check-workflow-runners.mjs',
    badMessage: /unexpected runner/,
  },
  'anti-drift: docker action runner safety (#1756)': {
    script: 'scripts/check-docker-action-runner-safety.mjs',
    badMessage: /uses docker-container action/,
  },
}

describe('#2675 — proven gates discriminate on their registered fixtures', () => {
  for (const [name, { script, badMessage }] of Object.entries(CASES)) {
    it(`${name}: registered in ABSENCE_FAMILY_ROSTER against the right script`, () => {
      expect(ABSENCE_FAMILY_ROSTER[name]?.script).toBe(script)
    })

    it(`${name}: BAD fixture exits non-zero with the violating diagnostic`, () => {
      const entry = FLIP_REGISTRY[name]
      expect(entry, `${name} has no FLIP_REGISTRY entry`).toBeDefined()
      const r = run(resolve(script), entry, 'plantBad')
      expect(r.status).not.toBe(0)
      expect(`${r.stdout}${r.stderr}`).toMatch(badMessage)
    })

    it(`${name}: CLEAN fixture exits 0`, () => {
      const entry = FLIP_REGISTRY[name]
      const r = run(resolve(script), entry, 'plantClean')
      expect(r.status).toBe(0)
    })
  }
})
