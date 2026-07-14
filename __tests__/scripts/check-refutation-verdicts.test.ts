// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for scripts/check-refutation-verdicts.mjs (E2 #1943, M13 refutation-by-majority).
 * Existing Code Survey (CANON-16): no refutation gate exists; closest is check-agent-return.mjs
 * (envelope shape, not verdict majority). New script justified.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const SCRIPT = new URL('../../scripts/check-refutation-verdicts.mjs', import.meta.url).pathname

function run(evidenceDir: string): { exitCode: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [SCRIPT, '--evidence-dir', evidenceDir], {
    encoding: 'utf-8',
    timeout: 10000,
  })
  return { exitCode: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function skepticEnvelope(
  refutations: { target: string; verdict: string }[],
): Record<string, unknown> {
  return {
    schema: 'arbiter-agent-return-v1',
    agent: 'red-team',
    role: 'skeptic',
    taskId: '#1943',
    branch: 'main',
    sha: 'abcdef0',
    ts: '2026-07-14T10:00:00.000Z',
    verdict: 'PASS',
    confidence: 0.7,
    findings: [],
    refutations,
  }
}

describe('check-refutation-verdicts.mjs', () => {
  let tmpDir: string
  let evidenceDir: string
  let taskDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'refutation-'))
    evidenceDir = join(tmpDir, '.arbiter', 'evidence', 'agent-returns')
    taskDir = join(evidenceDir, '_1943')
    mkdirSync(taskDir, { recursive: true })
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function writeMarker(body: Record<string, unknown>) {
    writeFileSync(join(taskDir, 'refutation-required.json'), JSON.stringify(body, null, 2))
  }
  function writeSkeptic(name: string, env: Record<string, unknown>) {
    writeFileSync(join(taskDir, name), JSON.stringify(env, null, 2))
  }

  it('vacuous pass when no marker exists', () => {
    expect(run(evidenceDir).exitCode).toBe(0)
  })

  it('passes when marker present but findings array is empty', () => {
    writeMarker({ task: '#1943', skeptics: 3, findings: [] })
    expect(run(evidenceDir).exitCode).toBe(0)
  })

  it('fails when marker has invalid skeptics count', () => {
    writeMarker({ task: '#1943', skeptics: 0, findings: ['f1'] })
    expect(run(evidenceDir).exitCode).toBe(1)
  })

  it('fails when a finding has fewer than N skeptic verdicts', () => {
    writeMarker({ task: '#1943', skeptics: 3, findings: ['f1'] })
    writeSkeptic('s1.json', skepticEnvelope([{ target: 'f1', verdict: 'UPHELD' }]))
    writeSkeptic('s2.json', skepticEnvelope([{ target: 'f1', verdict: 'UPHELD' }]))
    const r = run(evidenceDir)
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toMatch(/need >= 3/i)
  })

  it('fails when an acted-on finding is majority-refuted (1 UPHELD / 2 REFUTED, N=3)', () => {
    writeMarker({ task: '#1943', skeptics: 3, findings: ['f1'] })
    writeSkeptic('s1.json', skepticEnvelope([{ target: 'f1', verdict: 'UPHELD' }]))
    writeSkeptic('s2.json', skepticEnvelope([{ target: 'f1', verdict: 'REFUTED' }]))
    writeSkeptic('s3.json', skepticEnvelope([{ target: 'f1', verdict: 'REFUTED' }]))
    const r = run(evidenceDir)
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toMatch(/majority-refuted/i)
  })

  it('passes when 2 UPHELD / 1 REFUTED (strict majority survives, N=3)', () => {
    writeMarker({ task: '#1943', skeptics: 3, findings: ['f1'] })
    writeSkeptic('s1.json', skepticEnvelope([{ target: 'f1', verdict: 'UPHELD' }]))
    writeSkeptic('s2.json', skepticEnvelope([{ target: 'f1', verdict: 'UPHELD' }]))
    writeSkeptic('s3.json', skepticEnvelope([{ target: 'f1', verdict: 'REFUTED' }]))
    expect(run(evidenceDir).exitCode).toBe(0)
  })

  it('fails on a tie (2 UPHELD / 2 REFUTED, N=4 — strict majority required)', () => {
    writeMarker({ task: '#1943', skeptics: 4, findings: ['f1'] })
    writeSkeptic('s1.json', skepticEnvelope([{ target: 'f1', verdict: 'UPHELD' }]))
    writeSkeptic('s2.json', skepticEnvelope([{ target: 'f1', verdict: 'UPHELD' }]))
    writeSkeptic('s3.json', skepticEnvelope([{ target: 'f1', verdict: 'REFUTED' }]))
    writeSkeptic('s4.json', skepticEnvelope([{ target: 'f1', verdict: 'REFUTED' }]))
    expect(run(evidenceDir).exitCode).toBe(1)
  })

  it('adjudicates multiple findings independently', () => {
    writeMarker({ task: '#1943', skeptics: 3, findings: ['f1', 'f2'] })
    // f1 survives 3-UPHELD
    writeSkeptic(
      's1.json',
      skepticEnvelope([
        { target: 'f1', verdict: 'UPHELD' },
        { target: 'f2', verdict: 'REFUTED' },
      ]),
    )
    writeSkeptic(
      's2.json',
      skepticEnvelope([
        { target: 'f1', verdict: 'UPHELD' },
        { target: 'f2', verdict: 'REFUTED' },
      ]),
    )
    writeSkeptic(
      's3.json',
      skepticEnvelope([
        { target: 'f1', verdict: 'UPHELD' },
        { target: 'f2', verdict: 'UPHELD' },
      ]),
    )
    // f2: 1 UPHELD / 2 REFUTED → FAIL
    const r = run(evidenceDir)
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toMatch(/f2.*majority-refuted/i)
  })
})
