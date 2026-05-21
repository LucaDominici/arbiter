import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

// INV-94 / CANON-21 — script catalog cohesion gate tests.
//
// The gate reads `scripts/data/script-catalog-baseline.json` (grandfathered
// list) and audits all `scripts/check-*.mjs` files under --root. Any script
// outside the baseline must carry a `// CATALOG:` marker block (>=3 contiguous
// `// CATALOG:` lines) in its header. The gate exits 1 on violation.
//
// It also emits a warning (still exit 0) when the total count exceeds the
// baseline by more than 5 — a soft cap encouraging a refactor pass before
// another addition. A growth of >10 above baseline still exits 0 (the cap
// is intentionally soft; only the marker check is hard-fail).

const SCRIPT = resolve('scripts/check-script-cohesion.mjs')

type RunResult = {
  status: number
  stdout: string
  stderr: string
}

function runCohesion(root: string, extraArgs: string[] = []): RunResult {
  const result = spawnSync('node', [SCRIPT, '--root', root, ...extraArgs], {
    encoding: 'utf-8',
  })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function makeRoot(baselineFiles: string[]): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'script-cohesion-test-'))
  mkdirSync(join(root, 'scripts'), { recursive: true })
  mkdirSync(join(root, 'scripts', 'data'), { recursive: true })
  writeFileSync(
    join(root, 'scripts', 'data', 'script-catalog-baseline.json'),
    JSON.stringify({
      schema: 'arbiter-script-catalog-baseline-v1',
      generated_at: '2026-05-21T00:00:00.000Z',
      doctrine: 'test baseline',
      files: baselineFiles,
    }),
  )
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

function writeScript(root: string, name: string, body: string): void {
  writeFileSync(join(root, 'scripts', name), body)
}

const CATALOG_HEADER = [
  '#!/usr/bin/env node',
  '// CATALOG: aggregates X behaviour across the toolchain.',
  '// CATALOG: rejected fold-in into check-foo.mjs because foo handles a different concern.',
  '// CATALOG: rejected fold-in into check-bar.mjs because bar runs in a different gate tier.',
  'process.exit(0)',
  '',
].join('\n')

const NO_HEADER = ['#!/usr/bin/env node', '// some other comment', 'process.exit(0)', ''].join('\n')

describe('check-script-cohesion', () => {
  let env: { root: string; cleanup: () => void } | null = null
  afterEach(() => {
    if (env) env.cleanup()
    env = null
  })

  it('fails when a NEW script (not in baseline) lacks the // CATALOG: marker', () => {
    env = makeRoot([])
    writeScript(env.root, 'check-newcomer.mjs', NO_HEADER)
    const r = runCohesion(env.root)
    expect(r.status).toBe(1)
    expect(r.stdout + r.stderr).toContain('check-newcomer.mjs')
    expect(r.stdout + r.stderr).toMatch(/CATALOG/i)
  })

  it('passes when a NEW script carries a 3+ line // CATALOG: header block', () => {
    env = makeRoot([])
    writeScript(env.root, 'check-newcomer.mjs', CATALOG_HEADER)
    const r = runCohesion(env.root)
    expect(r.status).toBe(0)
  })

  it('passes when a script IS in the baseline even without a marker (grandfathered)', () => {
    env = makeRoot(['scripts/check-grandfathered.mjs'])
    writeScript(env.root, 'check-grandfathered.mjs', NO_HEADER)
    const r = runCohesion(env.root)
    expect(r.status).toBe(0)
  })

  it('exits 0 with a warning when count exceeds baseline by more than 5', () => {
    env = makeRoot([])
    // Six new scripts, each with the required marker — all pass the marker
    // check but the count crosses the soft cap (baseline size 0, current 6).
    for (let i = 0; i < 6; i++) {
      writeScript(env.root, `check-extra-${i}.mjs`, CATALOG_HEADER)
    }
    const r = runCohesion(env.root)
    expect(r.status).toBe(0)
    expect(r.stdout + r.stderr).toMatch(/warn|baseline|exceed/i)
  })

  it('exits 0 even when count exceeds baseline by more than 10 (soft cap, not hard)', () => {
    env = makeRoot([])
    for (let i = 0; i < 11; i++) {
      writeScript(env.root, `check-extra-${i}.mjs`, CATALOG_HEADER)
    }
    const r = runCohesion(env.root)
    expect(r.status).toBe(0)
  })

  it('a single // CATALOG: comment line is not enough — needs 3+ contiguous lines', () => {
    env = makeRoot([])
    writeScript(
      env.root,
      'check-thin.mjs',
      ['#!/usr/bin/env node', '// CATALOG: too thin', 'process.exit(0)', ''].join('\n'),
    )
    const r = runCohesion(env.root)
    expect(r.status).toBe(1)
  })

  it('passes when no scripts exist outside the baseline at all', () => {
    env = makeRoot([])
    // No scripts/check-*.mjs files in the temp root.
    const r = runCohesion(env.root)
    expect(r.status).toBe(0)
  })
})
