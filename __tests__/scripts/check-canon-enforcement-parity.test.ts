import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-canon-enforcement-parity.mjs')

function makeRoot(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'canon-parity-test-'))
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  mkdirSync(join(dir, '.claude/hooks'), { recursive: true })
  mkdirSync(join(dir, '__tests__/somewhere'), { recursive: true })
  writeFileSync(join(dir, 'scripts/check-all.mjs'), '// gate with no calls')
  writeFileSync(join(dir, '.claude/settings.json'), '{}')
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function run(root: string, canonBody: string, extraArgs: string[] = []) {
  writeFileSync(join(root, 'CANON.md'), canonBody)
  const r = spawnSync(
    'node',
    [SCRIPT, `--root=${root}`, `--canon=${join(root, 'CANON.md')}`, ...extraArgs],
    { encoding: 'utf-8' },
  )
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

describe('check-canon-enforcement-parity.mjs (B1)', () => {
  it('[RED] exits 1 on a CANON entry that is prose with no gate and no promotion date', () => {
    const { dir, cleanup } = makeRoot()
    try {
      const canon = `## CANON-01 — Made up rule

**Rule:** Something.

**Why:** Reasons.

**Enforcement:** Prose — checked at PR review.

**Source issues:** #1
`
      const result = run(dir, canon)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('CANON-01')
      expect(result.stdout).toContain('PROSE-FOREVER')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when Enforcement cites a script that exists and is wired in check-all.mjs', () => {
    const { dir, cleanup } = makeRoot()
    try {
      writeFileSync(join(dir, 'scripts/check-foo.mjs'), '// noop')
      writeFileSync(
        join(dir, 'scripts/check-all.mjs'),
        'runCheck("foo", [\'scripts/check-foo.mjs\'])',
      )
      const canon = `## CANON-02 — Wired rule

**Enforcement:** \`scripts/check-foo.mjs\` (L1 gate).
`
      expect(run(dir, canon).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when Enforcement cites a script that exists but is NOT wired in check-all.mjs [fiction]', () => {
    const { dir, cleanup } = makeRoot()
    try {
      writeFileSync(join(dir, 'scripts/check-unwired.mjs'), '// noop')
      const canon = `## CANON-03 — Fiction rule

**Enforcement:** \`scripts/check-unwired.mjs\` (L1 gate).
`
      const result = run(dir, canon)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('CANON-03')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when Enforcement cites an existing test file path', () => {
    const { dir, cleanup } = makeRoot()
    try {
      writeFileSync(join(dir, '__tests__/somewhere/thing.test.ts'), '// noop')
      const canon = `## CANON-04 — Test-backed rule

**Enforcement:** \`__tests__/somewhere/thing.test.ts\` asserts this on every run.
`
      expect(run(dir, canon).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when Enforcement declares a live (future) dated promotion', () => {
    const { dir, cleanup } = makeRoot()
    try {
      const canon = `## CANON-05 — Staged rule

**Enforcement:** Prose — promotion: #123 by 2099-01-01.
`
      expect(run(dir, canon).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('[RED] exits 1 when a dated promotion has expired', () => {
    const { dir, cleanup } = makeRoot()
    try {
      const canon = `## CANON-06 — Expired rule

**Enforcement:** Prose — promotion: #123 by 2020-01-01.
`
      const result = run(dir, canon)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('EXPIRED')
    } finally {
      cleanup()
    }
  })

  it('respects --now override for deterministic date comparison', () => {
    const { dir, cleanup } = makeRoot()
    try {
      const canon = `## CANON-07 — Date-sensitive rule

**Enforcement:** Prose — promotion: #123 by 2026-06-01.
`
      // Before the deadline: staged, passes.
      expect(run(dir, canon, ['--now=2026-05-01']).status).toBe(0)
      // After the deadline: expired, fails.
      expect(run(dir, canon, ['--now=2026-07-01']).status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('exits 2 when CANON.md has no CANON-NN headings', () => {
    const { dir, cleanup } = makeRoot()
    try {
      const result = run(dir, '# Empty doc, no entries\n')
      expect(result.status).toBe(2)
    } finally {
      cleanup()
    }
  })

  it('passes against the real repo CANON.md, check-all.mjs and settings.json', () => {
    const r = spawnSync('node', [SCRIPT], { encoding: 'utf-8', cwd: resolve('.') })
    expect(r.status, r.stdout).toBe(0)
  })
})
