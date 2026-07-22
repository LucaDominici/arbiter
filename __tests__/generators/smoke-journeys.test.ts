// SPDX-License-Identifier: Apache-2.0
// CANON-05: generator unit test for src/generators/smoke-journeys.ts (#2080, INV-137).
// CANON-11: brownfield / skipIfExists coverage for the file-emitting generator.
//
// The smoke-journey acceptance floor (login/CRUD/authz). Applicability is archetype ×
// language computed (mirrors INV-126's SERVICE_ARCHETYPES): frontend-spa + TypeScript is
// the only combo with a scaffolded honest starter; every other combo emits an explicit
// top-level applicable:false with a reason (a VISIBLE floor-reduction, never a per-journey lie).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateSmokeJourneys } from '../../src/generators/smoke-journeys.js'
import { globMatch } from '../../scripts/lib/glob-walk.mjs'
import type { Archetype } from '../../src/wizard/types.js'

let dir: string

beforeEach(() => {
  dir = createTestProject('typescript')
})
afterEach(() => {
  cleanupTestProject(dir)
})

interface Journey {
  id: string
  name: string
  globs?: string[]
  status?: string
  rationale?: string
}
interface Manifest {
  archetype: string
  applicable: boolean
  reason?: string
  journeys?: Journey[]
}

function readManifest(d: string): Manifest {
  return JSON.parse(readFileSync(join(d, 'smoke-journeys.json'), 'utf-8'))
}

describe('generateSmokeJourneys: applicable frontend-spa + TypeScript (G1)', () => {
  it('emits smoke-journeys.json with applicable:true and the auth/crud/authz journeys', () => {
    const config = makeConfig(dir, { language: 'typescript', archetype: 'frontend-spa' })
    generateSmokeJourneys(config)
    const m = readManifest(dir)
    expect(m.archetype).toBe('frontend-spa')
    expect(m.applicable).toBe(true)
    const ids = (m.journeys ?? []).map((j) => j.id)
    expect(ids).toEqual(expect.arrayContaining(['auth', 'crud', 'authz']))
  })

  it('auth and crud default to required; authz is n/a with a ≥20-char rationale', () => {
    const config = makeConfig(dir, { language: 'typescript', archetype: 'frontend-spa' })
    generateSmokeJourneys(config)
    const m = readManifest(dir)
    const by = new Map((m.journeys ?? []).map((j) => [j.id, j]))
    expect(by.get('auth')!.status).toBe('required')
    expect(by.get('crud')!.status).toBe('required')
    expect(by.get('authz')!.status).toBe('n/a')
    expect((by.get('authz')!.rationale ?? '').length).toBeGreaterThanOrEqual(20)
  })
})

describe('generateSmokeJourneys: honest day-1-green scaffold (G2)', () => {
  it('scaffolds a starter smoke spec that matches every required journey glob', () => {
    const config = makeConfig(dir, { language: 'typescript', archetype: 'frontend-spa' })
    const result = generateSmokeJourneys(config)
    const spec = result.files.find((f) => f.path.endsWith('.spec.ts'))
    expect(spec).toBeDefined()
    expect(existsSync(spec!.path)).toBe(true)
    // The scaffolded spec must be non-trivial (not an empty pass-through).
    expect(readFileSync(spec!.path, 'utf-8').length).toBeGreaterThan(80)

    // Day-1-green invariant: the scaffolded file (repo-relative) satisfies the OR-glob
    // of EVERY required journey — so a fresh project is honestly green, not by a default flag.
    const rel = spec!.path.slice(dir.length + 1).replace(/\\/g, '/')
    const m = readManifest(dir)
    for (const j of m.journeys ?? []) {
      if (j.status === 'n/a') continue
      expect((j.globs ?? []).some((g) => globMatch(g, rel))).toBe(true)
    }
  })
})

describe('generateSmokeJourneys: non-applicable combos → explicit applicable:false (G3)', () => {
  it.each(['library', 'cli', 'data-pipeline', 'embedded', 'backend-web-db'] as Archetype[])(
    'archetype %s (TS) is applicable:false with a non-empty reason and no journeys',
    (archetype) => {
      const config = makeConfig(dir, { language: 'typescript', archetype })
      generateSmokeJourneys(config)
      const m = readManifest(dir)
      expect(m.applicable).toBe(false)
      expect(typeof m.reason).toBe('string')
      expect((m.reason ?? '').length).toBeGreaterThan(20)
      expect(m.journeys).toBeUndefined()
    },
  )

  it('frontend-spa on a NON-TS language is applicable:false (starter is TS-only, like render-smoke)', () => {
    const d = createTestProject('python')
    try {
      const config = makeConfig(d, { language: 'python', archetype: 'frontend-spa' })
      generateSmokeJourneys(config)
      const m = readManifest(d)
      expect(m.applicable).toBe(false)
      expect((m.reason ?? '').length).toBeGreaterThan(20)
    } finally {
      cleanupTestProject(d)
    }
  })

  it('does NOT scaffold a spec for a non-applicable archetype', () => {
    const config = makeConfig(dir, { language: 'typescript', archetype: 'library' })
    const result = generateSmokeJourneys(config)
    expect(result.files.some((f) => f.path.endsWith('.spec.ts'))).toBe(false)
  })
})

describe('generateSmokeJourneys: dryRun + brownfield (G4)', () => {
  it('respects dryRun — no smoke-journeys.json on disk', () => {
    const config = makeConfig(dir, { language: 'typescript', archetype: 'frontend-spa' })
    generateSmokeJourneys(config, { dryRun: true })
    expect(existsSync(join(dir, 'smoke-journeys.json'))).toBe(false)
  })

  it('does not overwrite an existing smoke-journeys.json (skipIfExists)', () => {
    const custom = JSON.stringify(
      { archetype: 'frontend-spa', applicable: false, custom: 1 },
      null,
      2,
    )
    writeFileSync(join(dir, 'smoke-journeys.json'), custom)
    const config = makeConfig(dir, { language: 'typescript', archetype: 'frontend-spa' })
    const result = generateSmokeJourneys(config)
    expect(readFileSync(join(dir, 'smoke-journeys.json'), 'utf-8')).toBe(custom)
    const mf = result.files.find((f) => f.path.endsWith('smoke-journeys.json'))
    expect(mf?.action).toBe('skipped')
  })
})
