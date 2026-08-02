// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-unwired-guards.mjs')

function run(cwd: string, args: string[] = []) {
  const r = spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf-8',
    cwd,
  })
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'unwired-guards-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-unwired-guards.mjs (INV-89, #2159)', () => {
  it('exits 1 and names the file when a real orphan guard script exists, referenced nowhere', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true })
      writeFileSync(join(dir, 'scripts', 'verify-requirements-matrix.sh'), '#!/bin/sh\necho hi\n')
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('scripts/verify-requirements-matrix.sh')
    } finally {
      cleanup()
    }
  })

  it('exits 0 (GREEN) once the same orphan is referenced by scripts/check-all.mjs', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true })
      writeFileSync(join(dir, 'scripts', 'verify-requirements-matrix.sh'), '#!/bin/sh\necho hi\n')
      writeFileSync(
        join(dir, 'scripts', 'check-all.mjs'),
        "runCheck('requirements matrix', 'sh', ['scripts/verify-requirements-matrix.sh'])\n",
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when the orphan is referenced via run.sh', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true })
      writeFileSync(join(dir, 'scripts', 'verify-requirements-matrix.sh'), '#!/bin/sh\necho hi\n')
      writeFileSync(join(dir, 'run.sh'), '#!/bin/bash\nsh scripts/verify-requirements-matrix.sh\n')
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when the orphan is referenced by another scripts/** file', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true })
      writeFileSync(join(dir, 'scripts', 'check-foo.sh'), '#!/bin/sh\necho hi\n')
      writeFileSync(
        join(dir, 'scripts', 'orchestrator.mjs'),
        "spawnSync('sh', ['scripts/check-foo.sh'])\n",
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 with ALLOWLISTED stdout when the orphan is listed in optional-emissions.json (shared with INV-123)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true })
      writeFileSync(join(dir, 'scripts', 'check-orphan.mjs'), '// orphan\n')
      writeFileSync(
        join(dir, 'scripts', 'optional-emissions.json'),
        JSON.stringify({
          optional: [{ path: 'scripts/check-orphan.mjs', rationale: 'intentional overlay, #0000' }],
        }),
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('ALLOWLISTED')
      expect(result.stdout).toContain('scripts/check-orphan.mjs')
    } finally {
      cleanup()
    }
  })

  it('exits 2 when an optional-emissions.json entry has an empty rationale', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true })
      writeFileSync(
        join(dir, 'scripts', 'optional-emissions.json'),
        JSON.stringify({ optional: [{ path: 'scripts/check-orphan.mjs', rationale: '' }] }),
      )
      const result = run(dir)
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('rationale')
    } finally {
      cleanup()
    }
  })

  it('exits 2 when optional-emissions.json is malformed', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true })
      writeFileSync(join(dir, 'scripts', 'optional-emissions.json'), '{not json')
      const result = run(dir)
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('not valid JSON')
    } finally {
      cleanup()
    }
  })

  it('exits 0 SKIP (vacuous) when there is no scripts/ directory at all', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('SKIP')
    } finally {
      cleanup()
    }
  })

  it('exits 0 with --help', () => {
    const r = spawnSync('node', [SCRIPT, '--help'], { encoding: 'utf-8', cwd: resolve('.') })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('Usage')
  })

  it('finds scripts/qa/check-* orphans (broader glob than check-emission-coherence)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'scripts', 'qa'), { recursive: true })
      writeFileSync(join(dir, 'scripts', 'qa', 'check-something'), '#!/bin/sh\necho hi\n')
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('scripts/qa/check-something')
    } finally {
      cleanup()
    }
  })
})
