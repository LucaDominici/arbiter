// SPDX-License-Identifier: Apache-2.0
// CANON-04 + CANON-18: render tests for Postman/Newman EJS templates (#894)

import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderRunPostman(overrides: Record<string, unknown> = {}) {
  const data = makeConfig('/tmp/test', {
    language: 'java',
    buildTool: 'gradle',
    basePackage: 'com.example.svc',
    contractType: 'rest-owned',
    hasPublicApi: true,
    projectName: 'my-service',
    ...overrides,
  } as Parameters<typeof makeConfig>[1]) as unknown as Record<string, unknown>
  return renderTemplate('scripts/run-postman-tests.sh.ejs', data)
}

function renderInjectPact(overrides: Record<string, unknown> = {}) {
  const data = makeConfig('/tmp/test', {
    language: 'java',
    buildTool: 'gradle',
    basePackage: 'com.example.svc',
    contractType: 'rest-owned',
    hasPublicApi: true,
    ...overrides,
  } as Parameters<typeof makeConfig>[1]) as unknown as Record<string, unknown>
  return renderTemplate('scripts/inject-pact-samples.sh.ejs', data)
}

function renderContractWorkflow(overrides: Record<string, unknown> = {}) {
  const data = makeConfig('/tmp/test', {
    language: 'java',
    buildTool: 'gradle',
    basePackage: 'com.example.svc',
    contractType: 'rest-owned',
    hasPublicApi: true,
    projectName: 'my-service',
    ...overrides,
  } as Parameters<typeof makeConfig>[1]) as unknown as Record<string, unknown>
  return renderTemplate('github/workflows/_contract-postman.yml.ejs', data)
}

// ─── run-postman-tests.sh.ejs ─────────────────────────────────────────────────

describe('run-postman-tests.sh.ejs (CANON-04, #894)', () => {
  it('renders without EJS syntax errors', () => {
    expect(() => renderRunPostman()).not.toThrow()
  })

  it('starts with bash shebang', () => {
    expect(renderRunPostman()).toMatch(/^#!/)
  })

  it('contains newman invocation', () => {
    expect(renderRunPostman()).toContain('newman')
  })

  it('contains set -euo pipefail for safety', () => {
    expect(renderRunPostman()).toContain('set -euo pipefail')
  })

  it('uses projectName in collection path when set', () => {
    const content = renderRunPostman({ projectName: 'my-api' })
    expect(content).toContain('my-api')
  })

  it('falls back to api when projectName is absent', () => {
    const content = renderRunPostman({ projectName: undefined })
    expect(content).not.toContain('undefined')
  })

  it('contains SERVICE_BASE_URL variable', () => {
    expect(renderRunPostman()).toContain('SERVICE_BASE_URL')
  })

  it('contains exit code handling', () => {
    expect(renderRunPostman()).toContain('exit_code')
  })

  it('contains RESULTS_DIR for evidence output', () => {
    expect(renderRunPostman()).toContain('RESULTS_DIR')
  })
})

// ─── inject-pact-samples.sh.ejs ──────────────────────────────────────────────

describe('inject-pact-samples.sh.ejs (CANON-04, #894)', () => {
  it('renders without EJS syntax errors', () => {
    expect(() => renderInjectPact()).not.toThrow()
  })

  it('starts with bash shebang', () => {
    expect(renderInjectPact()).toMatch(/^#!/)
  })

  it('references pact (lowercase)', () => {
    expect(renderInjectPact().toLowerCase()).toContain('pact')
  })

  it('contains set -euo pipefail for safety', () => {
    expect(renderInjectPact()).toContain('set -euo pipefail')
  })

  it('contains PACTS_DIR variable', () => {
    expect(renderInjectPact()).toContain('PACTS_DIR')
  })

  it('contains curl for HTTP requests', () => {
    expect(renderInjectPact()).toContain('curl')
  })
})

// ─── _contract-postman.yml.ejs (CANON-18) ─────────────────────────────────────

const STACKS = [
  { language: 'java' as const, buildTool: 'gradle' as const },
  { language: 'java' as const, buildTool: 'maven' as const },
] as const

const LEVELS = ['L1', 'L2', 'L3'] as const

describe('_contract-postman.yml.ejs — structural invariants (CANON-04, CANON-18, #894)', () => {
  it('renders without EJS syntax errors for java/gradle', () => {
    expect(() => renderContractWorkflow()).not.toThrow()
  })

  it('contains workflow name key', () => {
    expect(renderContractWorkflow()).toContain('name:')
  })

  it('contains jobs section', () => {
    expect(renderContractWorkflow()).toContain('jobs:')
  })

  it('contains newman reference', () => {
    expect(renderContractWorkflow().toLowerCase()).toContain('newman')
  })

  it('contains permissions block with contents: read', () => {
    expect(renderContractWorkflow()).toContain('contents: read')
  })

  it('contains concurrency block', () => {
    expect(renderContractWorkflow()).toContain('concurrency:')
  })

  it('contains run-postman-tests.sh invocation', () => {
    expect(renderContractWorkflow()).toContain('run-postman-tests.sh')
  })

  it.each(STACKS)(
    '$language/$buildTool: renders without error at L2',
    ({ language, buildTool }) => {
      expect(() =>
        renderContractWorkflow({ language, buildTool, governanceLevel: 'L2' }),
      ).not.toThrow()
    },
  )

  it.each(LEVELS)('%s: renders without error for java/gradle', (level) => {
    expect(() =>
      renderContractWorkflow({ governanceLevel: level, language: 'java', buildTool: 'gradle' }),
    ).not.toThrow()
  })

  it('uses SHA-pinned actions (CANON-18 security)', () => {
    const content = renderContractWorkflow()
    // actions/checkout and other official actions must be SHA-pinned
    expect(content).toMatch(/actions\/checkout@[0-9a-f]{40}/)
  })

  it('references CI_BUILD_RUNNER_LABEL variable (INV-13)', () => {
    expect(renderContractWorkflow()).toContain('CI_BUILD_RUNNER_LABEL')
  })

  it('uses projectName in collection variable when set', () => {
    const content = renderContractWorkflow({ projectName: 'my-service' })
    expect(content).toContain('my-service')
  })

  // #1576 — defect 1: the default service image must be a SINGLE GitHub Actions
  // expression. Nested `${{ ... ${{ ... }} ... }}` is not re-evaluated by Actions
  // (actionlint is blind to it), so the inner refs would ship as a literal,
  // malformed image reference on the default path (vars.APP_IMAGE unset).
  it('builds the default service image with format(), not a nested expression', () => {
    const content = renderContractWorkflow()
    // No `${{` may appear inside a single-quoted string literal of an outer expr.
    expect(content).not.toContain("'ghcr.io/${{")
    expect(content).toContain(
      "format('ghcr.io/{0}:pr-{1}', github.repository, github.event.pull_request.number)",
    )
  })

  // #1576 — defect 2: the workflow is emitted for `java || multi`, so the services
  // body must render for `multi` too. A bare `services:` with no `app` container
  // would leave Newman hitting a dead port.
  it.each(['java', 'multi'] as const)(
    '%s: renders the app service container (no bare services:)',
    (language) => {
      const content = renderContractWorkflow({ language })
      expect(content).toContain('services:')
      expect(content).toContain('app:')
      expect(content).toContain('SPRING_PROFILES_ACTIVE: contract-test')
    },
  )
})
