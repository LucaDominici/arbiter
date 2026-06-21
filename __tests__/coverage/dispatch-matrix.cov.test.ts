// SPDX-License-Identifier: Apache-2.0
//
// Branch-coverage climb for src/review/dispatch-matrix.ts (#1486).
// This module is pure I/O-at-the-edge: `loadDispatchMatrix` reads + structurally
// validates `<root>/.claude/agent-dispatch-matrix.json`, and the resolvers are pure
// functions over the loaded object. It has NO process.exit / spawn / git / gh seam —
// the only side effect is `readFileSync` of a fixed relative path under `root`. So we
// drive every validation branch by writing a real malformed/edge matrix into a
// `mkdtempSync` temp fixture and pointing `loadDispatchMatrix(tempRoot)` at it.
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadDispatchMatrix,
  resolveRequiredAgents,
  matrixVerticalsForTier,
  type DispatchMatrix,
  type DispatchKey,
} from '../../src/review/dispatch-matrix.js'

/** Roots created during the suite — torn down in afterEach for determinism. */
const createdRoots: string[] = []

/**
 * Write `<root>/.claude/agent-dispatch-matrix.json` containing `body` (verbatim string,
 * so we can inject syntactically-invalid JSON) and return the temp root.
 */
function writeMatrixRoot(body: string): string {
  const root = mkdtempSync(join(tmpdir(), 'dispatch-matrix-cov-'))
  createdRoots.push(root)
  mkdirSync(join(root, '.claude'), { recursive: true })
  writeFileSync(join(root, '.claude', 'agent-dispatch-matrix.json'), body, 'utf-8')
  return root
}

/** Same, but serializes a JS object to JSON for the structurally-typed cases. */
function writeMatrixObject(obj: unknown): string {
  return writeMatrixRoot(JSON.stringify(obj))
}

/** A fully-valid matrix object — the baseline every "one-field-broken" case mutates. */
function validMatrixObject(): Record<string, unknown> {
  return {
    axes: {
      tier: ['XS', 'S', 'Standard'],
      track: ['default', 'security'],
      review_mode: ['plan', 'code'],
      pr_type: ['feat', 'docs'],
    },
    tier_verticals: {
      XS: ['bugs', 'type-safety', 'domain'],
      S: ['bugs', 'type-safety', 'domain', 'test-quality'],
      Standard: ['bugs', 'type-safety', 'domain', 'test-quality', 'security'],
    },
    review_pass_count: {
      plan: { XS: 1, S: 3, Standard: 5 },
      code: { XS: 3, S: 3, Standard: 5 },
    },
    track_modifiers: {
      default: [],
      security: ['security'],
    },
    pr_type_modifiers: {
      feat: ['test-quality'],
      docs: [],
    },
  }
}

afterEach(() => {
  while (createdRoots.length > 0) {
    const root = createdRoots.pop()
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true })
    }
  }
})

describe('loadDispatchMatrix — happy path on a custom-written valid fixture', () => {
  it('parses a well-formed temp matrix into a fully-typed DispatchMatrix', () => {
    const root = writeMatrixRoot(JSON.stringify(validMatrixObject()))
    const m: DispatchMatrix = loadDispatchMatrix(root)
    expect(m.axes.tier).toEqual(['XS', 'S', 'Standard'])
    expect(m.axes.review_mode).toEqual(['plan', 'code'])
    expect(m.tier_verticals.Standard).toContain('security')
    expect(m.review_pass_count.code.Standard).toBe(5)
    expect(m.track_modifiers.security).toEqual(['security'])
    expect(m.pr_type_modifiers.feat).toEqual(['test-quality'])
  })
})

describe('readMatrixJson — read / parse / root-shape / required-key guards', () => {
  it('throws (fail-loud) when the matrix file is absent', () => {
    expect(() => loadDispatchMatrix('/nonexistent-dir-xyz-cov')).toThrow(/cannot read/)
  })

  it('throws on syntactically invalid JSON', () => {
    const root = writeMatrixRoot('{ not: valid json,,, ')
    expect(() => loadDispatchMatrix(root)).toThrow(/invalid JSON/)
  })

  it('throws when the root is an array (asRecord rejects Array)', () => {
    const root = writeMatrixRoot('[1, 2, 3]')
    expect(() => loadDispatchMatrix(root)).toThrow(/"root" must be an object/)
  })

  it('throws when the root is null (asRecord rejects null)', () => {
    const root = writeMatrixRoot('null')
    expect(() => loadDispatchMatrix(root)).toThrow(/"root" must be an object/)
  })

  it('throws when the root is a primitive (asRecord rejects non-object)', () => {
    const root = writeMatrixRoot('42')
    expect(() => loadDispatchMatrix(root)).toThrow(/"root" must be an object/)
  })

  it('throws on a missing required top-level key', () => {
    const obj = validMatrixObject()
    delete obj['pr_type_modifiers']
    const root = writeMatrixObject(obj)
    expect(() => loadDispatchMatrix(root)).toThrow(/missing required key "pr_type_modifiers"/)
  })
})

describe('parseAxes — each axis must be a string[] (isStringArray guard)', () => {
  it('throws when "axes" itself is not an object', () => {
    const obj = validMatrixObject()
    obj['axes'] = ['not', 'an', 'object']
    const root = writeMatrixObject(obj)
    expect(() => loadDispatchMatrix(root)).toThrow(/"axes" must be an object/)
  })

  it('throws when an axis is missing entirely (undefined is not a string[])', () => {
    const obj = validMatrixObject()
    delete (obj['axes'] as Record<string, unknown>)['tier']
    const root = writeMatrixObject(obj)
    expect(() => loadDispatchMatrix(root)).toThrow(/axes\.tier must be a string\[\]/)
  })

  it('throws when an axis is not an array at all', () => {
    const obj = validMatrixObject()
    ;(obj['axes'] as Record<string, unknown>)['track'] = 'security'
    const root = writeMatrixObject(obj)
    expect(() => loadDispatchMatrix(root)).toThrow(/axes\.track must be a string\[\]/)
  })

  it('throws when an axis array contains a non-string element', () => {
    const obj = validMatrixObject()
    ;(obj['axes'] as Record<string, unknown>)['review_mode'] = ['plan', 7]
    const root = writeMatrixObject(obj)
    expect(() => loadDispatchMatrix(root)).toThrow(/axes\.review_mode must be a string\[\]/)
  })
})

describe('parseReviewPassCount — nested non-negative-integer guard', () => {
  it('throws when review_pass_count is not an object', () => {
    const obj = validMatrixObject()
    obj['review_pass_count'] = 5
    const root = writeMatrixObject(obj)
    expect(() => loadDispatchMatrix(root)).toThrow(/"review_pass_count" must be an object/)
  })

  it('throws when a per-mode value is not an object', () => {
    const obj = validMatrixObject()
    ;(obj['review_pass_count'] as Record<string, unknown>)['plan'] = 3
    const root = writeMatrixObject(obj)
    expect(() => loadDispatchMatrix(root)).toThrow(/"review_pass_count\.plan" must be an object/)
  })

  it('throws when a count is not a number', () => {
    const obj = validMatrixObject()
    ;(obj['review_pass_count'] as Record<string, Record<string, unknown>>)['plan']['XS'] = 'one'
    const root = writeMatrixObject(obj)
    expect(() => loadDispatchMatrix(root)).toThrow(
      /review_pass_count\.plan\.XS must be a non-negative integer/,
    )
  })

  it('throws when a count is a non-integer number', () => {
    const obj = validMatrixObject()
    ;(obj['review_pass_count'] as Record<string, Record<string, unknown>>)['plan']['XS'] = 2.5
    const root = writeMatrixObject(obj)
    expect(() => loadDispatchMatrix(root)).toThrow(
      /review_pass_count\.plan\.XS must be a non-negative integer/,
    )
  })

  it('throws when a count is negative', () => {
    const obj = validMatrixObject()
    ;(obj['review_pass_count'] as Record<string, Record<string, unknown>>)['code']['XS'] = -1
    const root = writeMatrixObject(obj)
    expect(() => loadDispatchMatrix(root)).toThrow(
      /review_pass_count\.code\.XS must be a non-negative integer/,
    )
  })
})

describe('coerceStringArrayMap — value-shape guard for the three modifier maps', () => {
  it('throws when tier_verticals is not an object', () => {
    const obj = validMatrixObject()
    obj['tier_verticals'] = 'oops'
    const root = writeMatrixObject(obj)
    expect(() => loadDispatchMatrix(root)).toThrow(/"tier_verticals" must be an object/)
  })

  it('throws when a tier_verticals entry is not a string[]', () => {
    const obj = validMatrixObject()
    ;(obj['tier_verticals'] as Record<string, unknown>)['XS'] = [1, 2]
    const root = writeMatrixObject(obj)
    expect(() => loadDispatchMatrix(root)).toThrow(/tier_verticals\.XS must be a string\[\]/)
  })

  it('throws when a track_modifiers entry is not a string[]', () => {
    const obj = validMatrixObject()
    ;(obj['track_modifiers'] as Record<string, unknown>)['default'] = 'nope'
    const root = writeMatrixObject(obj)
    expect(() => loadDispatchMatrix(root)).toThrow(/track_modifiers\.default must be a string\[\]/)
  })

  it('throws when a pr_type_modifiers entry is not a string[]', () => {
    const obj = validMatrixObject()
    ;(obj['pr_type_modifiers'] as Record<string, unknown>)['feat'] = { x: 1 }
    const root = writeMatrixObject(obj)
    expect(() => loadDispatchMatrix(root)).toThrow(/pr_type_modifiers\.feat must be a string\[\]/)
  })
})

describe('matrixVerticalsForTier — floor projection + unknown-tier guard', () => {
  it('returns a fresh copy (defensive clone) of the tier floor', () => {
    const root = writeMatrixRoot(JSON.stringify(validMatrixObject()))
    const m = loadDispatchMatrix(root)
    const floor = matrixVerticalsForTier(m, 'XS')
    expect(floor).toEqual(['bugs', 'type-safety', 'domain'])
    floor.push('mutated')
    // The internal table must be untouched by the caller's mutation.
    expect(matrixVerticalsForTier(m, 'XS')).toEqual(['bugs', 'type-safety', 'domain'])
  })

  it('throws fail-loud for a tier with no tier_verticals entry', () => {
    const root = writeMatrixRoot(JSON.stringify(validMatrixObject()))
    const m = loadDispatchMatrix(root)
    expect(() => matrixVerticalsForTier(m, 'Gigantic')).toThrow(
      /no tier_verticals for tier "Gigantic"/,
    )
  })
})

describe('resolveRequiredAgents — union resolution, fallbacks, and axis guards', () => {
  it('unions tier floor + track modifier + pr_type modifier in first-seen order (dedup)', () => {
    const root = writeMatrixRoot(JSON.stringify(validMatrixObject()))
    const m = loadDispatchMatrix(root)
    const key: DispatchKey = {
      tier: 'Standard',
      track: 'security',
      review_mode: 'code',
      pr_type: 'feat',
    }
    const got = resolveRequiredAgents(m, key)
    // floor already contains security + test-quality, so the modifiers add nothing new:
    // the union must NOT duplicate them.
    expect(got.agents).toEqual([
      'bugs',
      'type-safety',
      'domain',
      'test-quality',
      'security',
    ])
    expect(got.passCount).toBe(5)
  })

  it('falls back to [] for a track present in the axis but absent from track_modifiers', () => {
    const obj = validMatrixObject()
    // 'extra' is a legal axis value but has no modifier entry → trackMod ?? [] branch.
    ;(obj['axes'] as Record<string, string[]>)['track'].push('extra')
    const root = writeMatrixObject(obj)
    const m = loadDispatchMatrix(root)
    const got = resolveRequiredAgents(m, {
      tier: 'XS',
      track: 'extra',
      review_mode: 'plan',
      pr_type: 'docs',
    })
    // XS floor only; docs modifier is [], extra track has no entry → []
    expect(got.agents).toEqual(['bugs', 'type-safety', 'domain'])
    expect(got.passCount).toBe(1)
  })

  it('falls back to [] for a pr_type present in the axis but absent from pr_type_modifiers', () => {
    const obj = validMatrixObject()
    ;(obj['axes'] as Record<string, string[]>)['pr_type'].push('style')
    const root = writeMatrixObject(obj)
    const m = loadDispatchMatrix(root)
    const got = resolveRequiredAgents(m, {
      tier: 'XS',
      track: 'default',
      review_mode: 'plan',
      pr_type: 'style',
    })
    expect(got.agents).toEqual(['bugs', 'type-safety', 'domain'])
  })

  it('falls back to passCount 0 when the review_mode has no per-tier entry', () => {
    const obj = validMatrixObject()
    // Add a legal review_mode axis value with NO review_pass_count map → perMode undefined.
    ;(obj['axes'] as Record<string, string[]>)['review_mode'].push('audit')
    const root = writeMatrixObject(obj)
    const m = loadDispatchMatrix(root)
    const got = resolveRequiredAgents(m, {
      tier: 'XS',
      track: 'default',
      review_mode: 'audit' as DispatchKey['review_mode'],
      pr_type: 'docs',
    })
    expect(got.passCount).toBe(0)
  })

  it('falls back to passCount 0 when the tier is absent from a present per-mode map', () => {
    const obj = validMatrixObject()
    // Legal tier axis value, has tier_verticals, but no entry in review_pass_count.plan.
    ;(obj['axes'] as Record<string, string[]>)['tier'].push('XL')
    ;(obj['tier_verticals'] as Record<string, string[]>)['XL'] = ['bugs']
    const root = writeMatrixObject(obj)
    const m = loadDispatchMatrix(root)
    const got = resolveRequiredAgents(m, {
      tier: 'XL' as DispatchKey['tier'],
      track: 'default',
      review_mode: 'plan',
      pr_type: 'docs',
    })
    // perMode (plan) exists but has no XL key → ?? 0
    expect(got.passCount).toBe(0)
    expect(got.agents).toEqual(['bugs'])
  })

  it('throws fail-loud on an unknown tier (assertAxis)', () => {
    const root = writeMatrixRoot(JSON.stringify(validMatrixObject()))
    const m = loadDispatchMatrix(root)
    expect(() =>
      resolveRequiredAgents(m, {
        tier: 'Huge' as DispatchKey['tier'],
        track: 'default',
        review_mode: 'code',
        pr_type: 'feat',
      }),
    ).toThrow(/unknown tier "Huge"/)
  })

  it('throws fail-loud on an unknown track (assertAxis)', () => {
    const root = writeMatrixRoot(JSON.stringify(validMatrixObject()))
    const m = loadDispatchMatrix(root)
    expect(() =>
      resolveRequiredAgents(m, {
        tier: 'XS',
        track: 'made-up',
        review_mode: 'code',
        pr_type: 'feat',
      }),
    ).toThrow(/unknown track "made-up"/)
  })

  it('throws fail-loud on an unknown review_mode (assertAxis)', () => {
    const root = writeMatrixRoot(JSON.stringify(validMatrixObject()))
    const m = loadDispatchMatrix(root)
    expect(() =>
      resolveRequiredAgents(m, {
        tier: 'XS',
        track: 'default',
        review_mode: 'review' as DispatchKey['review_mode'],
        pr_type: 'feat',
      }),
    ).toThrow(/unknown review_mode "review"/)
  })

  it('throws fail-loud on an unknown pr_type (assertAxis)', () => {
    const root = writeMatrixRoot(JSON.stringify(validMatrixObject()))
    const m = loadDispatchMatrix(root)
    expect(() =>
      resolveRequiredAgents(m, {
        tier: 'XS',
        track: 'default',
        review_mode: 'code',
        pr_type: 'merge',
      }),
    ).toThrow(/unknown pr_type "merge"/)
  })
})
