// SPDX-License-Identifier: Apache-2.0
// Fixture-isolation guard (#2181): fixture and smoke outputs must never contaminate real evidence roots.
// It scans scalar JSON values and keys precisely, avoiding false positives in real text evidence blobs.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-fixture-isolation.mjs')

function run(dir: string, args: string[] = []): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [SCRIPT, '--dir', dir, ...args], { encoding: 'utf-8' })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function runDefault(): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [SCRIPT], { encoding: 'utf-8' })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function makeRepo(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'fixture-isolation-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function writeFixture(dir: string, relativePath: string, contents: string): void {
  const path = join(dir, relativePath)
  mkdirSync(resolve(path, '..'), { recursive: true })
  writeFileSync(path, contents)
}

describe('check-fixture-isolation (anti-fake-green, #2181)', () => {
  it('--help exits 0', () => {
    const { dir, cleanup } = makeRepo()
    try {
      const r = run(dir, ['--help'])
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('Usage')
    } finally {
      cleanup()
    }
  })

  it('NO-DATA when no evidence roots exist → PASS', () => {
    const { dir, cleanup } = makeRepo()
    try {
      const r = run(dir)
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('fake scalar in .arbiter/evidence → FAIL', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFixture(dir, '.arbiter/evidence/study/results.json', JSON.stringify({ findings: [{ id: 'fake-001', title: 'leaked' }] }))
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('fake-001')
      expect(r.stderr).toContain('findings')
    } finally {
      cleanup()
    }
  })

  it('STUDY_FAKE scalar → FAIL', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFixture(dir, '.arbiter/evidence/run/meta.json', JSON.stringify({ harness: 'STUDY_FAKE' }))
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('STUDY_FAKE')
    } finally {
      cleanup()
    }
  })

  it('fake object key → FAIL', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFixture(dir, '.arbiter/evidence/k.json', JSON.stringify({ 'fake-run-1': { ok: true } }))
      const r = run(dir)
      expect(r.status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('.evidence is scanned too → FAIL', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFixture(dir, '.evidence/task-1/bundle.json', JSON.stringify({ id: 'fake-x' }))
      const r = run(dir)
      expect(r.status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('.jsonl documents are scanned → FAIL', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFixture(dir, '.arbiter/evidence/log.jsonl', '{"id":"clean"}\n{"id":"fake-y"}\n')
      const r = run(dir)
      expect(r.status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('realistic multi-line evidence blobs with fake-green words → PASS', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFixture(dir, '.arbiter/evidence/tdd/clean.json', JSON.stringify({
        id: '2181-ac1',
        test_run_log: `The anti-fake-green audit was exercised against a fake-green fixture.
The fake-db transcript is retained here as ordinary multi-line test evidence.`,
      }))
      const r = run(dir)
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('non-JSON files are ignored → PASS', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFixture(dir, '.arbiter/evidence/notes.txt', 'fake-zzz')
      const r = run(dir)
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('unparseable JSON is skipped → PASS', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFixture(dir, '.arbiter/evidence/broken.json', '{not json')
      const r = run(dir)
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('both --dir forms detect the same violation → FAIL', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFixture(dir, '.arbiter/evidence/run/meta.json', JSON.stringify({ id: 'fake-dir' }))
      const separate = run(dir)
      const equalsResult = spawnSync('node', [SCRIPT, `--dir=${dir}`], { encoding: 'utf-8' })
      expect(separate.status ?? 1).toBe(1)
      expect(equalsResult.status ?? 1).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('live evidence corpus is clean → PASS', () => {
    const r = runDefault()
    expect(r.status).toBe(0)
  })
})
