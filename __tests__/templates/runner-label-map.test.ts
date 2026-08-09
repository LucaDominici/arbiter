import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig, renderCheckAll } from '../helpers.js'

/**
 * Port C1 — parametric runner-label map (build/test/deploy job classes).
 *
 * A project can point each job class at a distinct runner pool (self-hosted /
 * cloud / GitHub-hosted) via org vars without editing workflows:
 *   runs-on: ${{ fromJSON(vars.RUNNER_LABELS_<CLASS> || '["ubuntu-latest"]') }}
 * Every class falls back to ubuntu-latest, so an unset var is never broken.
 */
describe('runner-label map — generated hardening allowlist (#1497 C1)', () => {
  // #2041: check-all.mjs.ejs is registry-driven — render through the shared helper.
  const render = () =>
    renderCheckAll(
      makeConfig('/tmp/test', {
        language: 'typescript',
        governanceLevel: 'L1',
      }) as unknown as Record<string, unknown>,
    )

  it('allowlist regex accepts all three job classes BUILD/TEST/DEPLOY', () => {
    const content = render()
    expect(content).toContain('RUNNER_LABELS_(?:BUILD|TEST|DEPLOY)')
  })

  it('the inlined allowlist accepts every class but still rejects a bare runner', () => {
    const content = render()
    const m = content.match(/const _wrAllowedPattern = (\/.*\/);/)
    expect(m, 'allowlist regex literal must be present in rendered check-all').not.toBeNull()
    // eslint-disable-next-line no-eval -- reconstruct the literal regex under test
    const allow = eval(m![1]) as RegExp
    for (const cls of ['BUILD', 'TEST', 'DEPLOY']) {
      const ok = `    runs-on: \${{ fromJSON(vars.RUNNER_LABELS_${cls} || '["ubuntu-latest"]') }}`
      expect(allow.test(ok), `${cls} class must be allowlisted`).toBe(true)
    }
    // The guard must still fire RED on a hardcoded pool that bypasses the map.
    expect(allow.test('    runs-on: ubuntu-latest')).toBe(false)
    expect(allow.test('    runs-on: self-hosted')).toBe(false)
  })
})

describe('runner-label map — spine workflow wiring (#1497 C1)', () => {
  it('pr-fast routes validation jobs to the TEST pool with ubuntu-latest fallback', () => {
    const content = renderTemplate(
      'github/workflows/01-pr-fast.yml.ejs',
      makeConfig('/tmp/test', {
        language: 'typescript',
        governanceLevel: 'L2',
      }) as unknown as Record<string, unknown>,
    )
    expect(content).toContain('fromJSON(vars.RUNNER_LABELS_TEST || \'["ubuntu-latest"]\')')
    // No validation job may keep a non-classed runner once the map is wired.
    expect(content).not.toContain('vars.CI_BUILD_RUNNER_LABEL')
  })

  it('pr-extended splits the Maven build job (BUILD) from the test jobs (TEST)', () => {
    const content = renderTemplate(
      'github/workflows/02-pr-extended.yml.ejs',
      makeConfig('/tmp/test', {
        language: 'java',
        buildTool: 'maven',
        governanceLevel: 'L2',
      }) as unknown as Record<string, unknown>,
    )
    expect(content).toContain('fromJSON(vars.RUNNER_LABELS_BUILD || \'["ubuntu-latest"]\')')
    expect(content).toContain('fromJSON(vars.RUNNER_LABELS_TEST || \'["ubuntu-latest"]\')')
  })

  it('release routes the build-superset job to the BUILD pool', () => {
    const content = renderTemplate(
      'github/workflows/05-release.yml.ejs',
      makeConfig('/tmp/test', {
        language: 'typescript',
        governanceLevel: 'L3',
      }) as unknown as Record<string, unknown>,
    )
    expect(content).toContain('fromJSON(vars.RUNNER_LABELS_BUILD || \'["ubuntu-latest"]\')')
  })
})
