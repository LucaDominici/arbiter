// SPDX-License-Identifier: Apache-2.0
//
// #1259 — ship ALWAYS computes affinity + low-affinity warning, end-to-end wiring.
// Tests the composition seam used by the `arbiter ship` CLI action (injectable
// fetcher so no real `gh` call is needed).
import { describe, it, expect } from 'vitest'
import { renderShipAffinity, type AffinityFetcher } from '../../src/affinity/affinity.js'

const correlatedFetcher: AffinityFetcher = () => ({
  subject: { id: '#1259', labels: ['domain:dx', 'type:feat'], milestone: 'M5' },
  candidates: [{ id: '#1260', labels: ['domain:dx', 'type:feat'], milestone: 'M5' }], // 4
})

const lowFetcher: AffinityFetcher = () => ({
  subject: { id: '#1259', labels: ['domain:dx'], milestone: 'M5' },
  candidates: [{ id: '#9', labels: ['type:other'] }], // 0
})

const soloFetcher: AffinityFetcher = () => ({
  subject: { id: '#1259', labels: ['domain:dx'], milestone: 'M5' },
  candidates: [],
})

const failingFetcher: AffinityFetcher = () => {
  throw new Error('gh offline')
}

describe('renderShipAffinity — always-on, non-blocking', () => {
  it('always returns at least one Affinity line (unconditional)', () => {
    const lines = renderShipAffinity('#1259', { fetch: correlatedFetcher })
    expect(lines.some((l) => /Affinity/i.test(l))).toBe(true)
  })

  it('emits a WARNING when the computed affinity is below threshold', () => {
    const lines = renderShipAffinity('#1259', { fetch: lowFetcher })
    expect(lines.some((l) => /WARN/i.test(l) && /affinity/i.test(l))).toBe(true)
  })

  it('does NOT warn when correlated', () => {
    const lines = renderShipAffinity('#1259', { fetch: correlatedFetcher })
    expect(lines.some((l) => /WARN/i.test(l))).toBe(false)
  })

  it('a solo issue (no siblings) is reported and does not crash', () => {
    const lines = renderShipAffinity('#1259', { fetch: soloFetcher })
    expect(lines.some((l) => /Affinity/i.test(l))).toBe(true)
    expect(lines.some((l) => /solo|no .*sibling|no correlated/i.test(l))).toBe(true)
  })

  it('degrades to an advisory (never throws) when the fetch fails', () => {
    expect(() => renderShipAffinity('#1259', { fetch: failingFetcher })).not.toThrow()
    const lines = renderShipAffinity('#1259', { fetch: failingFetcher })
    expect(lines.some((l) => /unavailable|could not/i.test(l))).toBe(true)
  })
})
