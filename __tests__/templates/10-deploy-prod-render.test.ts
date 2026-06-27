// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'
import {
  parseReusableCalls,
  parseWorkflowCallInputs,
  resolveReusableContract,
} from '../utils/workflow-graph.js'

function renderDeployProd(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'github/workflows/10-deploy-prod.yml.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

// ─── CANON-18: structural invariants (5 stacks × 3 governance levels) ────────

describe('10-deploy-prod.yml.ejs — structural invariants (CANON-18)', () => {
  const STACKS = [
    { language: 'typescript', buildTool: 'npm' },
    { language: 'java', buildTool: 'maven' },
    { language: 'go', buildTool: 'go' },
    { language: 'python', buildTool: 'pip' },
    { language: 'rust', buildTool: 'cargo' },
  ] as const

  const LEVELS = ['L1', 'L2', 'L3'] as const

  it.each(STACKS)('$language: workflow name is "Deploy Prod"', ({ language, buildTool }) => {
    const rendered = renderDeployProd({ language, buildTool })
    expect(rendered).toContain('name: Deploy Prod')
  })

  it.each(STACKS)('$language: triggers on release published', ({ language, buildTool }) => {
    const rendered = renderDeployProd({ language, buildTool })
    expect(rendered).toContain('release:')
    expect(rendered).toContain('published')
  })

  it.each(STACKS)('$language: id-token: write permission present', ({ language, buildTool }) => {
    const rendered = renderDeployProd({ language, buildTool })
    expect(rendered).toContain('id-token: write')
  })

  it.each(STACKS)('$language: concurrency cancel-in-progress false', ({ language, buildTool }) => {
    const rendered = renderDeployProd({ language, buildTool })
    expect(rendered).toContain('cancel-in-progress: false')
  })

  it.each(STACKS)('$language: deploy-prod job with environment gate', ({ language, buildTool }) => {
    const rendered = renderDeployProd({ language, buildTool })
    expect(rendered).toContain('deploy-prod:')
    expect(rendered).toContain('environment:')
    expect(rendered).toContain('production')
  })

  it.each(STACKS)('$language: 30-day timeout (43200 minutes)', ({ language, buildTool }) => {
    const rendered = renderDeployProd({ language, buildTool })
    expect(rendered).toContain('43200')
  })

  it.each(STACKS)('$language: notify-failure job present', ({ language, buildTool }) => {
    const rendered = renderDeployProd({ language, buildTool })
    expect(rendered).toContain('notify-failure:')
    expect(rendered).toContain('if: failure()')
  })

  it.each(LEVELS)('governance %s: no EJS tag leaks', (level) => {
    const rendered = renderDeployProd({ governanceLevel: level })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it.each(LEVELS)('governance %s: workflow name present', (level) => {
    const rendered = renderDeployProd({ governanceLevel: level })
    expect(rendered).toContain('name: Deploy Prod')
  })
})

// ─── Security invariants ──────────────────────────────────────────────────────

describe('10-deploy-prod.yml.ejs — security invariants', () => {
  it('GitHub Environment "production" gate (required-reviewer)', () => {
    const rendered = renderDeployProd({})
    expect(rendered).toContain('name: production')
  })

  it('SCAFFOLD activation guard step present', () => {
    const rendered = renderDeployProd({})
    expect(rendered).toContain('SCAFFOLD')
  })

  it('SCAFFOLD_DRY_RUN guard present (bypass for tests)', () => {
    const rendered = renderDeployProd({})
    expect(rendered).toContain('SCAFFOLD_DRY_RUN')
  })

  it('PROD smoke skips gracefully when PROD_BASE_URL not set', () => {
    const rendered = renderDeployProd({})
    expect(rendered).toContain('PROD_BASE_URL')
    expect(rendered).toContain('skip')
  })
})

// ─── #1619: ghcr cosign-copy jq digest filter handles lowercase + capitalized keys ──

describe('_cosign-copy/ghcr.ejs — multi-arch digest resolution (#1619)', () => {
  function renderGhcr(overrides: Record<string, unknown> = {}) {
    return renderDeployProd({
      deployTarget: 'ghcr',
      githubOwner: 'acme',
      githubRepo: 'svc',
      ...overrides,
    })
  }

  it('jq digest filter accepts lowercase .platform.os / .digest (multi-arch manifest lists)', () => {
    const rendered = renderGhcr()
    // `docker manifest inspect` emits lowercase keys for multi-arch indices.
    expect(rendered).toContain('.platform.os // .Platform.os')
    expect(rendered).toContain('.digest // .Digest')
  })

  it('no longer hard-codes capitalized-only .Platform.os / .Digest selectors', () => {
    const rendered = renderGhcr()
    // The old verbatim filter would fall through to .config.digest for multi-arch.
    expect(rendered).not.toContain('select(.Platform.os == "linux")')
  })
})

// ─── PORT A2 (#1502): provenance admission gate before deploy ─────────────────

describe('10-deploy-prod.yml.ejs — A2 provenance admission gate (#1502)', () => {
  function renderWithTarget(overrides: Record<string, unknown> = {}) {
    return renderDeployProd({
      deployTarget: 'ghcr',
      githubOwner: 'acme',
      githubRepo: 'svc',
      ...overrides,
    })
  }

  it('emits a fail-closed cosign-verify admission gate when a deploy target is set', () => {
    const rendered = renderWithTarget()
    expect(rendered).toContain('Provenance admission gate')
    expect(rendered).toContain('cosign verify')
    // fail-closed: missing IMAGE_TAG aborts the job
    expect(rendered).toContain('IMAGE_TAG is not set')
  })

  it('admission gate verifies the signature 05-release produces (identity regexp)', () => {
    const rendered = renderWithTarget()
    expect(rendered).toContain('05-release')
    expect(rendered).toContain('token.actions.githubusercontent.com')
  })

  it('admission gate runs BEFORE the deploy step (no unverified image deploys)', () => {
    const rendered = renderWithTarget()
    const gateIdx = rendered.indexOf('Provenance admission gate')
    const deployIdx = rendered.indexOf('Deploy — GHCR')
    expect(gateIdx).toBeGreaterThan(-1)
    expect(deployIdx).toBeGreaterThan(-1)
    expect(gateIdx).toBeLessThan(deployIdx)
  })

  it('no deploy target → no admission gate (scaffold-only workflow)', () => {
    const rendered = renderDeployProd({})
    expect(rendered).not.toContain('Provenance admission gate')
  })
})

// ─── P0 notify ───────────────────────────────────────────────────────────────

describe('10-deploy-prod.yml.ejs — P0 failure notification', () => {
  it('notify-failure uses P0 severity', () => {
    const rendered = renderDeployProd({})
    expect(rendered).toContain('P0')
  })

  it('notify-failure references _notify.yml reusable workflow', () => {
    const rendered = renderDeployProd({})
    expect(rendered).toContain('_notify.yml')
  })

  // #1548 regression: the notify-failure caller passed workflow_name/area/
  // severity/branch/run_url/failure_summary/status, but _notify.yml only ever
  // declared issue-number/body — so the `if: failure()` alert path was a
  // permanently-invalid reusable-workflow call. Resolve the caller's `with:`
  // block against the callee's declared on.workflow_call.inputs.
  it('notify-failure `with:` keys all resolve against _notify.yml inputs (#1548)', () => {
    const data = makeConfig('/tmp/test', {}) as unknown as Record<string, unknown>
    const caller = renderDeployProd({})
    const callee = renderTemplate('github/workflows/_notify.yml.ejs', data)

    const contracts = new Map([['_notify.yml', parseWorkflowCallInputs(callee)!]])
    const calls = parseReusableCalls(caller).filter((c) => c.callee === '_notify.yml')

    // Sanity: the caller really does call _notify.yml with a non-empty `with:`.
    expect(calls.length).toBeGreaterThan(0)
    expect(calls[0].withKeys).toContain('workflow_name')
    expect(calls[0].withKeys).toContain('failure_summary')

    const violations = resolveReusableContract(calls, contracts)
    expect(violations, JSON.stringify(violations)).toEqual([])
  })

  it('_notify.yml declares the failure-summary contract its callers use (#1548)', () => {
    const data = makeConfig('/tmp/test', {}) as unknown as Record<string, unknown>
    const inputs = parseWorkflowCallInputs(renderTemplate('github/workflows/_notify.yml.ejs', data))
    expect(inputs).not.toBeNull()
    for (const key of [
      'workflow_name',
      'area',
      'severity',
      'branch',
      'run_url',
      'failure_summary',
      'status',
    ]) {
      expect(inputs!.has(key)).toBe(true)
    }
    // workflow_name is the single required input; the rest carry defaults.
    expect(inputs!.get('workflow_name')!.required).toBe(true)
  })
})
