// SPDX-License-Identifier: Apache-2.0
// CATALOG: INV-124
// CATALOG: gate: scripts/check-test-pyramid.mjs (L1)
// CATALOG: Red phase: all tests must FAIL until scripts/check-test-pyramid.mjs is implemented.
//
// Tests R1-R6 gate behaviour (empty declared level, n/a rationale, absent manifest, malformed JSON).
// Assertion-quality checking is INV-118 / check-anti-proforma.mjs — keep boundary clean.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-test-pyramid.mjs')

function run(cwd: string) {
  const r = spawnSync('node', [SCRIPT], { encoding: 'utf-8', cwd })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function stage(manifest: unknown): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'test-pyramid-'))
  writeFileSync(join(dir, 'test-pyramid.json'), JSON.stringify(manifest, null, 2))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function stageWithFile(
  manifest: unknown,
  relPath: string,
  content = '// test\n',
): { dir: string; cleanup: () => void } {
  const { dir, cleanup } = stage(manifest)
  const abs = join(dir, relPath)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, content)
  return { dir, cleanup }
}

// ─── R1: required level, 0 matching files → exit 1 ───────────────────────────

describe('R1: required level with 0 matching files', () => {
  it('exits 1 and emits "declared but empty"', () => {
    const { dir, cleanup } = stage({
      archetype: 'library',
      levels: [{ id: 'L1', name: 'Unit', globs: ['__tests__/**/*.test.ts'], status: 'required' }],
    })
    try {
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toMatch(/declared but empty/i)
    } finally {
      cleanup()
    }
  })
})

// ─── R2: required level, ≥1 matching file → exit 0 ───────────────────────────

describe('R2: required level with ≥1 matching file', () => {
  it('exits 0 when a test file exists matching the glob', () => {
    const { dir, cleanup } = stageWithFile(
      {
        archetype: 'library',
        levels: [{ id: 'L1', name: 'Unit', globs: ['__tests__/**/*.test.ts'], status: 'required' }],
      },
      '__tests__/foo.test.ts',
      `import { it, expect } from 'vitest'\nit('x', () => expect(1).toBe(1))\n`,
    )
    try {
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('OR semantics: passes if ANY glob in the array matches at least one file', () => {
    const { dir, cleanup } = stageWithFile(
      {
        archetype: 'library',
        levels: [
          {
            id: 'L1',
            name: 'Unit',
            globs: ['no-match/**/*.ts', '__tests__/**/*.test.ts'],
            status: 'required',
          },
        ],
      },
      '__tests__/bar.test.ts',
      `import { it, expect } from 'vitest'\nit('y', () => expect(2).toBe(2))\n`,
    )
    try {
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })
})

// ─── R3: n/a level, rationale < 20 chars → exit 1 ───────────────────────────

describe('R3: n/a level with rationale shorter than 20 chars', () => {
  it('exits 1 and references rationale requirement', () => {
    const { dir, cleanup } = stage({
      archetype: 'library',
      levels: [{ id: 'L3', name: 'E2E', status: 'n/a', rationale: 'too short' }],
    })
    try {
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toMatch(/rationale/i)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when rationale field is absent entirely', () => {
    const { dir, cleanup } = stage({
      archetype: 'library',
      levels: [{ id: 'L3', name: 'E2E', status: 'n/a' }],
    })
    try {
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toMatch(/rationale/i)
    } finally {
      cleanup()
    }
  })
})

// ─── R4: n/a level, rationale ≥ 20 chars → exit 0 ───────────────────────────

describe('R4: n/a level with sufficient rationale', () => {
  it('exits 0 when rationale is ≥20 chars (mixed with a passing required level)', () => {
    // Must include at least one required level to avoid triggering the all-n/a hard fail.
    const { dir, cleanup } = stageWithFile(
      {
        archetype: 'library',
        levels: [
          { id: 'L1', name: 'Unit', globs: ['__tests__/**/*.test.ts'], status: 'required' },
          {
            id: 'L3',
            name: 'E2E',
            status: 'n/a',
            rationale:
              'Library has no runnable UI; E2E testing is the consumer project responsibility.',
          },
        ],
      },
      '__tests__/r4.test.ts',
      `import { it, expect } from 'vitest'\nit('r4', () => expect(1).toBe(1))\n`,
    )
    try {
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })
})

// ─── R5: manifest absent → SKIP, exit 0 ──────────────────────────────────────

describe('R5: manifest absent', () => {
  it('exits 0 (SKIP) when test-pyramid.json does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'test-pyramid-absent-'))
    try {
      expect(run(dir).status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ─── R6: malformed JSON → exit 1 / exit 2 ────────────────────────────────────

describe('R6: malformed manifest JSON', () => {
  it('exits non-zero when test-pyramid.json is not valid JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'test-pyramid-bad-'))
    writeFileSync(join(dir, 'test-pyramid.json'), '{ this is: not valid json }')
    try {
      const r = run(dir)
      expect(r.status).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 2 when manifest.levels is not an array (schema error)', () => {
    const { dir, cleanup } = stage({ archetype: 'library', levels: 'not-an-array' })
    try {
      expect(run(dir).status).toBe(2)
    } finally {
      cleanup()
    }
  })
})

// ─── Edge cases from red-team amendments ──────────────────────────────────────

describe('edge cases (red-team amendments)', () => {
  it('path traversal in glob → exit 2', () => {
    const { dir, cleanup } = stage({
      archetype: 'library',
      levels: [{ id: 'L1', name: 'Unit', globs: ['../../etc/passwd'], status: 'required' }],
    })
    try {
      expect(run(dir).status).toBe(2)
    } finally {
      cleanup()
    }
  })

  it('empty globs array on required level → exit 1', () => {
    const { dir, cleanup } = stage({
      archetype: 'library',
      levels: [{ id: 'L1', name: 'Unit', globs: [], status: 'required' }],
    })
    try {
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toMatch(/no glob patterns/i)
    } finally {
      cleanup()
    }
  })

  it('all levels are n/a → exit 1 (fully-skipped pyramid)', () => {
    const { dir, cleanup } = stage({
      archetype: 'library',
      levels: [
        {
          id: 'L1',
          name: 'Unit',
          status: 'n/a',
          rationale: 'All levels skipped for this example demonstration.',
        },
        {
          id: 'L2',
          name: 'Property',
          status: 'n/a',
          rationale: 'All levels skipped for this example demonstration.',
        },
      ],
    })
    try {
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toMatch(/fully-skipped|all.*n\/a/i)
    } finally {
      cleanup()
    }
  })

  it('archetype mismatch with arbiter.json → exit 1', () => {
    const dir = mkdtempSync(join(tmpdir(), 'test-pyramid-mismatch-'))
    writeFileSync(
      join(dir, 'test-pyramid.json'),
      JSON.stringify({ archetype: 'library', levels: [] }),
    )
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ archetype: 'cli' }))
    try {
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toMatch(/archetype/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // INV-96 (#1537): a CORRUPT arbiter.json must FAIL the archetype guard, never be
  // silently swallowed — that is exactly when manifest drift is most likely to hide.
  it('malformed arbiter.json → exit 1 (fail-closed, not silently skipped)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'test-pyramid-bad-arbiter-'))
    writeFileSync(
      join(dir, 'test-pyramid.json'),
      JSON.stringify({ archetype: 'library', levels: [] }),
    )
    writeFileSync(join(dir, 'arbiter.json'), '{ not: valid json,, }')
    try {
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toMatch(/malformed/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ─── Help flag ────────────────────────────────────────────────────────────────

describe('--help flag', () => {
  it('exits 0 and mentions test-pyramid', () => {
    const r = spawnSync('node', [SCRIPT, '--help'], { encoding: 'utf-8' })
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/test-pyramid/i)
  })
})
