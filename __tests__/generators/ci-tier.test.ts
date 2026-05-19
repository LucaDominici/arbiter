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
  it('emits exactly 4 new artifacts when useGitHub is true', () => {
    const result = generateCiTier(makeConfig(dir, { useGitHub: true }))
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
