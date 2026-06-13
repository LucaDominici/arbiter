// SPDX-License-Identifier: Apache-2.0
// #1330: the per-lane frontend CI workflow (18-frontend-lane.yml) is emitted
// for a subtree frontend lane (non-frontend-spa archetype) at L2+ under a
// review-based collaboration mode, and NOT otherwise.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateGithub } from '../../src/generators/github.js'
import { makeConfig } from '../helpers.js'

const WF = join('.github', 'workflows', '18-frontend-lane.yml')

describe('generateGithub — per-lane frontend gate workflow (#1330)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-fe-lane-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('emits 18-frontend-lane.yml for a Go-primary subtree frontend lane at L2 (peer-review)', () => {
    generateGithub(
      makeConfig(dir, {
        language: 'go',
        archetype: 'library',
        lanes: ['frontend'],
        governanceLevel: 'L2',
        collaborationMode: 'peer-review',
        permitGitHub: true,
      }),
    )
    expect(existsSync(join(dir, WF))).toBe(true)
  })

  it('does NOT emit for the frontend-spa archetype (root-level FE quality workflow covers it)', () => {
    generateGithub(
      makeConfig(dir, {
        language: 'typescript',
        archetype: 'frontend-spa',
        lanes: ['frontend'],
        governanceLevel: 'L2',
        collaborationMode: 'peer-review',
        permitGitHub: true,
      }),
    )
    expect(existsSync(join(dir, WF))).toBe(false)
  })

  it('does NOT emit when no frontend lane is declared', () => {
    generateGithub(
      makeConfig(dir, {
        language: 'go',
        archetype: 'library',
        lanes: ['docs'],
        governanceLevel: 'L2',
        collaborationMode: 'peer-review',
        permitGitHub: true,
      }),
    )
    expect(existsSync(join(dir, WF))).toBe(false)
  })

  it('does NOT emit at L1 (matches FE-quality gating convention)', () => {
    generateGithub(
      makeConfig(dir, {
        language: 'go',
        archetype: 'library',
        lanes: ['frontend'],
        governanceLevel: 'L1',
        collaborationMode: 'peer-review',
        permitGitHub: true,
      }),
    )
    expect(existsSync(join(dir, WF))).toBe(false)
  })

  it('emitted workflow triggers on frontend/** and installs subtree deps', () => {
    generateGithub(
      makeConfig(dir, {
        language: 'go',
        archetype: 'library',
        lanes: ['frontend'],
        governanceLevel: 'L2',
        collaborationMode: 'peer-review',
        permitGitHub: true,
      }),
    )
    const wf = readFileSync(join(dir, WF), 'utf-8')
    expect(wf).toContain("'frontend/**'")
    expect(wf).toContain('npm ci --prefix frontend')
    expect(wf).toContain('node scripts/check-frontend-lane.mjs full')
  })
})
