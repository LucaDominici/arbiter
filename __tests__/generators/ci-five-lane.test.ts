// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { statSync } from 'node:fs'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateCiFiveLane } from '../../src/generators/ci-five-lane.js'

let dir: string

beforeEach(() => {
  dir = createTestProject()
})

afterEach(() => {
  cleanupTestProject(dir)
})

describe('generateCiFiveLane — opt-in gate', () => {
  it('returns empty when enableFiveLaneCi is false (default)', () => {
    const result = generateCiFiveLane(makeConfig(dir, { useGitHub: true }))
    expect(result.files).toHaveLength(0)
  })

  it('returns empty when enableFiveLaneCi is true but useGitHub/permitGitHub is false', () => {
    const result = generateCiFiveLane(makeConfig(dir, { enableFiveLaneCi: true, useGitHub: false }))
    expect(result.files).toHaveLength(0)
  })

  it('respects permitGitHub over useGitHub when both are set', () => {
    const result = generateCiFiveLane(
      makeConfig(dir, { enableFiveLaneCi: true, useGitHub: false, permitGitHub: true }),
    )
    expect(result.files).toHaveLength(5)
  })
})

describe('generateCiFiveLane — emitted artifact contract (A1)', () => {
  it('emits exactly 5 artifacts: 4 workflow files + 1 sticky-issue script', () => {
    const result = generateCiFiveLane(makeConfig(dir, { enableFiveLaneCi: true, useGitHub: true }))
    expect(result.files).toHaveLength(5)
  })

  it('emits the 4 workflow files under .github/workflows/', () => {
    const result = generateCiFiveLane(makeConfig(dir, { enableFiveLaneCi: true, useGitHub: true }))
    const paths = result.files.map((f) => f.path)
    for (const name of ['ci.yml', 'nightly.yml', 'weekly.yml', 'release.yml']) {
      expect(paths.some((p) => p.endsWith(join('.github', 'workflows', name)))).toBe(true)
    }
  })

  it('emits the shared sticky-failure-issue.sh script under .github/scripts/', () => {
    const result = generateCiFiveLane(makeConfig(dir, { enableFiveLaneCi: true, useGitHub: true }))
    const paths = result.files.map((f) => f.path)
    expect(
      paths.some((p) => p.endsWith(join('.github', 'scripts', 'sticky-failure-issue.sh'))),
    ).toBe(true)
  })

  it('chmods the sticky-failure-issue.sh script executable (0o755)', () => {
    generateCiFiveLane(makeConfig(dir, { enableFiveLaneCi: true, useGitHub: true }))
    const scriptPath = join(dir, '.github', 'scripts', 'sticky-failure-issue.sh')
    const mode = statSync(scriptPath).mode & 0o777
    expect(mode).toBe(0o755)
  })

  it('does not chmod when dryRun is true (nothing written)', () => {
    generateCiFiveLane(makeConfig(dir, { enableFiveLaneCi: true, useGitHub: true }), {
      dryRun: true,
    })
    const scriptPath = join(dir, '.github', 'scripts', 'sticky-failure-issue.sh')
    expect(() => statSync(scriptPath)).toThrow()
  })
})
