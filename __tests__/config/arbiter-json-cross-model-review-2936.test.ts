// SPDX-License-Identifier: Apache-2.0
// #2936 — Arbiter's own arbiter.json must enable crossModelReview, with owner diff-egress
// consent (2026-09-26) and every schema field explicit, so a reader never has to fall back
// to an implicit default to know what ships to OpenAI.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateConfig } from '../../src/config/schema.js'
import type { CrossModelReviewConfig } from '../../src/wizard/types.js'

const REPO_ROOT = join(process.cwd())

// Tied to CrossModelReviewConfig (src/wizard/types.ts) at the TYPE level: `satisfies` makes this
// a compile error (tsc / tsconfig.eslint.json, which includes __tests__) the moment the interface
// gains or loses a field and this map isn't updated to match — so the field list itself cannot go
// stale unnoticed. The runtime exhaustiveness check below then ties arbiter.json's actual keys to
// this map.
const CROSS_MODEL_REVIEW_FIELD_MAP = {
  enabled: true,
  diffEgressConsent: true,
  providers: true,
  slots: true,
  timeoutMs: true,
  onUnavailable: true,
  model: true,
  effort: true,
} satisfies Record<keyof Required<CrossModelReviewConfig>, true>
const CROSS_MODEL_REVIEW_FIELDS = Object.keys(CROSS_MODEL_REVIEW_FIELD_MAP)

describe('arbiter.json — crossModelReview (#2936)', () => {
  const raw = JSON.parse(readFileSync(join(REPO_ROOT, 'arbiter.json'), 'utf-8')) as Record<
    string,
    unknown
  >

  it('is schema-valid per the project validator', () => {
    const result = validateConfig(raw)
    expect(result.ok, result.ok ? '' : JSON.stringify(result.errors)).toBe(true)
  })

  it('has a crossModelReview block', () => {
    expect(raw['crossModelReview']).toBeDefined()
    expect(typeof raw['crossModelReview']).toBe('object')
  })

  it('has owner diff-egress consent and is enabled (2026-09-26, issue #2936)', () => {
    const cfg = raw['crossModelReview'] as Record<string, unknown>
    expect(cfg['enabled']).toBe(true)
    expect(cfg['diffEgressConsent']).toBe(true)
  })

  it('declares every CrossModelReviewConfig field explicitly (no implicit default)', () => {
    const cfg = raw['crossModelReview'] as Record<string, unknown>
    for (const field of CROSS_MODEL_REVIEW_FIELDS) {
      expect(cfg, `crossModelReview.${field} must be explicit`).toHaveProperty(field)
    }
    // Exhaustiveness: no key on the live object that this test doesn't know about, and vice
    // versa — keeps the field list from silently going stale in either direction.
    expect(Object.keys(cfg).sort()).toEqual([...CROSS_MODEL_REVIEW_FIELDS].sort())
  })

  it('uses the #2905 reviewer engine defaults unless a reason is recorded', () => {
    const cfg = raw['crossModelReview'] as Record<string, unknown>
    expect(cfg['model']).toBe('gpt-6-luna')
    expect(cfg['effort']).toBe('max')
  })
})
