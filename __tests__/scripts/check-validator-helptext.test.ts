// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-validator-helptext.mjs')

function run(dir: string) {
  const r = spawnSync('node', [SCRIPT, '--dir', dir], { encoding: 'utf-8' })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'validator-helptext-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-validator-helptext.mjs (W6 --help coverage)', () => {
  it('exits 0 when all W6 validators in scripts/ have --help support', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'scripts'))
      writeFileSync(
        join(dir, 'scripts', 'check-a.mjs'),
        '#!/usr/bin/env node\n// anti-drift validator family (W6)\nif (process.argv.includes("--help")) process.exit(0)\n',
      )
      writeFileSync(
        join(dir, 'scripts', 'check-b.mjs'),
        '#!/usr/bin/env node\n// anti-drift validator family (W6)\nif (process.argv.includes("--help")) process.exit(0)\n',
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a W6 validator lacks --help support', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'scripts'))
      writeFileSync(
        join(dir, 'scripts', 'check-good.mjs'),
        '#!/usr/bin/env node\n// anti-drift validator family (W6)\nif (process.argv.includes("--help")) process.exit(0)\n',
      )
      writeFileSync(
        join(dir, 'scripts', 'check-bad.mjs'),
        '#!/usr/bin/env node\n// anti-drift validator family (W6)\nprocess.exit(0)\n',
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('check-bad.mjs')
      expect(result.stderr).toContain('FAIL')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when scripts/ directory does not exist', () => {
    const { dir, cleanup } = makeTemp()
    try {
      // do not create scripts/ subdir
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('SKIP')
    } finally {
      cleanup()
    }
  })

  it('skips non-W6 check-*.mjs files', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'scripts'))
      // not marked as W6, so even without --help it should not fail
      writeFileSync(
        join(dir, 'scripts', 'check-nonw6.mjs'),
        '#!/usr/bin/env node\n// some other check\nprocess.exit(0)\n',
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 with empty scripts/ directory (no W6 validators)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'scripts'))
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('all 0 W6 validators')
    } finally {
      cleanup()
    }
  })

  it('ignores files not matching check-*.mjs pattern', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'scripts'))
      writeFileSync(
        join(dir, 'scripts', 'validate-foo.mjs'),
        '// anti-drift validator family (W6)\n',
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('all 0 W6 validators')
    } finally {
      cleanup()
    }
  })

  it('reports multiple missing --help violations', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'scripts'))
      writeFileSync(
        join(dir, 'scripts', 'check-x.mjs'),
        '// anti-drift validator family (W6)\nprocess.exit(0)\n',
      )
      writeFileSync(
        join(dir, 'scripts', 'check-y.mjs'),
        '// anti-drift validator family (W6)\nprocess.exit(0)\n',
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('2')
      expect(result.stderr).toContain('FAIL')
    } finally {
      cleanup()
    }
  })
})
