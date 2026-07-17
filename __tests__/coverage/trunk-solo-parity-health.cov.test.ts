// SPDX-License-Identifier: Apache-2.0
//
// #1977: doctor health coverage for the trunk-solo × local-ci-parity coherence
// row. trunk-solo without BOTH a local-ci-parity check script AND push-gating
// (.githooks/pre-push wired to run the gate) is CRITICAL (FAIL), not a warning
// — a no-PR flow has no independent CI net without it. This is a hard-coherence
// check, distinct from the pre-existing advisory `collab-coherence` row.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runDoctorHealth } from '../../src/commands/doctor/health.js'
import type { HealthCheck } from '../../src/commands/doctor/health.js'

function findCheck(checks: HealthCheck[], id: string): HealthCheck | undefined {
  return checks.find((c) => c.id === id)
}

describe('doctor health — trunk-solo-parity-wiring (#1977)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-doc-parity-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('FAILs (CRITICAL) when trunk-solo has neither parity check nor push-gating', async () => {
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({ collaborationMode: 'trunk-solo', governanceLevel: 'L1' }),
    )
    const result = await runDoctorHealth({ dir, json: true })
    const c = findCheck(result.checks, 'trunk-solo-parity-wiring')
    expect(c?.status).toBe('FAIL')
    expect(c?.detail).toContain('local-ci-parity')
    expect(result.exitCode).toBe(1)
  })

  it('FAILs when trunk-solo has push-gating but no parity check script', async () => {
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({ collaborationMode: 'trunk-solo', governanceLevel: 'L1' }),
    )
    mkdirSync(join(dir, '.githooks'), { recursive: true })
    writeFileSync(join(dir, '.githooks', 'pre-push'), '#!/usr/bin/env bash\nnode scripts/check-all.mjs gate\n')
    const result = await runDoctorHealth({ dir, json: true })
    const c = findCheck(result.checks, 'trunk-solo-parity-wiring')
    expect(c?.status).toBe('FAIL')
  })

  it('PASSes when trunk-solo has both parity check and push-gating wired', async () => {
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({ collaborationMode: 'trunk-solo', governanceLevel: 'L1' }),
    )
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    writeFileSync(join(dir, 'scripts', 'check-local-ci-parity.mjs'), '// parity check\n')
    mkdirSync(join(dir, '.githooks'), { recursive: true })
    writeFileSync(join(dir, '.githooks', 'pre-push'), '#!/usr/bin/env bash\nnode scripts/check-all.mjs gate\n')
    const result = await runDoctorHealth({ dir, json: true })
    const c = findCheck(result.checks, 'trunk-solo-parity-wiring')
    expect(c?.status).toBe('PASS')
  })

  it('PASSes trivially for peer-review (no parity requirement)', async () => {
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({ collaborationMode: 'peer-review', governanceLevel: 'L2' }),
    )
    const result = await runDoctorHealth({ dir, json: true })
    const c = findCheck(result.checks, 'trunk-solo-parity-wiring')
    expect(c?.status).toBe('PASS')
  })

  it('surfaces run.sh-gate vs CI-workflow divergence for trunk-solo repos', async () => {
    // trunk-solo, parity+push-gating wired, but CI workflow set diverges from
    // the local gate's own declared job set (static parity drift) — WARN detail
    // names the divergence rather than silently PASSing.
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({ collaborationMode: 'trunk-solo', governanceLevel: 'L2' }),
    )
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    writeFileSync(join(dir, 'scripts', 'check-local-ci-parity.mjs'), '// parity check\n')
    mkdirSync(join(dir, '.githooks'), { recursive: true })
    writeFileSync(join(dir, '.githooks', 'pre-push'), '#!/usr/bin/env bash\nnode scripts/check-all.mjs gate\n')
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
    writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), 'name: ci\n')
    const result = await runDoctorHealth({ dir, json: true })
    const c = findCheck(result.checks, 'trunk-solo-parity-wiring')
    expect(c).toBeDefined()
    expect(c?.detail).toMatch(/CI workflow/i)
  })
})
