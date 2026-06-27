// SPDX-License-Identifier: Apache-2.0
// TDD guard for #1557 — runtime-dependency exact-pin self-check.
// arbiter SHA-pins Actions and digest-pins consumer containers; its OWN published
// runtime `dependencies` must be exact-pinned too (npm strips package-lock from
// published tarballs, so a caret floats to the newest minor at consumer install).
// A non-exact runtime dependency fails the gate (exit 1); exact pins exit 0.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-runtime-dep-pins.mjs')

function run(dir: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('node', [SCRIPT], { encoding: 'utf-8', cwd: dir })
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function makeDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'check-runtime-dep-pins-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function writePkg(dir: string, pkg: unknown): void {
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2))
}

describe('check-runtime-dep-pins.mjs (#1557)', () => {
  it('passes when every runtime dependency is exact-pinned', () => {
    const { dir, cleanup } = makeDir()
    try {
      writePkg(dir, { dependencies: { ejs: '6.0.1', zod: '4.4.3' } })
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('all runtime dependencies are exact-pinned')
    } finally {
      cleanup()
    }
  })

  it('rejects a caret-ranged runtime dependency (exit 1)', () => {
    const { dir, cleanup } = makeDir()
    try {
      writePkg(dir, { dependencies: { ejs: '^6.0.1', zod: '4.4.3' } })
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('non-exact runtime dependency')
      expect(result.stderr).toContain('ejs@^6.0.1')
      expect(result.stderr).not.toContain('zod')
    } finally {
      cleanup()
    }
  })

  it('rejects tilde, hyphen-range, wildcard and dist-tag specs', () => {
    for (const spec of ['~6.0.1', '6.0.0 - 6.9.0', '6.x', '*', 'latest']) {
      const { dir, cleanup } = makeDir()
      try {
        writePkg(dir, { dependencies: { ejs: spec } })
        const result = run(dir)
        expect(result.status, `spec ${spec} should fail`).toBe(1)
        expect(result.stderr).toContain('ejs@')
      } finally {
        cleanup()
      }
    }
  })

  it('accepts an exact prerelease/build-metadata version', () => {
    const { dir, cleanup } = makeDir()
    try {
      writePkg(dir, { dependencies: { foo: '1.2.3-rc.1', bar: '1.2.3+build.5' } })
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('ignores devDependencies and overrides (only dependencies are gated)', () => {
    const { dir, cleanup } = makeDir()
    try {
      writePkg(dir, {
        dependencies: { exceljs: '4.4.0' },
        devDependencies: { typescript: '^6.0.3', madge: '^8.0.0' },
        overrides: { uuid: '^11.1.1', madge: { typescript: '$typescript' } },
      })
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('passes when there is no dependencies field', () => {
    const { dir, cleanup } = makeDir()
    try {
      writePkg(dir, { name: 'x', version: '1.0.0' })
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('fails closed when package.json is missing or unreadable', () => {
    const { dir, cleanup } = makeDir()
    try {
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('cannot read')
    } finally {
      cleanup()
    }
  })

  // Red→green guard: arbiter's OWN package.json must pass. Before #1557 its runtime
  // deps were caret-ranged, so this exited 1; after exact-pinning it exits 0. prettier
  // joined the runtime deps in #1651 and must be exact-pinned too.
  it("passes against arbiter's own package.json (all runtime deps exact-pinned)", () => {
    const result = run(process.cwd())
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('all runtime dependencies are exact-pinned')
  })
})
