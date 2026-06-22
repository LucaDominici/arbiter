// SPDX-License-Identifier: Apache-2.0
// B6/#1491 (M3) — a baseline .gitignore was only emitted by evidence-retention,
// gated on enableEvidenceHarness (off by default at L1/L2). So an L1/L2 user got
// .arbiter/ + .evidence/ runtime state written into their repo with NO .gitignore,
// and `git add -A` committed arbiter's ephemeral state. These tests pin that the
// baseline .gitignore is now emitted UNCONDITIONALLY at every level.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { buildRegistry } from '../../src/generators/registry.js'
import { generateGitignore } from '../../src/generators/gitignore.js'
import { generateEvidenceRetention } from '../../src/generators/evidence-retention.js'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'

const find = (specs: ReturnType<typeof buildRegistry>, key: string) =>
  specs.find((s) => s.key === key)

describe('baseline .gitignore — always-on emission (B6/#1491)', () => {
  for (const level of ['L1', 'L2', 'L3', 'L4'] as const) {
    it(`emits .gitignore at ${level} regardless of the evidence harness`, () => {
      const specs = buildRegistry(
        makeConfig('/tmp/proj', { governanceLevel: level, enableEvidenceHarness: false }),
      )
      const spec = find(specs, 'baseline-gitignore')
      expect(spec?.enabled).toBe(true)
      const files = spec?.run({ dryRun: true }) ?? []
      expect(files.some((f) => f.path.endsWith('/.gitignore'))).toBe(true)
    })
  }

  it('the generator renders a baseline ignoring arbiter runtime state', () => {
    const { files } = generateGitignore(makeConfig('/tmp/proj', { governanceLevel: 'L1' }), {
      dryRun: true,
    })
    expect(files).toHaveLength(1)
    expect(files[0].path).toMatch(/\/.gitignore$/)
  })

  it('evidence-retention NO LONGER emits .gitignore (no double-emission)', () => {
    // The .gitignore write was consolidated into the always-on generator; emitting
    // it from BOTH would report the always-on one as "already exists" on its 2nd
    // write (the M1 cosmetic-noise class of bug).
    const { files } = generateEvidenceRetention(
      makeConfig('/tmp/proj', { governanceLevel: 'L2', enableEvidenceHarness: true }),
      { dryRun: true },
    )
    expect(files.some((f) => f.path.endsWith('/.gitignore'))).toBe(false)
  })
})

// Content + skipIfExists behaviour (migrated from evidence-retention.test.ts, B6/#1491).
describe('baseline .gitignore — content + brownfield safety', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('writes a .gitignore to disk', () => {
    generateGitignore(makeConfig(dir))
    expect(existsSync(join(dir, '.gitignore'))).toBe(true)
  })

  it('ignores .evidence/ and common build/dep artifacts', () => {
    generateGitignore(makeConfig(dir))
    const content = readFileSync(join(dir, '.gitignore'), 'utf-8')
    expect(content).toContain('.evidence/')
    expect(content).toContain('node_modules/')
    expect(content).toContain('dist/')
    expect(content).toContain('.env')
    expect(content).toContain('website/.vitepress/.temp/')
  })

  it('ignores local Arbiter runtime state', () => {
    generateGitignore(makeConfig(dir))
    const content = readFileSync(join(dir, '.gitignore'), 'utf-8')
    expect(content).toContain('.arbiter/')
    expect(content).toContain('.agents-dispatched')
    expect(content).toContain('.claude/.task-*')
    expect(content).toContain('.claude/plans/')
    expect(content).toContain('*.arbiter-backup')
    expect(content).toContain('.arbiter-generated.json.bak.*')
  })

  it('skipIfExists — does not overwrite an existing .gitignore (brownfield-safe)', () => {
    const gitignorePath = join(dir, '.gitignore')
    writeFileSync(gitignorePath, 'EXISTING')
    const result = generateGitignore(makeConfig(dir))
    const file = result.files.find((f) => f.path.endsWith('.gitignore'))
    expect(file?.action).toBe('skipped')
    expect(readFileSync(gitignorePath, 'utf-8')).toBe('EXISTING')
  })

  // #1328 unit 7 (Track-B): the emitted .gitignore must NOT ignore the committed
  // generated-manifest, or the governed fleet silently loses provenance and
  // `update` propagates nothing (the very property INV-122 asserts).
  it('does NOT ignore .arbiter-generated-manifest.json (fleet provenance must be committed)', () => {
    generateGitignore(makeConfig(dir))
    const isIgnored = (rel: string): boolean => {
      writeFileSync(join(dir, rel), 'x')
      return spawnSync('git', ['check-ignore', '-q', rel], { cwd: dir }).status === 0
    }
    expect(isIgnored('.arbiter-generated-manifest.json')).toBe(false)
    expect(isIgnored('.arbiter-generated.json')).toBe(false)
    // Sanity: the template still ignores the runtime .arbiter/ dir (intent preserved).
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    expect(isIgnored('.arbiter/scratch.tmp')).toBe(true)
  })
})
