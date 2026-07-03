import { describe, it, expect } from 'vitest'
import { load } from 'js-yaml'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

// gold-align #1506 (yamllint) + #1507 (shellcheck): the generated PR-fast lint
// lane gains a language-agnostic config-lint job that lints non-workflow YAML
// (yamllint) and generated shell (shellcheck), both blocking + version-pinned.
// Committed .yamllint.yml / .shellcheckrc make the rules explicit and tunable.

function renderWorkflow(overrides: Record<string, unknown> = {}): string {
  return renderTemplate(
    'github/workflows/01-pr-fast.yml.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

describe('config-lint lane — yamllint + shellcheck (gold-align #1506/#1507)', () => {
  for (const level of ['L1', 'L2', 'L3', 'L4'] as const) {
    it(`(${level}) 01-pr-fast exposes a config-lint job with both linters`, () => {
      const wf = renderWorkflow({ governanceLevel: level })
      expect(wf).toContain('  config-lint:')
      // shellcheck: pinned release tarball + blocking warning-severity run.
      expect(wf).toContain('koalaman/shellcheck/releases/download/v0.10.0/')
      expect(wf).toMatch(/shellcheck --severity=warning/)
      // yamllint: pinned pip install + invocation.
      expect(wf).toMatch(/pip install yamllint==[0-9.]+/)
      expect(wf).toMatch(/xargs yamllint/)
      // No EJS leaks in the rendered workflow.
      expect(wf).not.toContain('<%')
    })
  }

  it('renders a config-lint job inside a structurally valid workflow', () => {
    for (const language of ['typescript', 'go', 'java', 'python'] as const) {
      const wf = renderWorkflow({ governanceLevel: 'L2', language })
      const doc = load(wf) as { jobs?: Record<string, unknown> }
      expect(doc.jobs).toBeDefined()
      expect(doc.jobs?.['config-lint']).toBeDefined()
    }
  })

  it('scopes yamllint to non-workflow YAML (actionlint owns workflow semantics)', () => {
    const wf = renderWorkflow({ governanceLevel: 'L2' })
    // git pathspec excludes .github/workflows so yamllint never overlaps actionlint.
    expect(wf).toContain(':!.github/workflows/**')
  })

  it('config-lint linters are blocking (no soft-fail / continue-on-error)', () => {
    const wf = renderWorkflow({ governanceLevel: 'L2' })
    const start = wf.indexOf('  config-lint:')
    // Slice the job body up to the next top-level (2-space) job key.
    const after = wf.slice(start + '  config-lint:'.length)
    const nextJob = after.search(/\n {2}[a-z][a-z0-9-]*:\n/)
    const body = nextJob === -1 ? after : after.slice(0, nextJob)
    expect(body).not.toContain('continue-on-error')
    expect(body).not.toContain('soft_fail')
  })
})

describe('.yamllint.yml.ejs (gold-align #1506)', () => {
  it('renders blocking-error YAML lint config that ignores workflows', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('static-analysis/.yamllint.yml.ejs', data)
    expect(rendered).not.toContain('<%')
    expect(rendered).toContain('extends: default')
    // workflows are excluded — actionlint owns their semantics.
    expect(rendered).toContain('.github/workflows/')
  })
})

describe('.shellcheckrc.ejs (gold-align #1507)', () => {
  it('renders a shellcheck config with source resolution enabled', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('static-analysis/.shellcheckrc.ejs', data)
    expect(rendered).not.toContain('<%')
    expect(rendered).toContain('external-sources=true')
    expect(rendered).toContain('shell=bash')
  })
})
