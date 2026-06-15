// SPDX-License-Identifier: Apache-2.0
// SSOT completeness for the live-API e2e gate (#1365, INV-126).
//
// Fail-closed half of the gate-skip strategy: the gate SKIPs when the manifest is
// absent; these tests enforce that arbiter's own api-e2e.json is always present and
// that the self gate script is byte-equal to the rendered template (Track A == Track B).
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { makeConfig } from '../helpers.js'
import { renderTemplate } from '../../src/utils/render.js'

const MANIFEST_PATH = resolve('api-e2e.json')
const SELF_GATE_PATH = resolve('scripts/check-api-e2e.mjs')

describe('arbiter self api-e2e.json SSOT (INV-126)', () => {
  it('api-e2e.json exists at repo root', () => {
    expect(existsSync(MANIFEST_PATH)).toBe(true)
  })

  it('arbiter is library archetype ⇒ required:false (arbiter is not a service)', () => {
    const m = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'))
    expect(m.archetype).toBe('library')
    expect(m.required).toBe(false)
  })
})

describe('check-api-e2e self gate is byte-equal to the rendered template', () => {
  it('scripts/check-api-e2e.mjs == renderTemplate(check-api-e2e.mjs.ejs)', () => {
    expect(existsSync(SELF_GATE_PATH)).toBe(true)
    const rendered = renderTemplate('scripts/check-api-e2e.mjs.ejs', {
      ...makeConfig('/tmp/render-api-e2e-ssot', { language: 'typescript' }),
    } as unknown as Record<string, unknown>)
    const onDisk = readFileSync(SELF_GATE_PATH, 'utf-8')
    expect(onDisk).toBe(rendered)
  })
})
