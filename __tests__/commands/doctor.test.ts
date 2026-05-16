// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runDoctorRepairState } from '../../src/commands/doctor.js'
import { defaultConfig, saveConfig, saveConfigAndSnapshot } from '../../src/utils/config.js'

describe('runDoctorRepairState (#619)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-doctor-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('exit 2 + no write when arbiter.json missing', () => {
    const result = runDoctorRepairState({ dir, json: true })
    expect(result.exitCode).toBe(2)
    expect(result.repaired).toBe(false)
    expect(existsSync(join(dir, '.arbiter-generated.json'))).toBe(false)
  })

  it('re-derives snapshot from arbiter.json (no prior snapshot)', () => {
    saveConfig(dir, defaultConfig())
    const result = runDoctorRepairState({ dir, json: true })
    expect(result.exitCode).toBe(0)
    expect(result.repaired).toBe(true)
    const snap = JSON.parse(readFileSync(join(dir, '.arbiter-generated.json'), 'utf-8')) as Record<
      string,
      unknown
    >
    expect(snap.$schemaVersion).toBe(1)
    expect(typeof snap['.checksum']).toBe('string')
  })

  it('replaces tampered snapshot with re-derived envelope', () => {
    saveConfigAndSnapshot(dir, defaultConfig())
    writeFileSync(join(dir, '.arbiter-generated.json'), '{"broken":true}', 'utf-8')
    const result = runDoctorRepairState({ dir, json: true })
    expect(result.exitCode).toBe(0)
    const snap = JSON.parse(readFileSync(join(dir, '.arbiter-generated.json'), 'utf-8')) as Record<
      string,
      unknown
    >
    expect(snap.$schemaVersion).toBe(1)
  })

  it('does NOT modify arbiter.json', () => {
    saveConfig(dir, defaultConfig())
    const before = readFileSync(join(dir, 'arbiter.json'), 'utf-8')
    runDoctorRepairState({ dir, json: true })
    const after = readFileSync(join(dir, 'arbiter.json'), 'utf-8')
    expect(after).toBe(before)
  })
})
