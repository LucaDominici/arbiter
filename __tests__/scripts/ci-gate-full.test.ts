// SPDX-License-Identifier: Apache-2.0
// Red tests for #1225 — gate-full CI job in committed workflow + EJS template.
// These fail with the current code (no gate-full job exists).
// Green after: 01-pr-fast.yml + 01-pr-fast.yml.ejs both have gate-full job
// running check-all.mjs --level L2, plus 06-nightly.yml has gate-full running check-all full.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'

const ROOT = process.cwd()

function readWorkflow(name: string): string {
  return readFileSync(join(ROOT, '.github', 'workflows', name), 'utf-8')
}

const renderCtx = JSON.parse(
  readFileSync(join(ROOT, '__tests__', 'fixtures', 'ci-tier-render-context.json'), 'utf-8'),
)

describe('CI gate-full job (#1225)', () => {
  it('01-pr-fast.yml has gate-full job', () => {
    const yml = readWorkflow('01-pr-fast.yml')
    expect(yml).toMatch(/^\s{2}gate-full:/m)
  })

  it('gate-full runs check-all.mjs --level L2 in 01-pr-fast.yml', () => {
    const yml = readWorkflow('01-pr-fast.yml')
    // gate-full job must invoke the full L2 gate
    expect(yml).toMatch(/check-all\.mjs.*--level L2|check-all\.mjs.*L2/m)
  })

  it('gate-full uploads gate-result artifact in 01-pr-fast.yml', () => {
    const yml = readWorkflow('01-pr-fast.yml')
    expect(yml).toMatch(/gate-result/)
    expect(yml).toMatch(/upload-artifact/i)
  })

  it('gate-full is gating (in ci-required needs) in 01-pr-fast.yml', () => {
    const yml = readWorkflow('01-pr-fast.yml')
    // ci-required job must have gate-full in its needs list
    const ciRequiredSection = yml.split(/^\s{2}ci-required:/m)[1]
    expect(ciRequiredSection).toBeTruthy()
    expect(ciRequiredSection.substring(0, 500)).toMatch(/gate-full/)
  })

  it('_nightly.yml (reusable partial, #1691) has a gate-full / full-gate job running check-all.mjs', () => {
    // #1691: gate-full-nightly job lives in the reusable partial, not the thin caller.
    const yml = readWorkflow('_nightly.yml')
    expect(yml).toMatch(/gate-full|full-gate/)
    expect(yml).toMatch(/check-all\.mjs/)
  })
})

describe('CI gate-full EJS template (#1225, CANON-01)', () => {
  it('rendered 01-pr-fast.yml.ejs at L2 contains gate-full job', () => {
    const rendered = renderTemplate('github/workflows/01-pr-fast.yml.ejs', renderCtx)
    expect(rendered).toMatch(/^\s{2}gate-full:/m)
  })

  it('rendered 01-pr-fast.yml.ejs gate-full runs check-all L2', () => {
    const rendered = renderTemplate('github/workflows/01-pr-fast.yml.ejs', renderCtx)
    expect(rendered).toMatch(/check-all\.mjs.*--level L2|check-all\.mjs.*L2/m)
  })

  it('rendered 01-pr-fast.yml.ejs at L1 does NOT have gate-full (not applicable at L1)', () => {
    const l1Ctx = { ...renderCtx, governanceLevel: 'L1' }
    const rendered = renderTemplate('github/workflows/01-pr-fast.yml.ejs', l1Ctx)
    expect(rendered).not.toMatch(/^\s{2}gate-full:/m)
  })

  it('rendered _nightly.yml.ejs (reusable partial, #1691) contains gate-full/full-gate job', () => {
    // #1691: gate-full-nightly job lives in the reusable partial, not the thin caller.
    const rendered = renderTemplate('github/workflows/_nightly.yml.ejs', renderCtx)
    expect(rendered).toMatch(/gate-full|full-gate/)
    expect(rendered).toMatch(/check-all\.mjs/)
  })
})
