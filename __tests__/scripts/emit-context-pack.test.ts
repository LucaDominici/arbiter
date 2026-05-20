import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const SCRIPT = resolve('scripts/emit-context-pack.mjs')
const REPO_ROOT = resolve('.')

function run(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf-8',
    cwd: REPO_ROOT,
  })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

describe('scripts/emit-context-pack.mjs (#975 — CONTEXT_PACK emitter)', () => {
  it('exits 0 with minimal required args', () => {
    const r = run(['--task-id', '#975', '--track', 'docs'])
    expect(r.status).toBe(0)
    expect(r.stdout.length).toBeGreaterThan(0)
  })

  it('is deterministic: same args → byte-identical stdout', () => {
    const a = run(['--task-id', '#975', '--track', 'docs'])
    const b = run(['--task-id', '#975', '--track', 'docs'])
    expect(a.status).toBe(0)
    expect(b.status).toBe(0)
    expect(a.stdout).toBe(b.stdout)
  })

  it('emits all required schema sections', () => {
    const r = run(['--task-id', '#975', '--track', 'docs'])
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/^# CONTEXT_PACK/m)
    expect(r.stdout).toMatch(/## Header/m)
    expect(r.stdout).toMatch(/## Task Identity/m)
    expect(r.stdout).toMatch(/## INV Set/m)
    expect(r.stdout).toMatch(/## CANON Set/m)
    expect(r.stdout).toMatch(/## Excerpts/m)
    expect(r.stdout).toMatch(/## Footer/m)
    // Footer must include a hex sha256 hash
    expect(r.stdout).toMatch(/hash:\s*sha256:[0-9a-f]{64}/m)
  })

  it('every Excerpts block cites source with file:Lstart-Lend', () => {
    const r = run(['--task-id', '#975', '--track', 'docs'])
    expect(r.status).toBe(0)
    // Each excerpt block opens with `source: <path>:L<n>-L<m>`
    const excerpts = r.stdout.split('## Excerpts')[1] ?? ''
    const sourceLines = excerpts.match(/^source:\s+[^\s]+:L\d+-L\d+$/gm) ?? []
    // Must have at least one excerpt (for the baseline invariants)
    expect(sourceLines.length).toBeGreaterThanOrEqual(1)
    // Every line under Excerpts that starts with "source:" must use the L<n>-L<m> format
    const allSourceCandidates = excerpts.match(/^source:.*$/gm) ?? []
    for (const line of allSourceCandidates) {
      expect(line).toMatch(/^source:\s+[^\s]+:L\d+-L\d+$/)
    }
  })

  it('falls back to baseline INV-01, INV-12, INV-13 when no routing rule matches', () => {
    // Track "meta" has no explicit KNOWLEDGE_MAP rule; emitter must include baseline.
    const r = run(['--task-id', '#975', '--track', 'meta'])
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/^- INV-01\b/m)
    expect(r.stdout).toMatch(/^- INV-12\b/m)
    expect(r.stdout).toMatch(/^- INV-13\b/m)
  })

  it('--out writes file and stdout stays empty', () => {
    const { mkdtempSync, readFileSync, rmSync } = require('node:fs') as typeof import('node:fs')
    const { tmpdir } = require('node:os') as typeof import('node:os')
    const { join } = require('node:path') as typeof import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'ctx-pack-'))
    const out = join(dir, 'pack.md')
    try {
      const r = run(['--task-id', '#975', '--track', 'docs', '--out', out])
      expect(r.status).toBe(0)
      expect(r.stdout).toBe('')
      const written = readFileSync(out, 'utf-8')
      expect(written).toMatch(/^# CONTEXT_PACK/m)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
