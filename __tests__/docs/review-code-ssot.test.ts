// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const doc = readFileSync(resolve('.claude/commands/review.md'), 'utf-8')

describe('.claude/commands/review.md — adaptive treatment consumer (#2681)', () => {
  it('uses persisted ShipTreatment instead of a second routing authority', () => {
    expect(doc).toMatch(/persisted\s+`ShipTreatment`/)
    expect(doc).not.toContain('tier_verticals')
    expect(doc).not.toContain('--size-floor')
  })

  it('uses one final reviewer for code and acceptance on one frozen subject', () => {
    expect(doc).toContain('same plan, diff, SHA')
    expect(doc).toContain('final reviewer also returns acceptance fit')
    expect(doc).toContain('--mode ac-fit')
  })

  it('records and checks one complete reviewer panel', () => {
    expect(doc).toContain('record-agent-return.mjs --mode reviewer-panel')
    expect(doc).toContain('check-review-completion.mjs')
  })

  it('bounds rework and blocks applicable material findings', () => {
    expect(doc).toContain('one fix batch')
    expect(doc).toContain('MED/HIGH/CRITICAL')
    expect(doc).toContain('Two rounds is the normal cap')
  })
})
