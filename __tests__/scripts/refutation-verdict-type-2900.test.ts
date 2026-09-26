// SPDX-License-Identifier: Apache-2.0
/**
 * Regression test for #2900: scripts/check-refutation-verdicts.mjs coerces a non-string
 * skeptic verdict (e.g. `"verdict": ["UPHELD"]`) via `String(r['verdict'])` in `envelopeVerdict`,
 * so `["UPHELD"]` (single-element array) stringifies to `"UPHELD"` and is counted toward quorum.
 * Regression from #2884 (closes #2860). At base ffc50498 the same fixture exits 1.
 *
 * AC-1: a verdict that is not one of the allowed strings (array, number, object) is rejected,
 * not coerced, and does not count toward the quorum. AC-2: this test pins it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const SCRIPT = new URL('../../scripts/check-refutation-verdicts.mjs', import.meta.url).pathname

let tmpDirForRun = ''

function run(evidenceDir: string): { exitCode: number; stdout: string; stderr: string } {
  const r = spawnSync(
    'node',
    [SCRIPT, '--evidence-dir', evidenceDir, '--repo-root', tmpDirForRun],
    {
      encoding: 'utf-8',
      timeout: 10000,
    },
  )
  return { exitCode: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

describe('check-refutation-verdicts.mjs — #2900 non-string verdict', () => {
  let tmpDir: string
  let evidenceDir: string
  let taskDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'refutation-2900-'))
    tmpDirForRun = tmpDir
    evidenceDir = join(tmpDir, '.arbiter', 'evidence', 'agent-returns')
    taskDir = join(evidenceDir, '_300')
    mkdirSync(taskDir, { recursive: true })
    writeFileSync(
      join(taskDir, 'refutation-required.json'),
      JSON.stringify({ task: '#300', skeptics: 3, findings: ['F-300'] }),
    )
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function writeSkeptic(name: string, verdict: unknown) {
    writeFileSync(
      join(taskDir, name),
      JSON.stringify({
        role: 'skeptic',
        agent: name,
        refutations: [{ target: 'F-300', verdict }],
      }),
    )
  }

  it('AC-1: array verdict x3 is rejected, not coerced — quorum unmet, exit 1', () => {
    for (let i = 1; i <= 3; i++) writeSkeptic(`skeptic-${i}.json`, ['UPHELD'])
    const r = run(evidenceDir)
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toMatch(/F-300/)
    expect(r.stdout).toMatch(/0 skeptic verdict\(s\), need >= 3/)
  })

  it('AC-1: number verdict is rejected — quorum unmet, exit 1', () => {
    for (let i = 1; i <= 3; i++) writeSkeptic(`skeptic-${i}.json`, 1)
    const r = run(evidenceDir)
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toMatch(/0 skeptic verdict\(s\), need >= 3/)
  })

  it('AC-1: object verdict is rejected — quorum unmet, exit 1', () => {
    for (let i = 1; i <= 3; i++) writeSkeptic(`skeptic-${i}.json`, { UPHELD: true })
    const r = run(evidenceDir)
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toMatch(/0 skeptic verdict\(s\), need >= 3/)
  })

  it('control: 3 valid string "UPHELD" envelopes still pass, exit 0', () => {
    for (let i = 1; i <= 3; i++) writeSkeptic(`skeptic-${i}.json`, 'UPHELD')
    const r = run(evidenceDir)
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toMatch(/OK/)
  })
})
