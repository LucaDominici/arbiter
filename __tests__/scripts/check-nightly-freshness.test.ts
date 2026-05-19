// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for scripts/check-nightly-freshness.mjs (INV-93).
 * Validates that the nightly CI ran within the freshness window.
 *
 * Existing Code Survey (CANON-16):
 *   - grep for "nightly|freshness|INV-93" in src/: no existing freshness gate script found.
 *   - Decision: new script — check-nightly-freshness.mjs reads a stamp artifact file.
 *   - Rationale: different concern from check-ci-tiers.mjs (presence) and 09-heartbeat.yml
 *     (runtime GH API check). This is a local gate that reads a stamp file.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const SCRIPT = new URL('../../scripts/check-nightly-freshness.mjs', import.meta.url).pathname

function runScript(
  artifactPath: string,
  maxAgeHours?: number,
): { exitCode: number; stdout: string; stderr: string } {
  const args = [SCRIPT, `--artifact=${artifactPath}`]
  if (maxAgeHours !== undefined) {
    args.push(`--max-age-hours=${maxAgeHours}`)
  }
  const result = spawnSync('node', args, { encoding: 'utf-8', timeout: 10000 })
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

describe('check-nightly-freshness.mjs (INV-93)', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'nightly-freshness-test-'))
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

  it('exits 0 when artifact has a recent timestamp (1 hour ago)', () => {
    const artifact = join(tmpDir, 'last-run.json')
    const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()
    writeFileSync(artifact, JSON.stringify({ timestamp: oneHourAgo }))
    const result = runScript(artifact)
    expect(result.exitCode).toBe(0)
  })

  it('exits 0 when artifact has a timestamp within max-age-hours window', () => {
    const artifact = join(tmpDir, 'last-run.json')
    const tenHoursAgo = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString()
    writeFileSync(artifact, JSON.stringify({ timestamp: tenHoursAgo }))
    const result = runScript(artifact, 26)
    expect(result.exitCode).toBe(0)
  })

  it('exits 0 when artifact timestamp is exactly at the boundary (max-age-hours minus 1 min)', () => {
    const artifact = join(tmpDir, 'last-run.json')
    // 25h 59m ago — within 26h window
    const nearBoundary = new Date(Date.now() - (26 * 60 - 1) * 60 * 1000).toISOString()
    writeFileSync(artifact, JSON.stringify({ timestamp: nearBoundary }))
    const result = runScript(artifact, 26)
    expect(result.exitCode).toBe(0)
  })

  // ─── Stale artifact ───────────────────────────────────────────────────────

  it('exits 1 when artifact timestamp is older than max-age-hours', () => {
    const artifact = join(tmpDir, 'last-run.json')
    const thirtyHoursAgo = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString()
    writeFileSync(artifact, JSON.stringify({ timestamp: thirtyHoursAgo }))
    const result = runScript(artifact, 26)
    expect(result.exitCode).toBe(1)
  })

  it('exits 1 when artifact timestamp is 48 hours old', () => {
    const artifact = join(tmpDir, 'last-run.json')
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    writeFileSync(artifact, JSON.stringify({ timestamp: fortyEightHoursAgo }))
    const result = runScript(artifact, 26)
    expect(result.exitCode).toBe(1)
  })

  it('respects custom max-age-hours parameter (exits 1 when 5h old, max=3)', () => {
    const artifact = join(tmpDir, 'last-run.json')
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString()
    writeFileSync(artifact, JSON.stringify({ timestamp: fiveHoursAgo }))
    const result = runScript(artifact, 3)
    expect(result.exitCode).toBe(1)
  })

  it('respects custom max-age-hours parameter (exits 0 when 5h old, max=6)', () => {
    const artifact = join(tmpDir, 'last-run.json')
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString()
    writeFileSync(artifact, JSON.stringify({ timestamp: fiveHoursAgo }))
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
    const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()
    writeFileSync(artifact, JSON.stringify({ timestamp: oneHourAgo }))
    const result = runScript(artifact)
    expect(result.stdout).toMatch(/OK|fresh|pass/i)
  })

  it('prints FAIL message on stale artifact', () => {
    const artifact = join(tmpDir, 'last-run.json')
    const thirtyHoursAgo = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString()
    writeFileSync(artifact, JSON.stringify({ timestamp: thirtyHoursAgo }))
    const result = runScript(artifact, 26)
    expect(result.stdout).toMatch(/FAIL|stale|fail/i)
  })

  // ─── Help flag ────────────────────────────────────────────────────────────

  it('exits 0 with --help', () => {
    const result = spawnSync('node', [SCRIPT, '--help'], { encoding: 'utf-8', timeout: 5000 })
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/usage/i)
  })
})
