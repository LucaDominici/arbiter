// SPDX-License-Identifier: Apache-2.0
// F2 (#1838, item 6): derived website pages (active-experiments table, kit
// dimension count) are EMITTED by scripts/gen-derived-pages.mjs from their
// code registries, with --check wired in L1. This suite proves the freshness
// gate catches the two historical drift classes fixed by hand in F1 (#1837):
// an experiments table contradicting src/experimental/registry.ts ("No
// experiments are currently active" while kit was registered), and a
// hardcoded dimension count contradicting src/kit/catalog.json (77 vs 78).
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
  parseExperiments,
  countKitDimensions,
  buildExperimentsRegion,
  buildKitCountRegion,
  replaceMarkerRegion,
} from '../../scripts/gen-derived-pages.mjs'

const SCRIPT = resolve('scripts/gen-derived-pages.mjs')

// ─── parseExperiments ─────────────────────────────────────────────────────────

const REGISTRY_FIXTURE = `
const EXPERIMENTS: readonly ExperimentRecord[] = [
  {
    name: 'kit',
    stabilityTarget: 'beta',
    addedIn: '0.1.0',
    promotionCriteria: 'criteria text',
    plannedReviewDate: '2026-11-18',
  },
]
`

describe('parseExperiments', () => {
  it('extracts name/stability/addedIn/review/criteria from registry.ts source', () => {
    expect(parseExperiments(REGISTRY_FIXTURE)).toEqual([
      {
        name: 'kit',
        stabilityTarget: 'beta',
        addedIn: '0.1.0',
        promotionCriteria: 'criteria text',
        plannedReviewDate: '2026-11-18',
      },
    ])
  })

  it('throws on zero experiments (fail-closed: registry has had >=1 entry since 0.1.0)', () => {
    expect(() => parseExperiments('const EXPERIMENTS = [\n]\n')).toThrow()
  })

  it('throws when the EXPERIMENTS array is absent (parser out of date)', () => {
    expect(() => parseExperiments('export const OTHER = 1')).toThrow()
  })

  it('parses the REAL registry.ts without error', () => {
    const real = readFileSync(resolve('src/experimental/registry.ts'), 'utf-8')
    const experiments = parseExperiments(real)
    expect(experiments.length).toBeGreaterThan(0)
    for (const e of experiments) {
      expect(e.name).toBeTruthy()
      expect(e.stabilityTarget).toBeTruthy()
    }
  })
})

// ─── countKitDimensions ───────────────────────────────────────────────────────

describe('countKitDimensions', () => {
  it('counts a plain-array catalog', () => {
    expect(countKitDimensions('[{"id":1},{"id":2}]')).toBe(2)
  })

  it('counts a {dimensions: []} catalog', () => {
    expect(countKitDimensions('{"dimensions":[{"id":1}]}')).toBe(1)
  })

  it('throws on an empty catalog (fail-closed)', () => {
    expect(() => countKitDimensions('[]')).toThrow()
  })

  it('matches the REAL catalog.json count', () => {
    const real = readFileSync(resolve('src/kit/catalog.json'), 'utf-8')
    expect(countKitDimensions(real)).toBeGreaterThan(0)
  })
})

// ─── region builders ──────────────────────────────────────────────────────────

describe('buildExperimentsRegion / buildKitCountRegion', () => {
  it('emits one table row per experiment', () => {
    const region = buildExperimentsRegion([
      {
        name: 'kit',
        stabilityTarget: 'beta',
        addedIn: '0.1.0',
        promotionCriteria: 'c',
        plannedReviewDate: 'd',
      },
      {
        name: 'other',
        stabilityTarget: 'beta',
        addedIn: '0.5.0',
        promotionCriteria: 'c2',
        plannedReviewDate: 'd2',
      },
    ])
    expect(region).toContain('| `kit` |')
    expect(region).toContain('| `other` |')
  })

  it('embeds the live count in heading and prose (the 77-vs-78 class, #1837)', () => {
    const region = buildKitCountRegion(78)
    expect(region).toContain('(78 dimensions)')
    expect(region).toContain('**78 security and')
  })
})

// ─── replaceMarkerRegion ──────────────────────────────────────────────────────

describe('replaceMarkerRegion', () => {
  it('replaces only the content between markers, preserving surrounding prose', () => {
    const doc =
      'hand prose before\n<!-- BEGIN GENERATED:x -->\nold\n<!-- END GENERATED:x -->\nhand prose after\n'
    const out = replaceMarkerRegion(doc, 'x', 'new content')
    expect(out).toContain('hand prose before')
    expect(out).toContain('hand prose after')
    expect(out).toContain('new content')
    expect(out).not.toContain('\nold\n')
  })

  it('throws when the marker region is missing (fail-closed, never appends blindly)', () => {
    expect(() => replaceMarkerRegion('no markers here', 'x', 'c')).toThrow()
  })
})

// ─── end-to-end: real repo is fresh; synthetic drift fails --check ────────────

describe('gen-derived-pages.mjs --check — real repo', () => {
  it('exits 0: committed regions match the live registries', () => {
    const r = spawnSync('node', [SCRIPT, '--check'], { encoding: 'utf-8', cwd: resolve('.') })
    expect(r.stdout).not.toContain('STALE')
    expect(r.status).toBe(0)
  })
})

describe('gen-derived-pages.mjs --check — synthetic drift fails closed', () => {
  function fixtures(dir: string) {
    const registry = join(dir, 'registry.ts')
    const catalog = join(dir, 'catalog.json')
    const policy = join(dir, 'policy.md')
    const features = join(dir, 'features.md')
    writeFileSync(registry, REGISTRY_FIXTURE)
    writeFileSync(catalog, JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }]))
    writeFileSync(
      policy,
      '# Policy\n\n<!-- BEGIN GENERATED:experiments -->\n<!-- END GENERATED:experiments -->\n',
    )
    writeFileSync(
      features,
      '# Features\n\n<!-- BEGIN GENERATED:kit-count -->\n<!-- END GENERATED:kit-count -->\n',
    )
    return { registry, catalog, policy, features }
  }

  function run(f: ReturnType<typeof fixtures>, check: boolean) {
    return spawnSync(
      'node',
      [
        SCRIPT,
        ...(check ? ['--check'] : []),
        `--registry=${f.registry}`,
        `--catalog=${f.catalog}`,
        `--policy=${f.policy}`,
        `--features=${f.features}`,
      ],
      { encoding: 'utf-8' },
    )
  }

  it('generate-then-check round-trips green; a registry change turns --check red', () => {
    const dir = mkdtempSync(join(tmpdir(), 'derived-pages-'))
    try {
      const f = fixtures(dir)
      expect(run(f, false).status).toBe(0) // generate
      expect(run(f, true).status).toBe(0) // fresh

      // The #1837 drift class: registry gains an experiment, page not regenerated.
      // (Replace the ARRAY-closing "\n]" — a bare ']' would hit ExperimentRecord[].)
      writeFileSync(
        f.registry,
        REGISTRY_FIXTURE.replace(
          /\n\]/,
          `  {
    name: 'new-exp',
    stabilityTarget: 'beta',
    addedIn: '0.9.0',
    promotionCriteria: 'x',
    plannedReviewDate: '2027-01-01',
  },
]`,
        ),
      )
      const stale = run(f, true)
      expect(stale.status).toBe(1)
      expect(stale.stdout).toContain('STALE')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a catalog count change turns --check red (the 77-vs-78 class)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'derived-pages-count-'))
    try {
      const f = fixtures(dir)
      expect(run(f, false).status).toBe(0)
      writeFileSync(f.catalog, JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]))
      const stale = run(f, true)
      expect(stale.status).toBe(1)
      expect(stale.stdout).toContain('kit-count')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 2 when a source registry is missing (invocation error, never vacuous)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'derived-pages-missing-'))
    try {
      const f = fixtures(dir)
      rmSync(f.registry)
      expect(run(f, true).status).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
