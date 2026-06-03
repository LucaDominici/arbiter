// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-api-snapshot.mjs')

// The script resolves ROOT from process.cwd() and scans the fixed SNAPSHOT_TARGETS
// (src/types/plugin.ts, src/invariants/{index,types}.ts, src/compatibility/index.ts),
// comparing normalized exports against api/*.api.md. It has no --dir flag, so we drive
// it by setting cwd to a self-contained temp fixture.
function run(
  cwd: string,
  args: string[] = [],
  env: Record<string, string> = {},
): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf-8',
    cwd,
    env: { ...process.env, ...env },
  })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

// Build a fixture repo with all SNAPSHOT_TARGETS source files present.
function makeFixture(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'api-snapshot-test-'))
  mkdirSync(join(dir, 'src', 'types'), { recursive: true })
  mkdirSync(join(dir, 'src', 'invariants'), { recursive: true })
  mkdirSync(join(dir, 'src', 'compatibility'), { recursive: true })
  writeFileSync(
    join(dir, 'src', 'types', 'plugin.ts'),
    'export const a = 1\nexport interface Foo { b: number }\n',
  )
  writeFileSync(join(dir, 'src', 'invariants', 'index.ts'), 'export const inv = 2\n')
  writeFileSync(join(dir, 'src', 'invariants', 'types.ts'), 'export type T = string\n')
  writeFileSync(join(dir, 'src', 'compatibility', 'index.ts'), 'export const compat = 3\n')
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

// Seed api/*.api.md snapshots that match the current sources.
function seedSnapshots(dir: string): void {
  const r = run(dir, ['--regen'])
  expect(r.status).toBe(0)
}

describe('check-api-snapshot.mjs (#602 public API export drift gate)', () => {
  it('exits 0 when committed snapshots match current source exports', () => {
    const { dir, cleanup } = makeFixture()
    try {
      seedSnapshots(dir)
      const r = run(dir)
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('OK')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a public export drifts without acknowledgment', () => {
    const { dir, cleanup } = makeFixture()
    try {
      seedSnapshots(dir)
      // Add a new public export — the normalized hash changes => drift.
      writeFileSync(
        join(dir, 'src', 'types', 'plugin.ts'),
        'export const a = 1\nexport interface Foo { b: number }\nexport const NEW_SYMBOL = 99\n',
      )
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('DRIFT')
      expect(r.stderr).toContain('plugin.api.md')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when drift is acknowledged via "BREAKING API CHANGE:" in PR_BODY', () => {
    const { dir, cleanup } = makeFixture()
    try {
      seedSnapshots(dir)
      writeFileSync(
        join(dir, 'src', 'types', 'plugin.ts'),
        'export const a = 1\nexport interface Foo { b: number }\nexport const NEW_SYMBOL = 99\n',
      )
      const r = run(dir, [], { PR_BODY: 'BREAKING API CHANGE: added NEW_SYMBOL' })
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('acknowledged')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a tracked source file is missing', () => {
    const { dir, cleanup } = makeFixture()
    try {
      seedSnapshots(dir)
      // Remove a tracked source — readSource() errors and exits 1.
      rmSync(join(dir, 'src', 'compatibility', 'index.ts'))
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('source file not found')
    } finally {
      cleanup()
    }
  })

  it('exits 0 and creates an initial snapshot when none exists yet', () => {
    const { dir, cleanup } = makeFixture()
    try {
      // No --regen, no pre-existing api/*.api.md: first run bootstraps and passes.
      const r = run(dir)
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('created initial snapshot')
    } finally {
      cleanup()
    }
  })
})
