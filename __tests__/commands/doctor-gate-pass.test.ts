// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runDoctorHealth } from '../../src/commands/doctor.js'

// Tests for doctor gate-pass.jsonl display (ADR-053)
// doctor health must include a gate-pass check showing last 5 entries

let originalCwd: string

beforeEach(() => {
  originalCwd = process.cwd()
})

afterEach(() => {
  process.chdir(originalCwd)
})

describe('doctor health — gate-pass.jsonl section', () => {
  it('returns a gate-pass check when gate-pass.jsonl exists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-doctor-gp-'))
    try {
      mkdirSync(join(dir, '.arbiter'), { recursive: true })
      const entries = [
        { sha: 'aaa111', level: 'L2', checks: [], signedAt: '2026-01-01T00:00:00Z' },
        { sha: 'bbb222', level: 'L2', checks: [], signedAt: '2026-01-02T00:00:00Z' },
        { sha: 'ccc333', level: 'L2', checks: [], signedAt: '2026-01-03T00:00:00Z' },
        { sha: 'ddd444', level: 'L2', checks: [], signedAt: '2026-01-04T00:00:00Z' },
        { sha: 'eee555', level: 'L2', checks: [], signedAt: '2026-01-05T00:00:00Z' },
        { sha: 'fff666', level: 'L2', checks: [], signedAt: '2026-01-06T00:00:00Z' },
      ]
      writeFileSync(
        join(dir, '.arbiter', 'gate-pass.jsonl'),
        entries.map((e) => JSON.stringify(e)).join('\n') + '\n',
      )

      process.chdir(dir)
      const result = await runDoctorHealth({ dir })

      const gatePassCheck = result.checks.find((c) => c.id === 'gate-pass-log')
      expect(gatePassCheck).toBeDefined()
      expect(gatePassCheck?.status).toBe('PASS')
      // Shows last entries — detail should mention recent SHAs
      expect(gatePassCheck?.detail).toContain('fff666')
      expect(gatePassCheck?.detail).toContain('eee555')
    } finally {
      process.chdir(originalCwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns gate-pass check as WARN when no gate-pass.jsonl exists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-doctor-nogp-'))
    try {
      process.chdir(dir)
      const result = await runDoctorHealth({ dir })

      const gatePassCheck = result.checks.find((c) => c.id === 'gate-pass-log')
      expect(gatePassCheck).toBeDefined()
      expect(gatePassCheck?.status).toBe('WARN')
    } finally {
      process.chdir(originalCwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
