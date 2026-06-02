import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'

const SCRIPT = resolve('scripts/check-drift.mjs')

function run(manifestPath: string, dir: string) {
  const r = spawnSync('node', [SCRIPT, '--manifest', manifestPath, '--dir', dir], {
    encoding: 'utf-8',
  })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function makeDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'drift-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-drift.mjs (generated file drift detection, INV-89)', () => {
  it('exits 0 when all files match their manifest hashes', () => {
    const { dir, cleanup } = makeDir()
    try {
      const content = 'generated content\n'
      writeFileSync(join(dir, 'gen.txt'), content)
      const manifest = join(dir, 'drift-manifest.json')
      writeFileSync(manifest, JSON.stringify([{ path: 'gen.txt', hash: sha256(content) }]))
      expect(run(manifest, dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a generated file has drifted from its manifest hash', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'gen.txt'), 'actual content\n')
      const manifest = join(dir, 'drift-manifest.json')
      writeFileSync(manifest, JSON.stringify([{ path: 'gen.txt', hash: 'deadbeef' }]))
      const result = run(manifest, dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('drift')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a manifest-referenced file is missing', () => {
    const { dir, cleanup } = makeDir()
    try {
      const manifest = join(dir, 'drift-manifest.json')
      writeFileSync(manifest, JSON.stringify([{ path: 'missing.txt', hash: 'abc123' }]))
      const result = run(manifest, dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('missing')
    } finally {
      cleanup()
    }
  })

  it('exits 0 (skip) when manifest file does not exist', () => {
    const { dir, cleanup } = makeDir()
    try {
      const result = run(join(dir, 'nonexistent.json'), dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('SKIP')
    } finally {
      cleanup()
    }
  })
})
