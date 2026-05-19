// SPDX-License-Identifier: Apache-2.0
// TDD guard for #911 — sync-action-pins comment-drift detection.
// Ensures that trailing `# vX.Y.Z` comments are treated as part of the pin
// so that comment-only drift (same SHA, different version label) is detected
// and corrected, preventing false-green parity tests after dependabot bumps.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/sync-action-pins.mjs')
const SHA = 'de0fac2e4500dabe0009e67214ff5f5447ce83dd'

function run(dir: string, args: string[] = []): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', cwd: dir })
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function makeDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'sync-action-pins-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function scaffold(
  dir: string,
  { yml, ejs }: { yml: string; ejs: string },
): { ymlPath: string; ejsPath: string } {
  const wfDir = join(dir, '.github', 'workflows')
  const tplDir = join(dir, 'src', 'templates', 'github', 'workflows')
  mkdirSync(wfDir, { recursive: true })
  mkdirSync(tplDir, { recursive: true })
  const ymlPath = join(wfDir, 'ci.yml')
  const ejsPath = join(tplDir, 'ci.yml.ejs')
  writeFileSync(ymlPath, yml)
  writeFileSync(ejsPath, ejs)
  return { ymlPath, ejsPath }
}

describe('sync-action-pins.mjs (#911 — comment-drift detection)', () => {
  it('reports in-sync when SHA and comment both match', () => {
    const { dir, cleanup } = makeDir()
    try {
      const content = `steps:\n  - uses: actions/checkout@${SHA} # v6.0.2\n`
      scaffold(dir, { yml: content, ejs: content })
      const result = run(dir, ['--check'])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('in sync')
    } finally {
      cleanup()
    }
  })

  it('--check detects comment-only drift (same SHA, different label) and exits 1', () => {
    const { dir, cleanup } = makeDir()
    try {
      const yml = `steps:\n  - uses: actions/checkout@${SHA} # v6.0.2\n`
      const ejs = `steps:\n  - uses: actions/checkout@${SHA} # v4.2.2\n`
      scaffold(dir, { yml, ejs })
      const result = run(dir, ['--check'])
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('DRIFT')
      expect(result.stderr).toContain('ci.yml')
    } finally {
      cleanup()
    }
  })

  it('default mode (write) fixes comment-only drift in EJS', () => {
    const { dir, cleanup } = makeDir()
    try {
      const yml = `steps:\n  - uses: actions/checkout@${SHA} # v6.0.2\n`
      const ejs = `steps:\n  - uses: actions/checkout@${SHA} # v4.2.2\n`
      const { ejsPath } = scaffold(dir, { yml, ejs })
      const result = run(dir)
      expect(result.status).toBe(0)
      const fixed = readFileSync(ejsPath, 'utf-8')
      expect(fixed).toContain(`@${SHA} # v6.0.2`)
      expect(fixed).not.toContain('# v4.2.2')
    } finally {
      cleanup()
    }
  })

  it('--check detects SHA drift (different SHA) and exits 1', () => {
    const { dir, cleanup } = makeDir()
    try {
      const oldSha = '11bd71901bbe5b1630ceea73d27597364c9af683'
      const yml = `steps:\n  - uses: actions/checkout@${SHA} # v6.0.2\n`
      const ejs = `steps:\n  - uses: actions/checkout@${oldSha} # v4.2.2\n`
      scaffold(dir, { yml, ejs })
      const result = run(dir, ['--check'])
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('DRIFT')
    } finally {
      cleanup()
    }
  })

  it('default mode fixes SHA + comment together when both differ', () => {
    const { dir, cleanup } = makeDir()
    try {
      const oldSha = '11bd71901bbe5b1630ceea73d27597364c9af683'
      const yml = `steps:\n  - uses: actions/checkout@${SHA} # v6.0.2\n`
      const ejs = `steps:\n  - uses: actions/checkout@${oldSha} # v4.2.2\n`
      const { ejsPath } = scaffold(dir, { yml, ejs })
      run(dir)
      const fixed = readFileSync(ejsPath, 'utf-8')
      expect(fixed).toBe(yml)
    } finally {
      cleanup()
    }
  })

  it('exits 0 and reports in-sync when no yml/EJS pairs exist', () => {
    const { dir, cleanup } = makeDir()
    try {
      const result = run(dir, ['--check'])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('no yml')
    } finally {
      cleanup()
    }
  })

  it('--reverse detects comment-only drift in yml and fixes it from EJS', () => {
    const { dir, cleanup } = makeDir()
    try {
      const yml = `steps:\n  - uses: actions/checkout@${SHA} # v4.2.2\n`
      const ejs = `steps:\n  - uses: actions/checkout@${SHA} # v6.0.2\n`
      const { ymlPath } = scaffold(dir, { yml, ejs })
      const result = run(dir, ['--reverse'])
      expect(result.status).toBe(0)
      const fixed = readFileSync(ymlPath, 'utf-8')
      expect(fixed).toContain('# v6.0.2')
      expect(fixed).not.toContain('# v4.2.2')
    } finally {
      cleanup()
    }
  })
})
