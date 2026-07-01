// SPDX-License-Identifier: Apache-2.0
// TDD guard for #1685 — the arbiter self-scan checkov step must be honestly
// SCOPED to the real IaC frameworks (terraform/kubernetes/dockerfile) via a
// checkov config file, not soft-fail-suppressed or `all`-scanned (INV-80).
// Reads the REAL materialized files (not a render) so it catches drift
// between the committed self workflow and the intended self-only scope.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'

const WORKFLOW_PATH = '.github/workflows/01-pr-fast.yml'
const CHECKOV_CONFIG_PATH = '.checkov.yaml'

function iacCheckovStep(workflow: string): string {
  const jobBody = (workflow.split('  iac-scan:')[1] ?? '').split(/\n {2}(?=\S)/)[0]
  const stepStart = jobBody.indexOf('bridgecrewio/checkov-action')
  expect(stepStart, 'checkov-action step must exist in iac-scan job').toBeGreaterThanOrEqual(0)
  // Slice from the `uses:` line to the next step dash (`\n      - `).
  const afterUses = jobBody.slice(stepStart)
  const nextStep = afterUses.indexOf('\n      - ', 1)
  return nextStep === -1 ? afterUses : afterUses.slice(0, nextStep)
}

describe('self iac-scan scope (#1685, INV-80)', () => {
  const workflow = readFileSync(WORKFLOW_PATH, 'utf-8')
  const checkovStep = iacCheckovStep(workflow)

  it('self checkov step is scoped via a config file, not `framework: all`', () => {
    expect(checkovStep).toContain('config_file: .checkov.yaml')
    expect(checkovStep).not.toMatch(/^\s*framework: all\s*$/m)
  })

  it('self checkov step keeps soft_fail: false (real misconfig still blocks)', () => {
    expect(checkovStep).toContain('soft_fail: false')
  })

  it('.checkov.yaml exists and scopes to real IaC frameworks only', () => {
    const raw = readFileSync(CHECKOV_CONFIG_PATH, 'utf-8')
    const parsed = parseYaml(raw) as { framework?: unknown; soft_fail?: unknown }
    expect(Array.isArray(parsed.framework)).toBe(true)
    const frameworks = parsed.framework as string[]
    const allowed = new Set(['terraform', 'kubernetes', 'dockerfile'])
    expect(frameworks.length).toBeGreaterThan(0)
    for (const fw of frameworks) {
      expect(allowed.has(fw), `unexpected framework "${fw}" — must be a real IaC framework`).toBe(
        true,
      )
    }
    expect(frameworks).toEqual(expect.arrayContaining(['terraform', 'kubernetes', 'dockerfile']))
    // Not `all`, not github_actions/secrets noise.
    expect(frameworks).not.toContain('all')
    expect(frameworks).not.toContain('github_actions')
    expect(frameworks).not.toContain('secrets')
  })

  it('.checkov.yaml does not hide findings via soft_fail or skip-* (scoped, not suppressed)', () => {
    const raw = readFileSync(CHECKOV_CONFIG_PATH, 'utf-8')
    const parsed = parseYaml(raw) as Record<string, unknown>
    expect(parsed.soft_fail).not.toBe(true)
    expect(parsed['skip-check']).toBeUndefined()
    expect(parsed['skip-framework']).toBeUndefined()
  })
})
