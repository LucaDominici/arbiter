// SPDX-License-Identifier: Apache-2.0
// The regulated overlay gate must be ENFORCEABLE — exit 0 on a clean policy,
// exit 1 when a pillar is weakened below the regulated floor, exit 2 fail-closed
// when the policy manifest is absent or unparseable. Renders the generated
// artefacts to a temp project and runs the gate.

import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateRegulated } from '../../src/generators/regulated.js'

let dir: string
afterEach(() => {
  if (dir) cleanupTestProject(dir)
})

/** Run the generated gate; return { code, out }. 0 = pass, 1 = fail, 2 = error. */
function runGate(projectDir: string): { code: number; out: string } {
  try {
    const out = execFileSync('node', ['scripts/check-regulated-overlay.mjs'], {
      cwd: projectDir,
      encoding: 'utf-8',
    })
    return { code: 0, out }
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

function scaffold(): string {
  const d = createTestProject('typescript')
  generateRegulated(makeConfig(d, { language: 'typescript', industryOverlay: 'regulated' }))
  return d
}

const MANIFEST = '.arbiter/regulated/overlay.json'

function patchManifest(projectDir: string, mutate: (m: Record<string, unknown>) => void): void {
  const p = join(projectDir, MANIFEST)
  const m = JSON.parse(readFileSync(p, 'utf-8'))
  mutate(m)
  writeFileSync(p, `${JSON.stringify(m, null, 2)}\n`)
}

describe('check-regulated-overlay gate — enforceable', () => {
  it('exits 0 on the freshly-scaffolded (clean) regulated policy', () => {
    dir = scaffold()
    const { code, out } = runGate(dir)
    expect(out).toContain('check-regulated-overlay: OK')
    expect(code).toBe(0)
  })

  it('exits 1 when separation-of-duties no longer requires human approval on AI PRs', () => {
    dir = scaffold()
    patchManifest(dir, (m) => {
      ;(m.separationOfDuties as Record<string, unknown>).requireHumanApprovalOnAiAuthoredPR = false
    })
    const { code, out } = runGate(dir)
    expect(code).toBe(1)
    expect(out).toContain('separationOfDuties')
    expect(out).toContain('requireHumanApprovalOnAiAuthoredPR must be true')
  })

  it('exits 1 when audit retention is dropped below the floor', () => {
    dir = scaffold()
    patchManifest(dir, (m) => {
      ;(m.auditTrail as Record<string, unknown>).retentionDays = 30
    })
    const { code, out } = runGate(dir)
    expect(code).toBe(1)
    expect(out).toContain('auditTrail')
  })

  it('exits 1 when suppression expiry is made non-mandatory', () => {
    dir = scaffold()
    patchManifest(dir, (m) => {
      ;(m.suppressionExpiry as Record<string, unknown>).mandatory = false
    })
    expect(runGate(dir).code).toBe(1)
  })

  it('exits 1 when signing or SBOM attestation is disabled', () => {
    dir = scaffold()
    patchManifest(dir, (m) => {
      ;(m.attestation as Record<string, unknown>).cosign = false
    })
    const { code, out } = runGate(dir)
    expect(code).toBe(1)
    expect(out).toContain('attestation')
  })

  it('exits 1 when the mutation-coverage floor is removed', () => {
    dir = scaffold()
    patchManifest(dir, (m) => {
      ;(m.mutationCoverage as Record<string, unknown>).minScore = 0
    })
    expect(runGate(dir).code).toBe(1)
  })

  it('exits 1 when a whole pillar is dropped (cannot silently un-wire the bundle)', () => {
    dir = scaffold()
    patchManifest(dir, (m) => {
      delete m.attestation
    })
    expect(runGate(dir).code).toBe(1)
  })

  it('exits 0 after restoring a tightened-but-valid policy (round-trip)', () => {
    dir = scaffold()
    patchManifest(dir, (m) => {
      ;(m.separationOfDuties as Record<string, unknown>).minHumanApprovals = 2
      ;(m.auditTrail as Record<string, unknown>).retentionDays = 730
    })
    expect(runGate(dir).code).toBe(0)
  })

  it('exits 2 (fail-closed) when the policy manifest is absent', () => {
    dir = scaffold()
    rmSync(join(dir, MANIFEST))
    expect(runGate(dir).code).toBe(2)
  })

  it('exits 2 (fail-closed) when the policy manifest is unparseable', () => {
    dir = scaffold()
    writeFileSync(join(dir, MANIFEST), '{ not json')
    expect(runGate(dir).code).toBe(2)
  })
})
