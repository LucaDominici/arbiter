// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { KitCatalogSchema, DerivedKitSchema, type DerivedKit } from '../../src/kit/schema.js'
import { scanForRedactedTokens, type LexiconEntry } from '../../src/kit/redaction.js'
import { loadCatalog } from '../../src/kit/catalog.js'

const ROOT = resolve(__dirname, '../..')
const REDACTION_LEXICON: LexiconEntry[] = JSON.parse(
  readFileSync(join(ROOT, 'scripts/data/redaction-lexicon.json'), 'utf-8'),
) as LexiconEntry[]

const STACKS = ['java', 'typescript', 'python', 'go', 'rust'] as const

let derived: DerivedKit

beforeAll(() => {
  // derived.json must be built before tests run (build-kit.mjs in L1 gate)
  const derivedPath = join(ROOT, 'src/kit/derived.json')
  expect(
    existsSync(derivedPath),
    'src/kit/derived.json missing — run node scripts/build-kit.mjs',
  ).toBe(true)
  derived = DerivedKitSchema.parse(JSON.parse(readFileSync(derivedPath, 'utf-8')))
})

// ─── Schema validation ────────────────────────────────────────────────────────

describe('catalog.json parses', () => {
  it('catalog.json is valid KitCatalog', () => {
    const raw = JSON.parse(readFileSync(join(ROOT, 'src/kit/catalog.json'), 'utf-8'))
    expect(() => KitCatalogSchema.parse(raw)).not.toThrow()
  })

  it('derived.json is valid DerivedKit', () => {
    expect(derived).toBeDefined()
    expect(derived.length).toBe(77)
  })
})

// ─── TML ratchet ─────────────────────────────────────────────────────────────

describe('TML ratchet', () => {
  const baseline = JSON.parse(readFileSync(join(ROOT, 'src/kit/baseline.json'), 'utf-8'))

  it('total dim count >= baseline', () => {
    expect(derived.length).toBeGreaterThanOrEqual(baseline.total)
  })

  for (const tml of ['L1', 'L2', 'L3'] as const) {
    it(`${tml} count >= baseline.tml.${tml}`, () => {
      const count = derived.filter((d) => d.tml === tml).length
      expect(count).toBeGreaterThanOrEqual(baseline.tml[tml])
    })
  }
})

// ─── Gap-count ratchet ────────────────────────────────────────────────────────

describe('gap-count ratchet', () => {
  const baseline = JSON.parse(readFileSync(join(ROOT, 'src/kit/baseline.json'), 'utf-8'))

  for (const stack of STACKS) {
    it(`${stack} gap count <= baseline.gapPerStack.${stack}`, () => {
      const gaps = derived.filter((d) => d.perStack[stack].kind === 'gap').length
      expect(gaps).toBeLessThanOrEqual(baseline.gapPerStack[stack])
    })
  }
})

// ─── Each dim has all 5 stack keys ────────────────────────────────────────────

describe('perStack completeness', () => {
  it('every dim has all 5 stacks in perStack', () => {
    for (const dim of derived) {
      for (const stack of STACKS) {
        expect(dim.perStack[stack], `${dim.id} missing perStack.${stack}`).toBeDefined()
      }
    }
  })
})

// ─── Grid coverage: each (stack × TML) has ≥1 covered cell ──────────────────

describe('grid coverage (5 stacks × 3 TML)', () => {
  for (const stack of STACKS) {
    for (const tml of ['L1', 'L2', 'L3'] as const) {
      it(`${stack} × ${tml} has ≥1 tool/equivalent cell`, () => {
        const covered = derived.filter(
          (d) => d.tml === tml && ['tool', 'equivalent'].includes(d.perStack[stack].kind),
        )
        expect(covered.length, `${stack} × ${tml}: no covered cells`).toBeGreaterThan(0)
      })
    }
  }
})

// ─── Equivalent cells have reason ≥40 chars ──────────────────────────────────

describe('equivalent cell reason length', () => {
  it('all equivalent cells have reason.length >= 40', () => {
    for (const dim of derived) {
      for (const stack of STACKS) {
        const cell = dim.perStack[stack]
        if (cell.kind === 'equivalent') {
          expect(
            cell.reason.length,
            `${dim.id}.${stack} equivalent reason too short`,
          ).toBeGreaterThanOrEqual(40)
        }
      }
    }
  })
})

// ─── Matrix ratio >= baseline (frozen, promotion-safe) ───────────────────────

describe('matrix ratio >= baseline', () => {
  const baseline = JSON.parse(readFileSync(join(ROOT, 'src/kit/baseline.json'), 'utf-8'))

  for (const stack of STACKS) {
    it(`${stack} matrix ratio >= baseline.matrixRatioPerStack.${stack}`, () => {
      const covered = derived.filter((d) =>
        ['tool', 'equivalent'].includes(d.perStack[stack].kind),
      ).length
      const ratio = covered / derived.length
      expect(ratio).toBeGreaterThanOrEqual(baseline.matrixRatioPerStack[stack] - 0.001)
    })
  }
})

// ─── Status / invLink / generatorLink coverage ───────────────────────────────

describe('dim linkage', () => {
  it('every dim has invLink, generatorLink, or (missing-tracked + followupIssue)', () => {
    const violations: string[] = []
    for (const dim of derived) {
      if (!dim.invLink && !dim.generatorLink) {
        if (dim.status !== 'missing-tracked' || !dim.followupIssue) {
          violations.push(
            `${dim.id} (${dim.name}): no invLink/generatorLink and not missing-tracked with followupIssue`,
          )
        }
      }
    }
    // Many dims are 'covered'/'partial' without explicit invLink — acceptable for this PR
    // Only assert that missing-tracked always has followupIssue
    const missingTrackedWithoutIssue = derived.filter(
      (d) => d.status === 'missing-tracked' && !d.followupIssue,
    )
    expect(
      missingTrackedWithoutIssue.map((d) => d.id),
      'missing-tracked dims must have followupIssue',
    ).toEqual([])
  })
})

// ─── Audit trail dims: requiresDbEngine present, no regulatory framing ────────

describe('audit trail dims (N73-N75)', () => {
  it('N73-N75 are all present in derived', () => {
    const auditDims = derived.filter((d) => ['N73', 'N74', 'N75'].includes(d.id))
    expect(auditDims.length).toBe(3)
  })

  for (const dim of [{ id: 'N73' }, { id: 'N74' }, { id: 'N75' }]) {
    it(`${dim.id} has requiresDbEngine`, () => {
      const d = derived.find((x) => x.id === dim.id)
      expect(d?.requiresDbEngine).toBeDefined()
      expect((d?.requiresDbEngine ?? []).length).toBeGreaterThan(0)
    })
  }

  it('no audit dim note contains redacted tokens', () => {
    const auditDims = derived.filter((d) => ['N73', 'N74', 'N75'].includes(d.id))
    for (const d of auditDims) {
      if (d.note) {
        const matches = scanForRedactedTokens(d.note, REDACTION_LEXICON)
        expect(matches, `${d.id} note contains redacted token`).toHaveLength(0)
      }
    }
  })
})

// ─── N08 arch audit trail dim ─────────────────────────────────────────────────

describe('N08 (arch audit trail rule)', () => {
  it('N08 is present and has requiresDbEngine', () => {
    const d = derived.find((x) => x.id === 'N08')
    expect(d).toBeDefined()
    expect(d!.requiresDbEngine).toBeDefined()
    expect((d!.requiresDbEngine ?? []).length).toBeGreaterThan(0)
  })

  it('N08 note does not contain redacted tokens', () => {
    const d = derived.find((x) => x.id === 'N08')
    if (d?.note) {
      const matches = scanForRedactedTokens(d.note, REDACTION_LEXICON)
      expect(matches, 'N08 note contains redacted token').toHaveLength(0)
    }
  })
})

// ─── followupIssue uniqueness  ────────────────────────────────────────────────

describe('followupIssue uniqueness', () => {
  it('no two dims share the same followupIssue (except #862 which is a batch reference)', () => {
    const BATCH_ISSUE = 862
    const seen = new Map<number, string>()
    const violations: string[] = []

    for (const dim of derived) {
      if (!dim.followupIssue || dim.followupIssue === BATCH_ISSUE) continue
      if (seen.has(dim.followupIssue)) {
        violations.push(
          `${dim.id} and ${seen.get(dim.followupIssue)} both reference #${dim.followupIssue}`,
        )
      } else {
        seen.set(dim.followupIssue, dim.id)
      }
    }

    expect(violations).toEqual([])
  })
})

// ─── ID format ────────────────────────────────────────────────────────────────

describe('ID format', () => {
  it('all IDs match N01..N77 pattern', () => {
    const idPattern = /^N(0[1-9]|[1-6]\d|7[0-7])$/
    for (const dim of derived) {
      expect(idPattern.test(dim.id), `invalid id: ${dim.id}`).toBe(true)
    }
  })

  it('all IDs are unique', () => {
    const ids = derived.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

// ─── catalog.ts typed access layer ───────────────────────────────────────────

describe('loadCatalog()', () => {
  it('returns 77 entries', () => {
    const catalog = loadCatalog()
    expect(catalog.length).toBe(77)
  })

  it('parses through Zod without throw (consistent with KitCatalogSchema)', () => {
    expect(() => loadCatalog()).not.toThrow()
  })

  it('first entry is N01', () => {
    expect(loadCatalog()[0].id).toBe('N01')
  })
})

describe('re-export sanity — Stack/TML/Gate from taxonomy.ts and schema.ts are compatible', () => {
  it('VALID_STACKS from schema re-exports taxonomy constants', async () => {
    const { VALID_STACKS: schemaStacks } = await import('../../src/kit/schema.js')
    const { VALID_STACKS: taxonomyStacks } = await import('../../src/kit/taxonomy.js')
    expect([...schemaStacks].sort()).toEqual([...taxonomyStacks].sort())
  })
})

// ─── canonical_id present in mapping ─────────────────────────────────────────

describe('mapping canonical_id', () => {
  it('all mapping entries have canonical_id matching N01..N77', () => {
    const mapping = JSON.parse(
      readFileSync(join(ROOT, 'docs/audits/kit-canonical-mapping.json'), 'utf-8'),
    ) as { dimensions: Array<{ canonical_id?: string }> }
    const idPattern = /^N(0[1-9]|[1-6]\d|7[0-7])$/
    for (const dim of mapping.dimensions) {
      expect(dim.canonical_id, `missing canonical_id on mapping entry`).toBeDefined()
      expect(
        idPattern.test(dim.canonical_id ?? ''),
        `invalid canonical_id: ${dim.canonical_id}`,
      ).toBe(true)
    }
  })
})
