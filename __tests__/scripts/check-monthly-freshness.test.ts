// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for scripts/check-monthly-freshness.mjs (INV-82).
 * Validates that the monthly CI ran within the freshness window.
 *
 * Existing Code Survey (CANON-16):
 *   - check-nightly-freshness.mjs exists for INV-93 (nightly, 26h window).
 *   - INV-82 is the monthly analog: 32-day default window, different artifact path.
 *   - Decision: parallel script — same pattern, different defaults.
 *   - Rationale: different cadence (monthly vs nightly), different artifact path,
 *     different freshness bound. Parameterising nightly to cover monthly would
 *     introduce confusing defaults and weaken the INV separation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const SCRIPT = new URL('../../scripts/check-monthly-freshness.mjs', import.meta.url).pathname

function runScript(
  artifactPath: string,
  maxAgeDays?: number,
): { exitCode: number; stdout: string; stderr: string } {
  const args = [SCRIPT, `--artifact=${artifactPath}`]
  if (maxAgeDays !== undefined) {
    args.push(`--max-age-days=${maxAgeDays}`)
  }
  const result = spawnSync('node', args, { encoding: 'utf-8', timeout: 10000 })
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

describe('check-monthly-freshness.mjs (INV-82)', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'monthly-freshness-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  // ─── Vacuous pass (no artifact) ───────────────────────────────────────────

  it('exits 0 when artifact file does not exist', () => {
    const artifact = join(tmpDir, 'nonexistent.json')
    const result = runScript(artifact)
    expect(result.exitCode).toBe(0)
  })

  it('exits 0 when artifact directory does not exist', () => {
    const artifact = join(tmpDir, 'subdir', 'last-run.json')
    const result = runScript(artifact)
    expect(result.exitCode).toBe(0)
  })

  it('prints vacuous pass message when artifact missing', () => {
    const artifact = join(tmpDir, 'nonexistent.json')
    const result = runScript(artifact)
    expect(result.stdout).toMatch(/no artifact|vacuous|OK/i)
  })

  // ─── Fresh artifact ───────────────────────────────────────────────────────

  it('exits 0 when artifact has a recent timestamp (1 day ago)', () => {
    const artifact = join(tmpDir, 'last-run.json')
    const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
    writeFileSync(artifact, JSON.stringify({ timestamp: oneDayAgo }))
    const result = runScript(artifact)
    expect(result.exitCode).toBe(0)
  })

  it('exits 0 when artifact has a timestamp within max-age-days window', () => {
    const artifact = join(tmpDir, 'last-run.json')
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
    writeFileSync(artifact, JSON.stringify({ timestamp: tenDaysAgo }))
    const result = runScript(artifact, 32)
    expect(result.exitCode).toBe(0)
  })

  it('exits 0 when artifact timestamp is exactly at the boundary (max-age-days minus 1 hour)', () => {
    const artifact = join(tmpDir, 'last-run.json')
    // 31d 23h ago — within 32d window
    const nearBoundary = new Date(Date.now() - (32 * 24 * 60 - 60) * 60 * 1000).toISOString()
    writeFileSync(artifact, JSON.stringify({ timestamp: nearBoundary }))
    const result = runScript(artifact, 32)
    expect(result.exitCode).toBe(0)
  })

  // ─── Stale artifact ───────────────────────────────────────────────────────

  it('exits 1 when artifact timestamp is older than max-age-days', () => {
    const artifact = join(tmpDir, 'last-run.json')
    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString()
    writeFileSync(artifact, JSON.stringify({ timestamp: fortyDaysAgo }))
    const result = runScript(artifact, 32)
    expect(result.exitCode).toBe(1)
  })

  it('exits 1 when artifact timestamp is 60 days old', () => {
    const artifact = join(tmpDir, 'last-run.json')
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
    writeFileSync(artifact, JSON.stringify({ timestamp: sixtyDaysAgo }))
    const result = runScript(artifact, 32)
    expect(result.exitCode).toBe(1)
  })

  it('respects custom max-age-days parameter (exits 1 when 5d old, max=3)', () => {
    const artifact = join(tmpDir, 'last-run.json')
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
    writeFileSync(artifact, JSON.stringify({ timestamp: fiveDaysAgo }))
    const result = runScript(artifact, 3)
    expect(result.exitCode).toBe(1)
  })

  it('respects custom max-age-days parameter (exits 0 when 5d old, max=6)', () => {
    const artifact = join(tmpDir, 'last-run.json')
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
    writeFileSync(artifact, JSON.stringify({ timestamp: fiveDaysAgo }))
    const result = runScript(artifact, 6)
    expect(result.exitCode).toBe(0)
  })

  // ─── Invalid artifact ─────────────────────────────────────────────────────

  it('exits 1 when artifact file contains invalid JSON', () => {
    const artifact = join(tmpDir, 'last-run.json')
    writeFileSync(artifact, '{ not valid json }')
    const result = runScript(artifact)
    expect(result.exitCode).toBe(1)
  })

  it('exits 1 when artifact file is missing timestamp field', () => {
    const artifact = join(tmpDir, 'last-run.json')
    writeFileSync(artifact, JSON.stringify({ other: 'field' }))
    const result = runScript(artifact)
    expect(result.exitCode).toBe(1)
  })

  it('exits 1 when timestamp field is not a valid ISO string', () => {
    const artifact = join(tmpDir, 'last-run.json')
    writeFileSync(artifact, JSON.stringify({ timestamp: 'not-a-date' }))
    const result = runScript(artifact)
    expect(result.exitCode).toBe(1)
  })

  // ─── Output format ────────────────────────────────────────────────────────

  it('prints OK message on fresh artifact', () => {
    const artifact = join(tmpDir, 'last-run.json')
    const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
    writeFileSync(artifact, JSON.stringify({ timestamp: oneDayAgo }))
    const result = runScript(artifact)
    expect(result.stdout).toMatch(/OK|fresh|pass/i)
  })

  it('prints FAIL message on stale artifact', () => {
    const artifact = join(tmpDir, 'last-run.json')
    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString()
    writeFileSync(artifact, JSON.stringify({ timestamp: fortyDaysAgo }))
    const result = runScript(artifact, 32)
    expect(result.stdout).toMatch(/FAIL|stale|fail/i)
  })

  // ─── Help flag ────────────────────────────────────────────────────────────

  it('exits 0 with --help', () => {
    const result = spawnSync('node', [SCRIPT, '--help'], { encoding: 'utf-8', timeout: 5000 })
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/usage/i)
  })
})
