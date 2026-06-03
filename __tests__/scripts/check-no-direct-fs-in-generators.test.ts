// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-no-direct-fs-in-generators.mjs')

function runInRepo(cwd: string) {
  const r = spawnSync('node', [SCRIPT], {
    encoding: 'utf-8',
    cwd,
  })
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

describe('check-no-direct-fs-in-generators.mjs (direct fs write-ops ban in generators)', () => {
  it('exits 0 when all generators have clean imports from the real repo', () => {
    const result = runInRepo(resolve('.'))
    expect(result.status).toBe(0)
  })

  it('exits 1 when a non-allowlisted generator imports writeFileSync directly', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'src', 'generators'), { recursive: true })
      writeFileSync(
        join(dir, 'src', 'generators', 'bad.ts'),
        `import { writeFileSync } from 'node:fs'\nexport function gen() { writeFileSync('/tmp/x', 'y') }\n`,
      )
      const result = runInRepo(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('bad.ts')
      expect(result.stderr).toContain('imports write-op from')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a non-allowlisted generator uses default import with fs.writeFileSync call', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'src', 'generators'), { recursive: true })
      writeFileSync(
        join(dir, 'src', 'generators', 'bad.ts'),
        `import fs from 'node:fs'\nexport function gen() { fs.writeFileSync('/tmp/x', 'y') }\n`,
      )
      const result = runInRepo(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('bad.ts')
      expect(result.stderr).toContain('default/namespace import')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a non-allowlisted generator uses namespace import with fs.mkdirSync call', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'src', 'generators'), { recursive: true })
      writeFileSync(
        join(dir, 'src', 'generators', 'bad.ts'),
        `import * as fs from 'node:fs'\nexport function gen() { fs.mkdirSync('/tmp/x') }\n`,
      )
      const result = runInRepo(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('bad.ts')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when a generator imports node:fs but only uses read-only ops', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'src', 'generators'), { recursive: true })
      writeFileSync(
        join(dir, 'src', 'generators', 'clean.ts'),
        `import { readFileSync, existsSync } from 'node:fs'\nexport function gen() { readFileSync('/etc/hosts'); existsSync('/tmp') }\n`,
      )
      const result = runInRepo(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when a generator routes writes through utils/fs.ts', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'src', 'generators'), { recursive: true })
      writeFileSync(
        join(dir, 'src', 'generators', 'good.ts'),
        `import { writeFile } from '../utils/fs.ts'\nexport function gen() { writeFile('/tmp/x', 'y') }\n`,
      )
      const result = runInRepo(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when a generator is in the allowlist (legacy guarded write)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'src', 'generators'), { recursive: true })
      // claude.ts is in the allowlist, so it can import write ops if guarded
      writeFileSync(
        join(dir, 'src', 'generators', 'claude.ts'),
        `import { writeFileSync } from 'node:fs'\nexport function gen() { if (!dryRun) writeFileSync('/tmp/x', 'y') }\n`,
      )
      const result = runInRepo(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when a generator imports node:fs without any write-op names in named import', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'src', 'generators'), { recursive: true })
      writeFileSync(
        join(dir, 'src', 'generators', 'safe.ts'),
        `import { readFileSync, statSync } from 'node:fs'\nexport function gen() { readFileSync('/etc/hosts') }\n`,
      )
      const result = runInRepo(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 with empty generators directory', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'src', 'generators'), { recursive: true })
      const result = runInRepo(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('ignores non-.ts files in generators directory', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'src', 'generators'), { recursive: true })
      writeFileSync(
        join(dir, 'src', 'generators', 'bad.js'),
        `import { writeFileSync } from 'node:fs'\nexport function gen() { writeFileSync('/tmp/x', 'y') }\n`,
      )
      const result = runInRepo(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })
})

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'fs-gen-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}
