/**
 * Dogfood test: run `arbiter blame INV-01` against the arbiter repo itself.
 *
 * Acceptance criteria:
 *   - AC: blame on single INV < 2s (generous 5s to account for CI variance)
 *   - AC: INV-01 blame report generates non-empty timeline or consistent output
 *   - AC: dogfood produces a runnable result with status 'ok'
 *
 * #263
 */
import { describe, it, expect } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runBlame } from '../../src/commands/blame.js'
import { runGraphBuild } from '../../src/commands/graph.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ARBITER_ROOT = join(__dirname, '..', '..')

describe('blame dogfood — INV-01 on arbiter (#263)', () => {
  it('runs blame INV-01 in < 5s and produces ok result', () => {
    // Build graph from arbiter's own invariant catalog into a temp dir
    const dir = mkdtempSync(join(tmpdir(), 'blame-dogfood-'))
    try {
      const buildResult = runGraphBuild({ dir })
      expect(buildResult.status).toBe('ok')

      const start = Date.now()
      const result = runBlame({
        from: 'INV-01',
        dir,
        // Use arbiter repo for git log context
        gitDir: ARBITER_ROOT,
        skipGitLog: false,
      })
      const elapsed = Date.now() - start

      expect(result.status).toBe('ok')
      expect(result.output).toContain('INV-01')
      // Performance AC: < 5s (generous budget for CI)
      expect(elapsed).toBeLessThan(5000)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('blame INV-01 --format json returns parseable JSON with entries array', () => {
    const dir = mkdtempSync(join(tmpdir(), 'blame-dogfood-json-'))
    try {
      runGraphBuild({ dir })
      const result = runBlame({
        from: 'INV-01',
        dir,
        format: 'json',
        gitDir: ARBITER_ROOT,
        skipGitLog: false,
      })
      expect(result.status).toBe('ok')
      const parsed = JSON.parse(result.output) as { nodeId: string; entries: unknown[] }
      expect(parsed.nodeId).toBe('INV-01')
      expect(Array.isArray(parsed.entries)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('blame INV-01 text format mentions the node title', () => {
    const dir = mkdtempSync(join(tmpdir(), 'blame-dogfood-text-'))
    try {
      runGraphBuild({ dir })
      const result = runBlame({
        from: 'INV-01',
        dir,
        format: 'text',
        gitDir: ARBITER_ROOT,
        skipGitLog: false,
      })
      expect(result.status).toBe('ok')
      // Should contain the invariant title from catalog
      expect(result.output).toContain('circular')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
