// SPDX-License-Identifier: Apache-2.0
// RED tests for #1251 — GDPR overlay generator (controls→gates).
// These fail until src/generators/gdpr.ts exists and is dispatched from generatePharma.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateGdprControls } from '../../src/generators/gdpr.js'
import { generatePharma } from '../../src/generators/pharma.js'

let dir: string

beforeEach(() => {
  dir = createTestProject('typescript')
})

afterEach(() => {
  cleanupTestProject(dir)
})

function gdprConfig(overrides = {}) {
  return makeConfig(dir, {
    language: 'typescript',
    projectName: 'gdpr-app',
    industryOverlay: 'gdpr',
    ...overrides,
  })
}

describe('generateGdprControls (#1251)', () => {
  // ─── Emission ───────────────────────────────────────────────────────────────

  it('emits a non-empty file set for industryOverlay=gdpr', () => {
    const result = generateGdprControls(gdprConfig())
    expect(result.length).toBeGreaterThan(0)
  })

  it('emits the enforceable controls gate script scripts/check-gdpr-controls.mjs', () => {
    const result = generateGdprControls(gdprConfig())
    const gate = result.find((f) => f.path.endsWith('scripts/check-gdpr-controls.mjs'))
    expect(gate).toBeDefined()
    expect(gate!.action).toBe('created')
    expect(existsSync(gate!.path)).toBe(true)
  })

  it('emits the DPIA doc', () => {
    const result = generateGdprControls(gdprConfig())
    const dpia = result.find((f) => f.path.endsWith('docs/compliance/gdpr/dpia.md'))
    expect(dpia).toBeDefined()
    const content = readFileSync(dpia!.path, 'utf-8')
    expect(content).toContain('Data Protection Impact Assessment')
  })

  it('emits the data-flow map doc', () => {
    const result = generateGdprControls(gdprConfig())
    const flow = result.find((f) => f.path.endsWith('docs/compliance/gdpr/data-flow-map.md'))
    expect(flow).toBeDefined()
    const content = readFileSync(flow!.path, 'utf-8')
    expect(content).toContain('Data-Flow Map')
  })

  it('emits the controls→gate traceability doc', () => {
    const result = generateGdprControls(gdprConfig())
    const trace = result.find((f) => f.path.endsWith('docs/compliance/gdpr/controls-to-gates.md'))
    expect(trace).toBeDefined()
    const content = readFileSync(trace!.path, 'utf-8')
    // Traceability doc must map each control to the gate that enforces it.
    expect(content).toContain('GDPR-')
    expect(content).toContain('check-gdpr-controls.mjs')
  })

  it('the gate script references retention/erasure and consent/lawful-basis controls', () => {
    const result = generateGdprControls(gdprConfig())
    const gate = result.find((f) => f.path.endsWith('scripts/check-gdpr-controls.mjs'))
    const content = readFileSync(gate!.path, 'utf-8')
    expect(content).toContain('erasure')
    expect(content).toContain('consent')
  })

  // ─── Enforceability (both directions) ────────────────────────────────────────

  it('generated gate passes (exit 0) on a freshly-generated gdpr project', () => {
    generateGdprControls(gdprConfig())
    // Should not throw — exit 0.
    const out = execFileSync('node', ['scripts/check-gdpr-controls.mjs'], {
      cwd: dir,
      encoding: 'utf-8',
    })
    expect(out).toMatch(/OK/)
  })

  it('generated gate FAILS (exit 1) when a required control artifact is missing', () => {
    generateGdprControls(gdprConfig())
    // Remove a required artifact → gate must red-out.
    rmSync(`${dir}/docs/compliance/gdpr/dpia.md`)
    let failed = false
    try {
      execFileSync('node', ['scripts/check-gdpr-controls.mjs'], { cwd: dir, encoding: 'utf-8' })
    } catch {
      failed = true
    }
    expect(failed).toBe(true)
  })

  // ─── Idempotency ─────────────────────────────────────────────────────────────

  it('is idempotent — second run returns skipped', () => {
    generateGdprControls(gdprConfig())
    const second = generateGdprControls(gdprConfig())
    for (const f of second) {
      expect(f.action).toBe('skipped')
    }
  })
})

describe('generatePharma dispatch → gdpr (#1251)', () => {
  it('routes industryOverlay=gdpr through the gdpr controls generator (enforceable, not docs-only)', () => {
    const result = generatePharma(gdprConfig())
    const gate = result.files.find((f) => f.path.endsWith('scripts/check-gdpr-controls.mjs'))
    expect(gate).toBeDefined()
  })

  it('still emits the generic audit docs for gdpr (composed, not replaced)', () => {
    const result = generatePharma(gdprConfig())
    const policy = result.files.find((f) => f.path.endsWith('audit-trail-policy.md'))
    expect(policy).toBeDefined()
  })

  it('does NOT emit gdpr controls for the sox overlay', () => {
    const result = generatePharma(gdprConfig({ industryOverlay: 'sox' }))
    const gate = result.files.find((f) => f.path.endsWith('scripts/check-gdpr-controls.mjs'))
    expect(gate).toBeUndefined()
  })
})

describe('gdpr overlay stackability (#1251)', () => {
  it('coexists with enableIso27001Mapping without file collisions', () => {
    const result = generatePharma(gdprConfig({ enableIso27001Mapping: true }))
    const paths = result.files.map((f) => f.path)
    const unique = new Set(paths)
    expect(unique.size).toBe(paths.length)
    expect(paths.some((p) => p.endsWith('scripts/check-gdpr-controls.mjs'))).toBe(true)
  })
})
