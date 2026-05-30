// SPDX-License-Identifier: Apache-2.0
// TDD guard for #1082 — ff-only merge enforcement (INV-101).
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-merge-method.mjs')

function run(
  dir: string,
  env: Record<string, string> = {},
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('node', [SCRIPT], {
    encoding: 'utf-8',
    cwd: dir,
    env: { ...process.env, ...env },
  })
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function makeDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'check-merge-method-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const FF_ONLY_SCRIPT_CONTENT = `
const payload = JSON.stringify({
  allow_merge_commit: true,
  allow_squash_merge: false,
  allow_rebase_merge: false,
  required_linear_history: true,
})
`

// Alias used by some tests
const FF_ONLY_SELF_SCRIPT_CONTENT = FF_ONLY_SCRIPT_CONTENT
const FF_ONLY_TEMPLATE_CONTENT = FF_ONLY_SCRIPT_CONTENT

const MISSING_ALL_FLAGS_SCRIPT = `
const payload = JSON.stringify({
  enforce_admins: false,
})
`

// Isolated: has rebase + linear but NOT squash
const MISSING_SQUASH_SCRIPT = `
const settings = {
  allow_merge_commit: true,
  allow_rebase_merge: false,
  required_linear_history: true,
}
`

// Isolated: has squash + linear but NOT rebase
const MISSING_REBASE_SCRIPT = `
const settings = {
  allow_merge_commit: true,
  allow_squash_merge: false,
  required_linear_history: true,
}
`

// Isolated: has squash + rebase but NOT linear history
const MISSING_LINEAR_SCRIPT = `
const settings = {
  allow_merge_commit: true,
  allow_squash_merge: false,
  allow_rebase_merge: false,
}
`

// Flag present but wrong value (squash=true instead of false)
const WRONG_VALUE_SCRIPT = `
const settings = {
  allow_squash_merge: true,
  allow_rebase_merge: false,
  required_linear_history: true,
}
`

describe('check-merge-method.mjs (#1082, INV-101)', () => {
  it('exits 0 when no arbiter.json (not an arbiter project)', () => {
    const { dir, cleanup } = makeDir()
    try {
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when scripts/apply-branch-protection.mjs missing allow_squash_merge flag', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ collaborationMode: 'peer-review' }))
      mkdirSync(join(dir, 'scripts'))
      // Isolated: has rebase + linear but NOT squash — verifies squash check specifically
      writeFileSync(join(dir, 'scripts', 'apply-branch-protection.mjs'), MISSING_SQUASH_SCRIPT)
      mkdirSync(join(dir, 'src', 'templates', 'scripts'), { recursive: true })
      writeFileSync(
        join(dir, 'src', 'templates', 'scripts', 'apply-branch-protection.mjs.ejs'),
        FF_ONLY_TEMPLATE_CONTENT,
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('[INV-101]')
      expect(result.stderr).toContain('allow_squash_merge')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when scripts/apply-branch-protection.mjs missing allow_rebase_merge flag', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ collaborationMode: 'peer-review' }))
      mkdirSync(join(dir, 'scripts'))
      // Isolated: has squash + linear but NOT rebase — verifies rebase check specifically
      writeFileSync(join(dir, 'scripts', 'apply-branch-protection.mjs'), MISSING_REBASE_SCRIPT)
      mkdirSync(join(dir, 'src', 'templates', 'scripts'), { recursive: true })
      writeFileSync(
        join(dir, 'src', 'templates', 'scripts', 'apply-branch-protection.mjs.ejs'),
        FF_ONLY_TEMPLATE_CONTENT,
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('[INV-101]')
      expect(result.stderr).toContain('allow_rebase_merge')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when scripts/apply-branch-protection.mjs missing required_linear_history flag', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ collaborationMode: 'peer-review' }))
      mkdirSync(join(dir, 'scripts'))
      // Isolated: has squash + rebase but NOT linear history
      writeFileSync(join(dir, 'scripts', 'apply-branch-protection.mjs'), MISSING_LINEAR_SCRIPT)
      mkdirSync(join(dir, 'src', 'templates', 'scripts'), { recursive: true })
      writeFileSync(
        join(dir, 'src', 'templates', 'scripts', 'apply-branch-protection.mjs.ejs'),
        FF_ONLY_TEMPLATE_CONTENT,
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('[INV-101]')
      expect(result.stderr).toContain('required_linear_history')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when flag present with wrong value (allow_squash_merge:true fails value-aware check)', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ collaborationMode: 'peer-review' }))
      mkdirSync(join(dir, 'scripts'))
      writeFileSync(join(dir, 'scripts', 'apply-branch-protection.mjs'), WRONG_VALUE_SCRIPT)
      mkdirSync(join(dir, 'src', 'templates', 'scripts'), { recursive: true })
      writeFileSync(
        join(dir, 'src', 'templates', 'scripts', 'apply-branch-protection.mjs.ejs'),
        FF_ONLY_TEMPLATE_CONTENT,
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('[INV-101]')
      expect(result.stderr).toContain('allow_squash_merge')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when template missing ff-only flags', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ collaborationMode: 'peer-review' }))
      mkdirSync(join(dir, 'scripts'))
      writeFileSync(
        join(dir, 'scripts', 'apply-branch-protection.mjs'),
        FF_ONLY_SELF_SCRIPT_CONTENT,
      )
      mkdirSync(join(dir, 'src', 'templates', 'scripts'), { recursive: true })
      writeFileSync(
        join(dir, 'src', 'templates', 'scripts', 'apply-branch-protection.mjs.ejs'),
        MISSING_ALL_FLAGS_SCRIPT,
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('[INV-101]')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when both scripts have all required ff-only flags', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ collaborationMode: 'peer-review' }))
      mkdirSync(join(dir, 'scripts'))
      writeFileSync(
        join(dir, 'scripts', 'apply-branch-protection.mjs'),
        FF_ONLY_SELF_SCRIPT_CONTENT,
      )
      mkdirSync(join(dir, 'src', 'templates', 'scripts'), { recursive: true })
      writeFileSync(
        join(dir, 'src', 'templates', 'scripts', 'apply-branch-protection.mjs.ejs'),
        FF_ONLY_TEMPLATE_CONTENT,
      )
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when scripts directory absent (generated project without apply script)', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ collaborationMode: 'trunk-solo' }))
      // no scripts dir at all
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('script source has CATALOG marker block (INV-94 compliance)', () => {
    const source = readFileSync(SCRIPT, 'utf-8')
    const catalogLines = source.split('\n').filter((l) => l.startsWith('// CATALOG:'))
    expect(catalogLines.length).toBeGreaterThanOrEqual(3)
  })

  it('stderr prefix is [INV-101] on all failure messages', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ collaborationMode: 'peer-review' }))
      mkdirSync(join(dir, 'scripts'))
      writeFileSync(join(dir, 'scripts', 'apply-branch-protection.mjs'), MISSING_ALL_FLAGS_SCRIPT)
      mkdirSync(join(dir, 'src', 'templates', 'scripts'), { recursive: true })
      writeFileSync(
        join(dir, 'src', 'templates', 'scripts', 'apply-branch-protection.mjs.ejs'),
        FF_ONLY_TEMPLATE_CONTENT,
      )
      const result = run(dir)
      for (const line of result.stderr.split('\n').filter(Boolean)) {
        if (!line.startsWith('[INV-101]')) {
          // allow non-prefixed blank lines or system messages
          expect(line).toMatch(/^\s*$|^node:/)
        }
      }
    } finally {
      cleanup()
    }
  })
})
