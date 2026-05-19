// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for scripts/check-evidence-bundle.mjs (INV-90).
 * Validates evidence bundles in .evidence/task-NNN/ against schemas/evidence-bundle.schema.json.
 *
 * Existing Code Survey (CANON-16):
 *   - grep for evidence bundle: found check-tdd-evidence.mjs (different concern — TDD evidence per commit)
 *   - Decision: new script — check-evidence-bundle.mjs validates JSON schema compliance
 *   - Rationale: TDD evidence is commit-based; bundle schema is file-based. Different lifecycle.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const SCRIPT = new URL('../../scripts/check-evidence-bundle.mjs', import.meta.url).pathname
const SCHEMA = new URL('../../schemas/evidence-bundle.schema.json', import.meta.url).pathname

function runScript(evidenceDir: string): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync(
    'node',
    [SCRIPT, `--evidence-dir=${evidenceDir}`, `--schema=${SCHEMA}`],
    {
      encoding: 'utf-8',
      timeout: 10000,
    },
  )
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

describe('check-evidence-bundle.mjs', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'evidence-bundle-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  // ─── Vacuous pass (no bundles) ────────────────────────────────────────────

  it('exits 0 when evidence dir does not exist', () => {
    const result = runScript(join(tmpDir, 'nonexistent'))
    expect(result.exitCode).toBe(0)
  })

  it('exits 0 when evidence dir exists but has no task-* subdirectories', () => {
    const evidenceDir = join(tmpDir, '.evidence')
    mkdirSync(evidenceDir)
    const result = runScript(evidenceDir)
    expect(result.exitCode).toBe(0)
  })

  it('exits 0 when task-* directories exist but contain no JSON files', () => {
    const taskDir = join(tmpDir, '.evidence', 'task-#123')
    mkdirSync(taskDir, { recursive: true })
    writeFileSync(join(taskDir, 'notes.txt'), 'no json here')
    const result = runScript(join(tmpDir, '.evidence'))
    expect(result.exitCode).toBe(0)
  })

  // ─── Valid bundle ─────────────────────────────────────────────────────────

  it('exits 0 for a valid minimal evidence bundle', () => {
    const taskDir = join(tmpDir, '.evidence', 'task-#883')
    mkdirSync(taskDir, { recursive: true })
    const bundle = {
      taskId: '#883',
      timestamp: '2026-05-19T10:00:00.000Z',
      gateResult: 'pass',
      redTestPath: '__tests__/scripts/check-evidence-bundle.test.ts',
      greenTestPath: '__tests__/scripts/check-evidence-bundle.test.ts',
      artifacts: [],
    }
    writeFileSync(join(taskDir, 'bundle.json'), JSON.stringify(bundle, null, 2))
    const result = runScript(join(tmpDir, '.evidence'))
    expect(result.exitCode).toBe(0)
  })

  it('exits 0 for a valid bundle with artifacts array', () => {
    const taskDir = join(tmpDir, '.evidence', 'task-#883')
    mkdirSync(taskDir, { recursive: true })
    const bundle = {
      taskId: '#883',
      timestamp: '2026-05-19T10:00:00.000Z',
      gateResult: 'pass',
      redTestPath: '__tests__/scripts/check-evidence-bundle.test.ts',
      greenTestPath: '__tests__/scripts/check-evidence-bundle.test.ts',
      artifacts: [{ name: 'test-output.txt', path: '.evidence/task-#883/test-output.txt' }],
    }
    writeFileSync(join(taskDir, 'bundle.json'), JSON.stringify(bundle, null, 2))
    const result = runScript(join(tmpDir, '.evidence'))
    expect(result.exitCode).toBe(0)
  })

  it('exits 0 for bundle with gateResult=fail (schema allows fail)', () => {
    const taskDir = join(tmpDir, '.evidence', 'task-#883')
    mkdirSync(taskDir, { recursive: true })
    const bundle = {
      taskId: '#883',
      timestamp: '2026-05-19T10:00:00.000Z',
      gateResult: 'fail',
      redTestPath: '__tests__/scripts/check-evidence-bundle.test.ts',
      greenTestPath: '__tests__/scripts/check-evidence-bundle.test.ts',
      artifacts: [],
    }
    writeFileSync(join(taskDir, 'bundle.json'), JSON.stringify(bundle, null, 2))
    const result = runScript(join(tmpDir, '.evidence'))
    expect(result.exitCode).toBe(0)
  })

  // ─── Invalid bundles ──────────────────────────────────────────────────────

  it('exits 1 when a bundle is missing required taskId', () => {
    const taskDir = join(tmpDir, '.evidence', 'task-#883')
    mkdirSync(taskDir, { recursive: true })
    const bundle = {
      timestamp: '2026-05-19T10:00:00.000Z',
      gateResult: 'pass',
      redTestPath: '__tests__/scripts/check-evidence-bundle.test.ts',
      greenTestPath: '__tests__/scripts/check-evidence-bundle.test.ts',
      artifacts: [],
    }
    writeFileSync(join(taskDir, 'bundle.json'), JSON.stringify(bundle, null, 2))
    const result = runScript(join(tmpDir, '.evidence'))
    expect(result.exitCode).toBe(1)
  })

  it('exits 1 when a bundle is missing required timestamp', () => {
    const taskDir = join(tmpDir, '.evidence', 'task-#883')
    mkdirSync(taskDir, { recursive: true })
    const bundle = {
      taskId: '#883',
      gateResult: 'pass',
      redTestPath: '__tests__/scripts/check-evidence-bundle.test.ts',
      greenTestPath: '__tests__/scripts/check-evidence-bundle.test.ts',
      artifacts: [],
    }
    writeFileSync(join(taskDir, 'bundle.json'), JSON.stringify(bundle, null, 2))
    const result = runScript(join(tmpDir, '.evidence'))
    expect(result.exitCode).toBe(1)
  })

  it('exits 1 when gateResult is an invalid enum value', () => {
    const taskDir = join(tmpDir, '.evidence', 'task-#883')
    mkdirSync(taskDir, { recursive: true })
    const bundle = {
      taskId: '#883',
      timestamp: '2026-05-19T10:00:00.000Z',
      gateResult: 'unknown',
      redTestPath: '__tests__/scripts/check-evidence-bundle.test.ts',
      greenTestPath: '__tests__/scripts/check-evidence-bundle.test.ts',
      artifacts: [],
    }
    writeFileSync(join(taskDir, 'bundle.json'), JSON.stringify(bundle, null, 2))
    const result = runScript(join(tmpDir, '.evidence'))
    expect(result.exitCode).toBe(1)
  })

  it('exits 1 when a bundle is not valid JSON', () => {
    const taskDir = join(tmpDir, '.evidence', 'task-#883')
    mkdirSync(taskDir, { recursive: true })
    writeFileSync(join(taskDir, 'bundle.json'), '{ invalid json }')
    const result = runScript(join(tmpDir, '.evidence'))
    expect(result.exitCode).toBe(1)
  })

  it('exits 1 when artifacts entry is missing required name field', () => {
    const taskDir = join(tmpDir, '.evidence', 'task-#883')
    mkdirSync(taskDir, { recursive: true })
    const bundle = {
      taskId: '#883',
      timestamp: '2026-05-19T10:00:00.000Z',
      gateResult: 'pass',
      redTestPath: '__tests__/scripts/check-evidence-bundle.test.ts',
      greenTestPath: '__tests__/scripts/check-evidence-bundle.test.ts',
      artifacts: [{ path: '.evidence/task-#883/test-output.txt' }],
    }
    writeFileSync(join(taskDir, 'bundle.json'), JSON.stringify(bundle, null, 2))
    const result = runScript(join(tmpDir, '.evidence'))
    expect(result.exitCode).toBe(1)
  })

  // ─── Multiple tasks ───────────────────────────────────────────────────────

  it('validates multiple task directories and passes when all are valid', () => {
    for (const taskId of ['#881', '#882', '#883']) {
      const taskDir = join(tmpDir, '.evidence', `task-${taskId}`)
      mkdirSync(taskDir, { recursive: true })
      const bundle = {
        taskId,
        timestamp: '2026-05-19T10:00:00.000Z',
        gateResult: 'pass',
        redTestPath: '__tests__/some.test.ts',
        greenTestPath: '__tests__/some.test.ts',
        artifacts: [],
      }
      writeFileSync(join(taskDir, 'bundle.json'), JSON.stringify(bundle, null, 2))
    }
    const result = runScript(join(tmpDir, '.evidence'))
    expect(result.exitCode).toBe(0)
  })

  it('exits 1 and reports all failures when multiple bundles are invalid', () => {
    for (const taskId of ['#881', '#882']) {
      const taskDir = join(tmpDir, '.evidence', `task-${taskId}`)
      mkdirSync(taskDir, { recursive: true })
      writeFileSync(join(taskDir, 'bundle.json'), JSON.stringify({ incomplete: true }))
    }
    const result = runScript(join(tmpDir, '.evidence'))
    expect(result.exitCode).toBe(1)
  })

  // ─── Output format ────────────────────────────────────────────────────────

  it('prints OK message on success', () => {
    const evidenceDir = join(tmpDir, '.evidence')
    mkdirSync(evidenceDir)
    const result = runScript(evidenceDir)
    expect(result.stdout).toMatch(/OK|pass|0 bundle/i)
  })

  it('prints FAIL message on failure', () => {
    const taskDir = join(tmpDir, '.evidence', 'task-#883')
    mkdirSync(taskDir, { recursive: true })
    writeFileSync(join(taskDir, 'bundle.json'), JSON.stringify({ invalid: true }))
    const result = runScript(join(tmpDir, '.evidence'))
    expect(result.stdout).toMatch(/FAIL|fail|invalid|error/i)
  })
})
