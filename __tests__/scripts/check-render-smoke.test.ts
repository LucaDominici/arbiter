// SPDX-License-Identifier: Apache-2.0
// CATALOG: INV-126
// CATALOG: gate: scripts/check-render-smoke.mjs (L1)
// CATALOG: Red phase: all tests must FAIL until scripts/check-render-smoke.mjs is implemented.
//
// Tests the frontend render-smoke presence gate (#1366). The gate fails-closed when a
// frontend archetype (or a `frontend` lane) ships without a render-smoke behavioural spec —
// catching the haben failure mode where token-purity passed but the screen rendered broken.
// SKIPs cleanly for non-frontend / ungoverned repos so they never false-fail.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-render-smoke.mjs')

function run(cwd: string) {
  const r = spawnSync('node', [SCRIPT], { encoding: 'utf-8', cwd })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function stage(arbiter: unknown | null): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'render-smoke-'))
  if (arbiter !== null) {
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify(arbiter, null, 2))
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function withSpec(dir: string, relPath: string, content = '// render smoke\n'): void {
  const abs = join(dir, relPath)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, content)
}

// ─── R1: frontend-spa archetype, no render-smoke spec → exit 1 (fail-closed) ─────

describe('R1: frontend archetype without a render-smoke spec', () => {
  it('exits 1 and reports the missing behavioural test (the haben failure mode)', () => {
    const { dir, cleanup } = stage({ archetype: 'frontend-spa', lanes: [] })
    try {
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toMatch(/render.?smoke|behavioural|no.*test/i)
    } finally {
      cleanup()
    }
  })
})

// ─── R2: frontend-spa archetype WITH a render-smoke spec → exit 0 ────────────────

describe('R2: frontend archetype with a render-smoke spec', () => {
  it('exits 0 when tests/e2e/render-smoke.spec.ts exists', () => {
    const { dir, cleanup } = stage({ archetype: 'frontend-spa', lanes: [] })
    withSpec(dir, 'tests/e2e/render-smoke.spec.ts')
    try {
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 for the *.render-smoke.spec.ts naming variant anywhere in the tree', () => {
    const { dir, cleanup } = stage({ archetype: 'frontend-spa', lanes: [] })
    withSpec(dir, 'src/app/shell.render-smoke.spec.ts')
    try {
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })
})

// ─── R3: frontend LANE (non-FE primary archetype) without spec → exit 1 ──────────

describe('R3: frontend lane on a non-frontend primary archetype', () => {
  it('exits 1 when lanes includes "frontend" but no render-smoke spec exists', () => {
    const { dir, cleanup } = stage({ archetype: 'backend-web-db', lanes: ['frontend'] })
    try {
      expect(run(dir).status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when the frontend lane carries a render-smoke spec', () => {
    const { dir, cleanup } = stage({ archetype: 'backend-web-db', lanes: ['frontend'] })
    withSpec(dir, 'frontend/tests/e2e/render-smoke.spec.ts')
    try {
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })
})

// ─── R4: non-frontend archetype → SKIP, exit 0 (never false-fail) ────────────────

describe('R4: non-frontend archetype', () => {
  it('exits 0 (SKIP) for a library archetype with no frontend lane', () => {
    const { dir, cleanup } = stage({ archetype: 'library', lanes: [] })
    try {
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 (SKIP) for a cli archetype', () => {
    const { dir, cleanup } = stage({ archetype: 'cli', lanes: [] })
    try {
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })
})

// ─── R5: arbiter.json absent → SKIP, exit 0 (ungoverned repo) ────────────────────

describe('R5: arbiter.json absent', () => {
  it('exits 0 (SKIP) when arbiter.json does not exist', () => {
    const { dir, cleanup } = stage(null)
    try {
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })
})

// ─── R6: malformed arbiter.json → exit 2 (schema error) ──────────────────────────

describe('R6: malformed arbiter.json', () => {
  it('exits 2 when arbiter.json is not valid JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'render-smoke-bad-'))
    writeFileSync(join(dir, 'arbiter.json'), '{ this is: not valid json }')
    try {
      expect(run(dir).status).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ─── Help flag ────────────────────────────────────────────────────────────────

describe('--help flag', () => {
  it('exits 0 and mentions render-smoke', () => {
    const r = spawnSync('node', [SCRIPT, '--help'], { encoding: 'utf-8' })
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/render.?smoke/i)
  })
})
