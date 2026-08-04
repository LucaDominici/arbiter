// SPDX-License-Identifier: Apache-2.0
// #2041 — declarative gate registry. RED tests: a gate's lane membership must be
// declarative (registry-driven, not hardcoded in the EJS ifs); L3 must be an
// executable LOCAL lane (no clamp); a layering contract test must be emitted
// into the consumer.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderGate(data: Record<string, unknown>): string {
  return renderTemplate('scripts/check-all.mjs.ejs', data)
}

function runScript(scriptBody: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), 'gate-registry-'))
  try {
    writeFileSync(join(dir, 'check-all.mjs'), scriptBody, 'utf-8')
    const r = spawnSync('node', [join(dir, 'check-all.mjs'), ...args], { encoding: 'utf-8' })
    return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function baseData(dir: string): Record<string, unknown> {
  return makeConfig(dir, {
    governanceLevel: 'L2',
    invariantTiers: ['architectural', 'governance', 'data', 'operational'],
  }) as unknown as Record<string, unknown>
}

describe('declarative gate registry (#2041)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gate-reg-fixture-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('AC-2041.2/4: a gate level declared in the registry drives its lane membership', () => {
    const data = baseData(dir)
    // The probe gate is declared at L2 in the registry data — it must run at L2
    // and be ABSENT from the L1 dry-run manifest. Today the level is hardcoded
    // in the EJS ifs and the gates data is ignored.
    const probe = {
      id: 'probe',
      name: 'probe gate',
      level: 'L2',
      kind: 'check',
      cmd: ['node', ['probe.mjs']],
    }
    const rendered = renderGate({ ...data, gates: [probe] })
    const l1 = runScript(rendered, ['--level', 'L1', '--dry-run'])
    expect(l1.stdout).not.toContain('probe gate')
    const l2 = runScript(rendered, ['--level', 'L2', '--dry-run'])
    expect(l2.stdout).toContain('probe gate')
  })

  it('AC-2041.1: L3 is an executable local lane — no clamp warning, L3 gates run', () => {
    const data = baseData(dir)
    const rendered = renderGate(data)
    const l3 = runScript(rendered, ['--level', 'L3', '--dry-run'])
    expect(l3.stderr).not.toContain('clamps to L2')
    expect(l3.stdout).toContain('solo reactivation')
  })

  it('AC-2041.3: a layering contract test is emitted for consumers', () => {
    const data = baseData(dir)
    // The emitted test asserts L1 ⊂ L2 ⊂ L3 membership from the registry.
    const rendered = renderTemplate('scripts/test-gate-layering.mjs.ejs', data)
    expect(rendered).toMatch(/L1/)
    const scriptDir = mkdtempSync(join(tmpdir(), 'gate-layering-'))
    try {
      writeFileSync(join(scriptDir, 'test-gate-layering.mjs'), rendered, 'utf-8')
      writeFileSync(
        join(scriptDir, 'check-all.mjs'),
        renderGate({ ...data, gates: [] }),
        'utf-8',
      )
      const r = spawnSync('node', [join(scriptDir, 'test-gate-layering.mjs')], {
        cwd: scriptDir,
        encoding: 'utf-8',
      })
      expect(r.status).toBe(0)
    } finally {
      rmSync(scriptDir, { recursive: true, force: true })
    }
  })
})
