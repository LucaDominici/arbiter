// SPDX-License-Identifier: Apache-2.0
// CATALOG: INV-137
// CATALOG: gate: scripts/check-smoke-journeys.mjs (L1)
// CATALOG: Red phase: all tests must FAIL until scripts/check-smoke-journeys.mjs is implemented.
//
// Tests the declarative smoke-journey acceptance-floor gate (#2080, F-TEST-05). The gate
// reuses INV-124's OR-glob coverage algorithm but with INV-126's fail-closed default:
//   - applicable:false → SKIP (archetype has no interactive login/CRUD/authz journeys).
//   - a journey applicable to the archetype defaults to `required` and MUST have a spec.
//   - `n/a` must carry an auditable rationale ≥20 chars; a fully-n/a floor is a hard fail.
// A "wired-but-dead" spec cannot be expressed as n/a — n/a is genuine non-applicability only.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-smoke-journeys.mjs')

function run(cwd: string) {
  const r = spawnSync('node', [SCRIPT], { encoding: 'utf-8', cwd })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function stage(manifest: unknown | null, arbiter?: unknown): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'smoke-journeys-'))
  if (manifest !== null) {
    writeFileSync(join(dir, 'smoke-journeys.json'), JSON.stringify(manifest, null, 2))
  }
  if (arbiter !== undefined) {
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify(arbiter, null, 2))
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function withSpec(dir: string, relPath: string, content = '// smoke journey\n'): void {
  const abs = join(dir, relPath)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, content)
}

const REQUIRED = {
  id: 'auth',
  name: 'Authentication flow',
  globs: ['tests/smoke/**/*.spec.ts'],
  status: 'required',
}
const NA = {
  id: 'authz',
  name: 'Authorization enforcement',
  globs: ['tests/smoke/**/*.spec.ts'],
  status: 'n/a',
  rationale: 'frontend-spa has no server-side authz of its own to smoke-test here.',
}

// ─── R1: manifest absent → SKIP (exit 0) ────────────────────────────────────────
describe('R1: manifest absent', () => {
  it('exits 0 and SKIPs when smoke-journeys.json is missing (ungoverned repo)', () => {
    const { dir, cleanup } = stage(null)
    try {
      const r = run(dir)
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/SKIP/i)
    } finally {
      cleanup()
    }
  })
})

// ─── R2: applicable:false → SKIP (exit 0), BEFORE all-n/a / rationale checks ──────
describe('R2: applicable:false', () => {
  it('exits 0 and SKIPs for an archetype with no interactive journeys', () => {
    const { dir, cleanup } = stage({
      archetype: 'library',
      applicable: false,
      reason: 'Archetype has no interactive login/CRUD/authz user journeys to smoke-test.',
    })
    try {
      const r = run(dir)
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/SKIP/i)
    } finally {
      cleanup()
    }
  })
})

// ─── R3: required journey WITH a matching spec → exit 0 ──────────────────────────
describe('R3: required journey covered', () => {
  it('exits 0 when a required journey has ≥1 matching spec', () => {
    const { dir, cleanup } = stage({
      archetype: 'frontend-spa',
      applicable: true,
      journeys: [REQUIRED, NA],
    })
    try {
      withSpec(dir, 'tests/smoke/smoke-journeys.spec.ts')
      const r = run(dir)
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/OK/i)
    } finally {
      cleanup()
    }
  })
})

// ─── R4: required journey with NO matching spec → exit 1 (coverage gap) ───────────
describe('R4: required journey uncovered', () => {
  it('exits 1 and names the uncovered journey', () => {
    const { dir, cleanup } = stage({
      archetype: 'frontend-spa',
      applicable: true,
      journeys: [REQUIRED, NA],
    })
    try {
      // no spec written → auth journey glob matches nothing
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toMatch(/auth/i)
      expect(r.stderr).toMatch(/empty|no files|uncovered|missing/i)
    } finally {
      cleanup()
    }
  })
})

// ─── R5: n/a journey with a too-short rationale → exit 1 (n/a-guard) ──────────────
describe('R5: n/a rationale too short', () => {
  it('exits 1 when an n/a journey has a rationale <20 chars', () => {
    const { dir, cleanup } = stage({
      archetype: 'frontend-spa',
      applicable: true,
      journeys: [REQUIRED, { ...NA, rationale: 'nope' }],
    })
    try {
      withSpec(dir, 'tests/smoke/smoke-journeys.spec.ts')
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toMatch(/rationale/i)
    } finally {
      cleanup()
    }
  })
})

// ─── R6: n/a with an adequate rationale + one covered required → exit 0 ───────────
describe('R6: n/a rationale adequate', () => {
  it('exits 0 when the n/a journey carries a ≥20-char rationale', () => {
    const { dir, cleanup } = stage({
      archetype: 'frontend-spa',
      applicable: true,
      journeys: [REQUIRED, NA],
    })
    try {
      withSpec(dir, 'tests/smoke/smoke-journeys.spec.ts')
      const r = run(dir)
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })
})

// ─── R7: ALL journeys n/a → exit 1 (all-n/a hard fail) ───────────────────────────
describe('R7: all-n/a floor', () => {
  it('exits 1 when every journey is n/a (a fully-skipped floor defeats the gate)', () => {
    const { dir, cleanup } = stage({
      archetype: 'frontend-spa',
      applicable: true,
      journeys: [
        { ...NA, id: 'auth', name: 'Authentication flow' },
        { ...NA, id: 'crud', name: 'Core CRUD' },
        NA,
      ],
    })
    try {
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toMatch(/all.*n\/a|fully.?skipped/i)
    } finally {
      cleanup()
    }
  })
})

// ─── R8: absent status defaults to `required` (fail-closed) ──────────────────────
describe('R8: absent status = required', () => {
  it('exits 1 when a status-less journey has no spec (absent = required, not silently n/a)', () => {
    const { dir, cleanup } = stage({
      archetype: 'frontend-spa',
      applicable: true,
      journeys: [{ id: 'auth', name: 'Authentication flow', globs: ['tests/smoke/**/*.spec.ts'] }],
    })
    try {
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toMatch(/auth/i)
    } finally {
      cleanup()
    }
  })
})

// ─── R9: malformed JSON → exit 2 ─────────────────────────────────────────────────
describe('R9: malformed manifest', () => {
  it('exits 2 on invalid JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'smoke-journeys-'))
    try {
      writeFileSync(join(dir, 'smoke-journeys.json'), '{ not json ')
      const r = run(dir)
      expect(r.status).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ─── R10: journeys not an array → exit 2 (schema error) ──────────────────────────
describe('R10: journeys not an array', () => {
  it('exits 2 when applicable:true but journeys is missing/not an array', () => {
    const { dir, cleanup } = stage({ archetype: 'frontend-spa', applicable: true, journeys: 'x' })
    try {
      const r = run(dir)
      expect(r.status).toBe(2)
    } finally {
      cleanup()
    }
  })
})

// ─── R11: path-traversal glob → exit 2 ───────────────────────────────────────────
describe('R11: path-traversal glob', () => {
  it('exits 2 when a required journey glob escapes the repo', () => {
    const { dir, cleanup } = stage({
      archetype: 'frontend-spa',
      applicable: true,
      journeys: [{ id: 'auth', name: 'Auth', globs: ['../../etc/**'], status: 'required' }],
    })
    try {
      const r = run(dir)
      expect(r.status).toBe(2)
    } finally {
      cleanup()
    }
  })
})

// ─── R12: archetype mismatch vs arbiter.json → exit 1 ────────────────────────────
describe('R12: stale manifest archetype', () => {
  it('exits 1 when manifest.archetype disagrees with arbiter.json', () => {
    const { dir, cleanup } = stage(
      { archetype: 'frontend-spa', applicable: true, journeys: [REQUIRED, NA] },
      { archetype: 'backend-web-db' },
    )
    try {
      withSpec(dir, 'tests/smoke/smoke-journeys.spec.ts')
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toMatch(/archetype/i)
    } finally {
      cleanup()
    }
  })
})

// ─── AC-2043.1: login/CRUD/authz TRIO floor (#2043) ─────────────────────────────
// RED: a manifest declaring only a SUBSET of the required journeys passes today —
// the gate checks only the journeys that ARE declared. The trio floor (auth/crud/
// authz, configurable via smokeJourneys.requiredJourneys in arbiter.json) must be
// DECLARED in full; a missing journey fails the gate NAMING it.
describe('AC-2043.1: smoke-journey trio floor (#2043)', () => {
  it('fails naming the missing crud/authz when only login is declared (and covered)', () => {
    const { dir, cleanup } = stage(
      {
        archetype: 'frontend-spa',
        applicable: true,
        journeys: [
          {
            id: 'auth',
            name: 'Authentication flow',
            globs: ['tests/smoke/**/*.spec.ts'],
            status: 'required',
          },
        ],
      },
      { archetype: 'frontend-spa' },
    )
    try {
      withSpec(dir, 'tests/smoke/auth.spec.ts')
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('crud')
      expect(r.stderr).toContain('authz')
    } finally {
      cleanup()
    }
  })

  it('passes when the full trio is declared and the required ones are covered', () => {
    const { dir, cleanup } = stage(
      {
        archetype: 'frontend-spa',
        applicable: true,
        journeys: [
          {
            id: 'auth',
            name: 'Authentication flow',
            globs: ['tests/smoke/**/*.spec.ts'],
            status: 'required',
          },
          {
            id: 'crud',
            name: 'Core CRUD operation',
            globs: ['tests/smoke/**/*.spec.ts'],
            status: 'required',
          },
          {
            id: 'authz',
            name: 'Authorization enforcement',
            globs: ['tests/smoke/**/*.spec.ts'],
            status: 'n/a',
            rationale: 'authz is enforced server-side and covered by the backend api-e2e suite.',
          },
        ],
      },
      { archetype: 'frontend-spa' },
    )
    try {
      withSpec(dir, 'tests/smoke/smoke-journeys.spec.ts')
      const r = run(dir)
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })
})
