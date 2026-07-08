import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateGithub } from '../../src/generators/github.js'
import { beginGenerationSession, endGenerationSession } from '../../src/utils/fs.js'

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')

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

  it('generates T1+T2+T3+T4+T5+T5b+T6 CI workflows, PR template, extended-ci-paths SSOT, 5 issue templates, compliance-item, issue-state, dependabot, sign-and-attest action, sigstore-retry-sign, AI-PR gate, and codeql workflows (28 files total, #1691 adds _nightly/_weekly/_monthly, #1694 adds _shared-security)', () => {
    // Default config resolves to peer-review (#1131). peer-review L2+ emits
    // 15-codeql.yml (see github-ci-gap.test.ts); previously the gap-workflow
    // guards read the *raw* (undefined) collaborationMode and suppressed it.
    // #1691: peer-review L3+ emits 3 additional reusable partials (_nightly, _weekly, _monthly).
    // #1694: adds _shared-security.yml reusable partial (called from _nightly and _weekly).
    const config = githubConfig({ governanceLevel: 'L3' })
    const result = generateGithub(config)
    expect(result.files).toHaveLength(28)
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

  // #1776: CI workflow files (01-pr-fast.yml et al.) now carry the same
  // skipIfExists + hash-baseline protection as deploy workflows (CANON-11,
  // #899) — `arbiter update` was unconditionally overwriting them, silently
  // reverting dependabot-bumped SHA pins and deliberately-deleted CI steps.
  it('does NOT clobber a foreign/customized CI workflow with unknown provenance (#1776)', () => {
    const workflowsDir = join(dir, '.github', 'workflows')
    mkdirSync(workflowsDir, { recursive: true })
    writeFileSync(join(workflowsDir, '01-pr-fast.yml'), '# custom ci')
    const config = githubConfig()
    const result = generateGithub(config)
    const ci = result.files.find((f) => f.path.endsWith('01-pr-fast.yml'))
    expect(ci?.action).toBe('skipped')
    expect(readFileSync(join(workflowsDir, '01-pr-fast.yml'), 'utf-8')).toBe('# custom ci')
  })

  // A config change (e.g. a soloDevMode toggle) must still reach a PRISTINE CI
  // workflow (unmodified since arbiter last wrote it) — the #1328 generation-
  // session hash baseline is what tells "arbiter's own prior render" apart
  // from "dependabot/user touched this since", so propagation still works
  // exactly like every other skipIfExists-protected file in this codebase.
  it('DOES propagate a config change to a pristine CI workflow inside a generation session (#1776)', () => {
    const ciPath = join(dir, '.github', 'workflows', '01-pr-fast.yml')

    // First run (mirrors `arbiter init`): nothing on disk yet, file is created.
    beginGenerationSession({ targetDir: dir, prevHashes: {} })
    const first = generateGithub(githubConfig())
    const firstHashes = endGenerationSession()
    expect(first.files.find((f) => f.path.endsWith('01-pr-fast.yml'))?.action).toBe('created')

    // Second run (mirrors `arbiter update` after a config change): the manifest
    // baseline is the hash `arbiter` itself just recorded — pristine, so the
    // new config's render is safe to propagate.
    beginGenerationSession({ targetDir: dir, prevHashes: firstHashes })
    const second = generateGithub(githubConfig({ enableSoloDevMode: true }))
    endGenerationSession()
    const secondCi = second.files.find((f) => f.path.endsWith('01-pr-fast.yml'))
    expect(secondCi?.action).toBe('replaced')
    expect(sha256(readFileSync(ciPath, 'utf-8'))).not.toBe(
      firstHashes['.github/workflows/01-pr-fast.yml'],
    )
  })
})
