// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-tier-coverage.mjs')

function run(gatePath: string) {
  const r = spawnSync('node', [SCRIPT, '--gate', gatePath], { encoding: 'utf-8' })
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'tier-coverage-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-tier-coverage.mjs (INV-89 / W6 anti-drift)', () => {
  it('exits 0 when all required tiers are present in gate file', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const gatePath = join(dir, 'check-all.mjs')
      const gateContent = `
// Mock gate file with all required tiers
runCheck('build-kit', ...)
runCheck('typecheck', ...)
runCheck('lint', ...)
runCheck('unit tests', ...)
runCheck('spdx headers', ...)
runCheck('orphan TODOs', ...)
runCheck('ci tiers', ...)
`.trim()
      writeFileSync(gatePath, gateContent)
      expect(run(gatePath).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a required tier is missing from gate file', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const gatePath = join(dir, 'check-all.mjs')
      const gateContent = `
// Mock gate missing the CI-tier check
runCheck('build-kit', ...)
runCheck('typecheck', ...)
runCheck('lint', ...)
runCheck('unit tests', ...)
runCheck('spdx headers', ...)
runCheck('orphan TODOs', ...)
`.trim()
      writeFileSync(gatePath, gateContent)
      const result = run(gatePath)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('FAIL')
      expect(result.stderr).toContain('ci tiers')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when multiple required tiers are missing from gate file', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const gatePath = join(dir, 'check-all.mjs')
      const gateContent = `
// Minimal gate missing several tiers
runCheck('lint', ...)
runCheck('unit tests', ...)
`.trim()
      writeFileSync(gatePath, gateContent)
      const result = run(gatePath)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('FAIL')
      // Should report multiple violations
      expect(result.stderr).toContain('missing from gate')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when gate file uses pattern variations that match required tiers', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const gatePath = join(dir, 'check-all.mjs')
      // Use the actual patterns from REQUIRED_TIERS:
      // /build-kit/, /typecheck/, /'lint'/, /unit tests/, /spdx headers/, /orphan TODOs/, /ci tiers/
      const gateContent = `
runCheck('build-kit', ...)
runCheck('typecheck', ...)
runCheck('lint', ...)  // matches /'lint'/
runCheck('unit tests', ...)
runCheck('spdx headers', ...)
runCheck('orphan TODOs', ...)
runCheck('ci tiers (INV-73)', ...)  // matches /ci tiers/
`.trim()
      writeFileSync(gatePath, gateContent)
      expect(run(gatePath).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when --help is provided (no gate file required)', () => {
    const r = spawnSync('node', [SCRIPT, '--help'], { encoding: 'utf-8' })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('Usage')
  })

  it('passes against the real check-all.mjs in the repo', () => {
    const result = run(resolve('scripts/check-all.mjs'))
    expect(result.status).toBe(0)
  })
})
