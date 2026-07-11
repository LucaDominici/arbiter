import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('12-mutation-scheduled.yml.ejs rendering (CANON-04, #1076)', () => {
  it('renders scheduled cron trigger', () => {
    const data = makeConfig('/tmp/test', {
      language: 'java',
      buildTool: 'gradle',
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/12-mutation-scheduled.yml.ejs', data)
    expect(rendered).toContain('cron:')
    expect(rendered).toContain('0 3 * * 1')
  })

  it('has top-level permissions block', () => {
    const data = makeConfig('/tmp/test', {
      language: 'java',
      buildTool: 'gradle',
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/12-mutation-scheduled.yml.ejs', data)
    expect(rendered).toMatch(/^permissions:/m)
  })

  it('renders Java PITest block for java+gradle', () => {
    const data = makeConfig('/tmp/test', {
      language: 'java',
      buildTool: 'gradle',
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/12-mutation-scheduled.yml.ejs', data)
    expect(rendered).toContain('pitest')
    expect(rendered).toContain('setup-gradle')
  })

  it('all action refs are SHA-pinned (java+gradle)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'java',
      buildTool: 'gradle',
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/12-mutation-scheduled.yml.ejs', data)
    const nonSha = [...rendered.matchAll(/uses:\s+([^\s@]+)@([^\s#]+)/g)]
      .map(([, , ref]) => ref)
      .filter((ref) => !/^[0-9a-f]{40}$/i.test(ref))
    expect(nonSha).toEqual([])
  })

  // Regression guard for the actionlint-corpus finding (#actionlint-corpus):
  // rust/python/go rendered a `jobs:` map with ZERO job keys — invalid GitHub
  // Actions YAML that GitHub itself rejects outright. Every language
  // src/generators/mutation.ts wires a mutation tool for (java, typescript,
  // rust, python, go, multi) must emit at least one job.
  it.each(['java', 'typescript', 'rust', 'python', 'go', 'multi'] as const)(
    'never emits an empty jobs: map (%s)',
    (language) => {
      const data = makeConfig('/tmp/test', {
        language,
        buildTool: language === 'java' ? 'gradle' : 'npm',
        governanceLevel: 'L2',
      }) as unknown as Record<string, unknown>
      const rendered = renderTemplate('github/workflows/12-mutation-scheduled.yml.ejs', data)
      const jobKeys = [...rendered.matchAll(/^\s{2}[\w-]+:\s*$/gm)]
      expect(jobKeys.length, `no job key rendered for language=${language}`).toBeGreaterThan(0)
    },
  )

  it('renders Rust cargo-mutants block for rust', () => {
    const data = makeConfig('/tmp/test', {
      language: 'rust',
      buildTool: 'cargo',
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/12-mutation-scheduled.yml.ejs', data)
    expect(rendered).toContain('cargo-mutants')
    expect(rendered).toContain('rust-toolchain')
  })

  it('renders Python mutmut block for python', () => {
    const data = makeConfig('/tmp/test', {
      language: 'python',
      buildTool: 'pip',
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/12-mutation-scheduled.yml.ejs', data)
    expect(rendered).toContain('mutmut')
    expect(rendered).toContain('setup-python')
  })

  it('renders Go go-mutesting block for go', () => {
    const data = makeConfig('/tmp/test', {
      language: 'go',
      buildTool: 'go',
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/12-mutation-scheduled.yml.ejs', data)
    expect(rendered).toContain('go-mutesting')
    expect(rendered).toContain('setup-go')
  })

  it.each(['rust', 'python', 'go'] as const)('all action refs are SHA-pinned (%s)', (language) => {
    const data = makeConfig('/tmp/test', {
      language,
      buildTool: language === 'go' ? 'go' : language === 'python' ? 'pip' : 'cargo',
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/12-mutation-scheduled.yml.ejs', data)
    const nonSha = [...rendered.matchAll(/uses:\s+([^\s@]+)@([^\s#]+)/g)]
      .map(([, , ref]) => ref)
      .filter((ref) => !/^[0-9a-f]{40}$/i.test(ref))
    expect(nonSha).toEqual([])
  })
})
