// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-hardness-inventory.mjs')

function run(manifest: string, hooksDir: string, codexTemplate: string) {
  const r = spawnSync(
    'node',
    [SCRIPT, '--manifest', manifest, '--hooks-dir', hooksDir, '--codex-template', codexTemplate],
    { encoding: 'utf-8', cwd: resolve('.') },
  )
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

interface Fixture {
  dir: string
  manifest: string
  hooksDir: string
  codexTemplate: string
  cleanup: () => void
}

// Build an isolated fixture: a hooks dir, a manifest path, and a (default-absent)
// codex template path. The caller writes the manifest + hook files it needs.
function makeFixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'hardness-inv-'))
  const hooksDir = join(dir, 'hooks')
  mkdirSync(hooksDir, { recursive: true })
  return {
    dir,
    manifest: join(dir, 'manifest.json'),
    hooksDir,
    codexTemplate: join(dir, 'codex-absent.toml'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

function writeManifest(path: string, hooks: unknown[]): void {
  writeFileSync(path, JSON.stringify({ version: 1, hooks }))
}

describe('check-hardness-inventory.mjs (hook hardness manifest gate)', () => {
  it('exits 0 on a clean manifest with no drift, no HARD hooks, no codex', () => {
    const f = makeFixture()
    try {
      writeFileSync(join(f.hooksDir, 'sample.mjs'), 'process.exit(0)\n')
      writeManifest(f.manifest, [{ file: 'sample.mjs', classification: 'SOFT', spawnable: false }])
      const r = run(f.manifest, f.hooksDir, f.codexTemplate)
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('HARDNESS INVENTORY PASSED')
    } finally {
      f.cleanup()
    }
  })

  it('exits 1 when the manifest file is missing', () => {
    const f = makeFixture()
    try {
      const r = run(join(f.dir, 'does-not-exist.json'), f.hooksDir, f.codexTemplate)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('manifest not found')
    } finally {
      f.cleanup()
    }
  })

  it('exits 1 on drift: a hook file with no manifest entry', () => {
    const f = makeFixture()
    try {
      writeFileSync(join(f.hooksDir, 'sample.mjs'), 'process.exit(0)\n')
      writeFileSync(join(f.hooksDir, 'orphan.mjs'), 'process.exit(0)\n')
      writeManifest(f.manifest, [{ file: 'sample.mjs', classification: 'SOFT', spawnable: false }])
      const r = run(f.manifest, f.hooksDir, f.codexTemplate)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('orphan.mjs')
      expect(r.stdout).toContain('no manifest entry')
    } finally {
      f.cleanup()
    }
  })

  it('exits 1 on drift: a manifest entry pointing to a non-existent file', () => {
    const f = makeFixture()
    try {
      writeFileSync(join(f.hooksDir, 'sample.mjs'), 'process.exit(0)\n')
      writeManifest(f.manifest, [
        { file: 'sample.mjs', classification: 'SOFT', spawnable: false },
        { file: 'ghost.mjs', classification: 'SOFT', spawnable: false },
      ])
      const r = run(f.manifest, f.hooksDir, f.codexTemplate)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('ghost.mjs')
      expect(r.stdout).toContain('non-existent file')
    } finally {
      f.cleanup()
    }
  })

  it('exits 1 when a HARD+spawnable hook has no fixture defined', () => {
    const f = makeFixture()
    try {
      writeFileSync(join(f.hooksDir, 'sample.mjs'), 'process.exit(0)\n')
      writeManifest(f.manifest, [
        { file: 'sample.mjs', classification: 'HARD', spawnable: true, expectedExitCode: 1 },
      ])
      const r = run(f.manifest, f.hooksDir, f.codexTemplate)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('no fixture defined')
    } finally {
      f.cleanup()
    }
  })

  it('exits 0 when a HARD+spawnable hook empirically exits its declared code on the fixture', () => {
    const f = makeFixture()
    try {
      // Hook exits 1 iff the fixture env var is set — matches expectedExitCode.
      writeFileSync(
        join(f.hooksDir, 'sample.mjs'),
        'process.exit(process.env.MY_VIOLATION ? 1 : 0)\n',
      )
      writeManifest(f.manifest, [
        {
          file: 'sample.mjs',
          classification: 'HARD',
          spawnable: true,
          expectedExitCode: 1,
          fixture: { type: 'env-only', env: { MY_VIOLATION: '1' } },
        },
      ])
      const r = run(f.manifest, f.hooksDir, f.codexTemplate)
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('exits 1 on violation fixture')
    } finally {
      f.cleanup()
    }
  })

  it('exits 1 when a HARD hook does not exit its declared code (ceremony regression)', () => {
    const f = makeFixture()
    try {
      // Hook always exits 0, but manifest declares it HARD with expectedExitCode 1.
      writeFileSync(join(f.hooksDir, 'sample.mjs'), 'process.exit(0)\n')
      writeManifest(f.manifest, [
        {
          file: 'sample.mjs',
          classification: 'HARD',
          spawnable: true,
          expectedExitCode: 1,
          fixture: { type: 'env-only', env: { MY_VIOLATION: '1' } },
        },
      ])
      const r = run(f.manifest, f.hooksDir, f.codexTemplate)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('ceremony regression')
    } finally {
      f.cleanup()
    }
  })

  it('exits 1 on codex parity failure when the codex template is absent', () => {
    const f = makeFixture()
    try {
      writeFileSync(join(f.hooksDir, 'sample.mjs'), 'process.exit(0)\n')
      writeManifest(f.manifest, [
        { file: 'sample.mjs', classification: 'SOFT', spawnable: false, tools: ['codex'] },
      ])
      const r = run(f.manifest, f.hooksDir, f.codexTemplate)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('Codex config template not found')
    } finally {
      f.cleanup()
    }
  })

  it('exits 0 on codex parity when the template wires the declared hook', () => {
    const f = makeFixture()
    try {
      writeFileSync(join(f.hooksDir, 'sample.mjs'), 'process.exit(0)\n')
      writeFileSync(f.codexTemplate, 'wires sample.mjs adapter\n')
      writeManifest(f.manifest, [
        { file: 'sample.mjs', classification: 'SOFT', spawnable: false, tools: ['codex'] },
      ])
      const r = run(f.manifest, f.hooksDir, f.codexTemplate)
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('Codex config template wires adapter for: sample.mjs')
    } finally {
      f.cleanup()
    }
  })

  it('passes against the real repo manifest, hooks dir, and codex template', () => {
    const r = spawnSync('node', [SCRIPT], { encoding: 'utf-8', cwd: resolve('.') })
    expect(r.status ?? 1).toBe(0)
  })
})
