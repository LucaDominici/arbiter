// SPDX-License-Identifier: Apache-2.0
// SSOT completeness for the smoke-journey acceptance-floor gate (#2080, INV-137).
//
// Fail-closed half of the gate-skip strategy: the gate SKIPs when the manifest is absent;
// these tests enforce that arbiter's own smoke-journeys.json is always present and that the
// self gate script is byte-equal to the rendered template (Track A == Track B).
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { makeConfig } from '../helpers.js'
import { renderTemplate } from '../../src/utils/render.js'

const MANIFEST_PATH = resolve('smoke-journeys.json')
const SELF_GATE_PATH = resolve('scripts/check-smoke-journeys.mjs')

describe('arbiter self smoke-journeys.json SSOT (INV-137)', () => {
  it('smoke-journeys.json exists at repo root', () => {
    expect(existsSync(MANIFEST_PATH)).toBe(true)
  })

  it('arbiter is a library archetype ⇒ applicable:false (no interactive journeys)', () => {
    const m = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'))
    expect(m.archetype).toBe('library')
    expect(m.applicable).toBe(false)
    expect(typeof m.reason).toBe('string')
    expect(m.reason.length).toBeGreaterThan(20)
  })
})

describe('check-smoke-journeys self gate is byte-equal to the rendered template', () => {
  it('scripts/check-smoke-journeys.mjs == renderTemplate(check-smoke-journeys.mjs.ejs)', () => {
    expect(existsSync(SELF_GATE_PATH)).toBe(true)
    const rendered = renderTemplate('scripts/check-smoke-journeys.mjs.ejs', {
      ...makeConfig('/tmp/render-smoke-journeys-ssot', { language: 'typescript' }),
    } as unknown as Record<string, unknown>)
    const onDisk = readFileSync(SELF_GATE_PATH, 'utf-8')
    expect(onDisk).toBe(rendered)
  })
})
