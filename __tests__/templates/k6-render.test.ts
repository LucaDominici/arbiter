// SPDX-License-Identifier: Apache-2.0
// CANON-04: render tests for F6 k6 perf ecosystem EJS templates (#895)

import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function makeData(overrides: Record<string, unknown> = {}) {
  return makeConfig('/tmp/test', {
    language: 'typescript',
    archetype: 'backend-web-db',
    projectName: 'my-service',
    governanceLevel: 'L2',
    enablePerfTesting: true,
    ...overrides,
  } as Parameters<typeof makeConfig>[1]) as unknown as Record<string, unknown>
}

// ─── Workflow templates ───────────────────────────────────────────────────────

describe('11-k6-on-demand.yml.ejs — render invariants (CANON-04, #895)', () => {
  it('renders without EJS errors', () => {
    expect(() =>
      renderTemplate('github/workflows/11-k6-on-demand.yml.ejs', makeData()),
    ).not.toThrow()
  })

  it('workflow name is "k6 Load Tests (on-demand)"', () => {
    const rendered = renderTemplate('github/workflows/11-k6-on-demand.yml.ejs', makeData())
    expect(rendered).toContain('k6 Load Tests')
  })

  it('triggered by workflow_dispatch', () => {
    const rendered = renderTemplate('github/workflows/11-k6-on-demand.yml.ejs', makeData())
    expect(rendered).toContain('workflow_dispatch')
  })

  it('calls the k6-runner reusable workflow', () => {
    const rendered = renderTemplate('github/workflows/11-k6-on-demand.yml.ejs', makeData())
    expect(rendered).toContain('_k6-runner.yml')
  })
})

describe('_k6-runner.yml.ejs — render invariants (CANON-04, #895)', () => {
  it('renders without EJS errors', () => {
    expect(() => renderTemplate('github/workflows/_k6-runner.yml.ejs', makeData())).not.toThrow()
  })

  it('is a reusable workflow (workflow_call)', () => {
    const rendered = renderTemplate('github/workflows/_k6-runner.yml.ejs', makeData())
    expect(rendered).toContain('workflow_call')
  })

  it('installs k6', () => {
    const rendered = renderTemplate('github/workflows/_k6-runner.yml.ejs', makeData())
    expect(rendered).toContain('k6')
  })

  // #1660: workflow_dispatch inputs must reach the shell via env: indirection, never
  // interpolated as ${{ inputs.* }} inside a run: body (GitHub Actions template-injection
  // seam). Mirrors the rule documented in issue-state.yml.ejs / _notify.yml.ejs.
  it('forwards dispatch inputs via env: and references shell vars in run bodies (#1660)', () => {
    const rendered = renderTemplate('github/workflows/_k6-runner.yml.ejs', makeData())
    // env: mappings carry the untrusted values
    expect(rendered).toContain('TARGET_URL: ${{ inputs.target_url }}')
    expect(rendered).toContain('VUS: ${{ inputs.vus }}')
    expect(rendered).toContain('DURATION: ${{ inputs.duration }}')
    expect(rendered).toContain('SCENARIO: ${{ inputs.scenario }}')
    // run: bodies reference the shell vars, not the splice
    expect(rendered).toContain('echo "K6_BASE_URL=$TARGET_URL"')
  })

  it('no ${{ inputs.* }} interpolation survives inside a run: body (#1660)', () => {
    const rendered = renderTemplate('github/workflows/_k6-runner.yml.ejs', makeData())
    // the exact injectable splices the verbatim template shipped
    expect(rendered).not.toContain('echo "K6_BASE_URL=${{ inputs.target_url }}"')
    expect(rendered).not.toContain('SCENARIO="${{ inputs.scenario }}"')
    expect(rendered).not.toContain('if [ -n "${{ inputs.vus }}" ]')
  })
})

// ─── Scenario templates ───────────────────────────────────────────────────────

const SCENARIO_TEMPLATES = [
  'load.js.ejs',
  'stress.js.ejs',
  'spike.js.ejs',
  'soak.js.ejs',
  'volume.js.ejs',
  'breakpoint.js.ejs',
  'smoke.js.ejs',
  'ramp-up.js.ejs',
  'ramp-down.js.ejs',
  'steady-state.js.ejs',
  'burst.js.ejs',
  'endurance.js.ejs',
]

describe('k6 scenario templates — render invariants (CANON-04, #895)', () => {
  it.each(SCENARIO_TEMPLATES)('%s renders without EJS errors', (tpl) => {
    expect(() => renderTemplate(`perf/k6/scenarios/${tpl}`, makeData())).not.toThrow()
  })

  it.each(SCENARIO_TEMPLATES)('%s contains k6 entry point "export default function"', (tpl) => {
    const rendered = renderTemplate(`perf/k6/scenarios/${tpl}`, makeData())
    expect(rendered).toContain('export default function')
  })

  it.each(SCENARIO_TEMPLATES)('%s imports from k6', (tpl) => {
    const rendered = renderTemplate(`perf/k6/scenarios/${tpl}`, makeData())
    expect(rendered).toContain("from 'k6")
  })
})

// ─── Report generator templates ───────────────────────────────────────────────

const REPORT_TEMPLATES = ['html-report.py.ejs', 'json-report.py.ejs', 'csv-report.py.ejs']

describe('k6 report generator templates — render invariants (CANON-04, #895)', () => {
  it.each(REPORT_TEMPLATES)('%s renders without EJS errors', (tpl) => {
    expect(() => renderTemplate(`perf/k6/reports/${tpl}`, makeData())).not.toThrow()
  })

  it.each(REPORT_TEMPLATES)('%s contains Python shebang or import', (tpl) => {
    const rendered = renderTemplate(`perf/k6/reports/${tpl}`, makeData())
    expect(rendered.includes('#!/usr/bin/env python') || rendered.includes('import ')).toBe(true)
  })
})

// ─── Validator script ─────────────────────────────────────────────────────────

describe('validate-k6-scenarios.mjs.ejs — render invariants (CANON-04, #895)', () => {
  it('renders without EJS errors', () => {
    expect(() => renderTemplate('scripts/validate-k6-scenarios.mjs.ejs', makeData())).not.toThrow()
  })

  it('contains "export default function" check logic', () => {
    const rendered = renderTemplate('scripts/validate-k6-scenarios.mjs.ejs', makeData())
    expect(rendered).toContain('export default function')
  })

  it('is non-empty', () => {
    const rendered = renderTemplate('scripts/validate-k6-scenarios.mjs.ejs', makeData())
    expect(rendered.trim().length).toBeGreaterThan(50)
  })
})

// ─── Seed SQL ─────────────────────────────────────────────────────────────────

describe('perf/k6/seed/test-data.sql.ejs — render invariants (CANON-04, #895)', () => {
  it('renders without EJS errors', () => {
    expect(() => renderTemplate('perf/k6/seed/test-data.sql.ejs', makeData())).not.toThrow()
  })

  it('is non-empty SQL', () => {
    const rendered = renderTemplate('perf/k6/seed/test-data.sql.ejs', makeData())
    expect(rendered.trim().length).toBeGreaterThan(10)
  })
})
