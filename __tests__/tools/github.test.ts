import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateGithub } from '../../src/generators/github.js'

describe('tool output: github', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  function githubConfig(overrides: Partial<Parameters<typeof makeConfig>[1]> = {}) {
    return makeConfig(dir, {
      useGitHub: true,
      languageHooks: [],
      ...overrides,
    })
  }

  it('generates T1+T2+T3+T4+T5+T5b+T6 CI workflows, PR template, extended-ci-paths SSOT, 5 issue templates, compliance-item, issue-state, dependabot, sign-and-attest action, sigstore-retry-sign, AI-PR gate, and codeql workflows (27 files total, #1691 adds _nightly/_weekly/_monthly partials)', () => {
    // Default config resolves to peer-review (#1131). peer-review L2+ emits
    // 15-codeql.yml (see github-ci-gap.test.ts); previously the gap-workflow
    // guards read the *raw* (undefined) collaborationMode and suppressed it.
    // #1691: peer-review L3+ emits 3 additional reusable partials (_nightly, _weekly, _monthly).
    const config = githubConfig({ governanceLevel: 'L3' })
    const result = generateGithub(config)
    expect(result.files).toHaveLength(27)
    expect(result.files.map((f) => f.path).some((p) => p.endsWith('15-codeql.yml'))).toBe(true)
  })

  it('dependabot.yml includes npm package ecosystem for TypeScript projects', () => {
    const config = githubConfig({ buildTool: 'npm' })
    generateGithub(config)
    const content = readFileSync(join(dir, '.github', 'dependabot.yml'), 'utf-8')
    expect(content).toContain('npm')
  })

  it('dependabot.yml always includes github-actions ecosystem', () => {
    const config = githubConfig()
    generateGithub(config)
    const content = readFileSync(join(dir, '.github', 'dependabot.yml'), 'utf-8')
    expect(content).toContain('github-actions')
  })

  it('all files have created action on a fresh project', () => {
    const config = githubConfig()
    const result = generateGithub(config)
    for (const f of result.files) {
      expect(f.action, `${f.path} should be created`).toBe('created')
    }
  })

  it('CI workflow is always regenerated on re-run (soloDevMode toggle requires immediate apply)', () => {
    const workflowsDir = join(dir, '.github', 'workflows')
    mkdirSync(workflowsDir, { recursive: true })
    writeFileSync(join(workflowsDir, '01-pr-fast.yml'), '# custom ci')
    const config = githubConfig()
    const result = generateGithub(config)
    const ci = result.files.find((f) => f.path.endsWith('01-pr-fast.yml'))
    expect(ci?.action).toBe('replaced')
  })
})
