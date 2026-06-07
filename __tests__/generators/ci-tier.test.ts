// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateCiTier } from '../../src/generators/ci-tier.js'

let dir: string

beforeEach(() => {
  dir = createTestProject()
})

afterEach(() => {
  cleanupTestProject(dir)
})

// T1 — no-op when useGitHub is false
describe('generateCiTier — no-op gate', () => {
  it('returns empty when useGitHub is false', () => {
    const result = generateCiTier(makeConfig(dir, { useGitHub: false }))
    expect(result.files).toHaveLength(0)
  })
})

// T2–T6 — 4-artifact contract (locked by Reading B)
// ci-tier.ts emits ONLY: _notify.yml, _label-sync.yml, labels.yml, setup-node-pnpm/action.yml
// Standard CI workflows remain owned by github.ts (with ciTierMode awareness)
describe('generateCiTier — 4-artifact contract', () => {
  it('emits exactly 4 new artifacts at L2 without enableCodeownersNotify', () => {
    const result = generateCiTier(makeConfig(dir, { useGitHub: true, governanceLevel: 'L2' }))
    expect(result.files).toHaveLength(4)
  })

  it('emits _notify.yml under .github/workflows/', () => {
    const result = generateCiTier(makeConfig(dir, { useGitHub: true }))
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.includes(join('.github', 'workflows', '_notify.yml')))).toBe(true)
  })

  it('emits _label-sync.yml under .github/workflows/', () => {
    const result = generateCiTier(makeConfig(dir, { useGitHub: true }))
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.includes(join('.github', 'workflows', '_label-sync.yml')))).toBe(
      true,
    )
  })

  it('emits labels.yml directly under .github/', () => {
    const result = generateCiTier(makeConfig(dir, { useGitHub: true }))
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith(join('.github', 'labels.yml')))).toBe(true)
  })

  it('emits setup-node-pnpm composite action under .github/actions/', () => {
    const result = generateCiTier(makeConfig(dir, { useGitHub: true }))
    const paths = result.files.map((f) => f.path)
    expect(
      paths.some((p) => p.includes(join('.github', 'actions', 'setup-node-pnpm', 'action.yml'))),
    ).toBe(true)
  })
})

// #943: opt-in post-merge CODEOWNERS notification (L2+ only)
describe('generateCiTier — enableCodeownersNotify opt-in', () => {
  it('emits 5 artifacts at L2 with enableCodeownersNotify: true', () => {
    const result = generateCiTier(
      makeConfig(dir, { useGitHub: true, governanceLevel: 'L2', enableCodeownersNotify: true }),
    )
    expect(result.files).toHaveLength(5)
    const paths = result.files.map((f) => f.path)
    expect(
      paths.some((p) => p.includes(join('.github', 'workflows', '_post-merge-notify.yml'))),
    ).toBe(true)
  })

  it('emits 5 artifacts at L3 with enableCodeownersNotify: true', () => {
    const result = generateCiTier(
      makeConfig(dir, { useGitHub: true, governanceLevel: 'L3', enableCodeownersNotify: true }),
    )
    expect(result.files).toHaveLength(5)
  })

  it('does not emit _post-merge-notify.yml at L1 even with flag', () => {
    const result = generateCiTier(
      makeConfig(dir, { useGitHub: true, governanceLevel: 'L1', enableCodeownersNotify: true }),
    )
    expect(result.files).toHaveLength(4)
    const paths = result.files.map((f) => f.path)
    expect(
      paths.some((p) => p.includes(join('.github', 'workflows', '_post-merge-notify.yml'))),
    ).toBe(false)
  })

  it('does not emit _post-merge-notify.yml when flag is false', () => {
    const result = generateCiTier(
      makeConfig(dir, { useGitHub: true, governanceLevel: 'L2', enableCodeownersNotify: false }),
    )
    expect(result.files).toHaveLength(4)
  })
})

// #1226: Java emits setup-java-maven composite; non-Java does not (Phase 0, CANON-05)
describe('generateCiTier — Java setup-java-maven emission (#1226)', () => {
  it('emits setup-java-maven/action.yml for Java projects', () => {
    const result = generateCiTier(
      makeConfig(dir, { useGitHub: true, language: 'java', buildTool: 'maven' }),
    )
    const paths = result.files.map((f) => f.path)
    expect(
      paths.some((p) => p.includes(join('.github', 'actions', 'setup-java-maven', 'action.yml'))),
    ).toBe(true)
  })

  it('does NOT emit setup-java-maven/action.yml for TypeScript projects', () => {
    const result = generateCiTier(makeConfig(dir, { useGitHub: true, language: 'typescript' }))
    const paths = result.files.map((f) => f.path)
    expect(
      paths.some((p) => p.includes(join('.github', 'actions', 'setup-java-maven', 'action.yml'))),
    ).toBe(false)
  })

  it('does NOT emit setup-java-maven/action.yml for Python projects', () => {
    const result = generateCiTier(
      makeConfig(dir, { useGitHub: true, language: 'python', buildTool: 'pip' }),
    )
    const paths = result.files.map((f) => f.path)
    expect(
      paths.some((p) => p.includes(join('.github', 'actions', 'setup-java-maven', 'action.yml'))),
    ).toBe(false)
  })

  it('existing 4-artifact TypeScript contract is unchanged', () => {
    const result = generateCiTier(makeConfig(dir, { useGitHub: true, language: 'typescript' }))
    expect(result.files).toHaveLength(4)
  })

  // CANON-11: brownfield — re-init with Java must honour skipIfExists semantics
  it('setup-java-maven/action.yml is skipIfExists — no overwrite on re-init (CANON-11)', () => {
    const config = makeConfig(dir, { useGitHub: true, language: 'java', buildTool: 'maven' })
    const result1 = generateCiTier(config)
    const file1 = result1.files.find((f) =>
      f.path.includes(join('.github', 'actions', 'setup-java-maven', 'action.yml')),
    )
    expect(file1?.action).toBe('created')

    const result2 = generateCiTier(config)
    const file2 = result2.files.find((f) =>
      f.path.includes(join('.github', 'actions', 'setup-java-maven', 'action.yml')),
    )
    expect(file2?.action).toBe('skipped')
  })
})
