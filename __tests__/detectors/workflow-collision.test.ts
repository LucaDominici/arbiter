// SPDX-License-Identifier: Apache-2.0
// PORT B2 (#1502): `arbiter update` adds the numbered workflows without reconciling
// pre-existing LEGACY workflows whose triggers collide (double-running CI, two
// signing/SBOM runs racing on one tag). The detector must fire a loud warning on a
// real collision and stay silent when there is none. Pure helpers + a fixture
// target dir on disk — no network, no git.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  classifyTriggers,
  isArbiterOwnedWorkflow,
  detectLegacyWorkflowCollisions,
  detectLegacyWorkflowCollisionWarning,
} from '../../src/detectors/workflow-collision.js'

describe('classifyTriggers (B2 #1502)', () => {
  it('classifies push-to-branches + pull_request as pr-push', () => {
    const c = classifyTriggers({
      push: { branches: ['main'] },
      pull_request: { branches: ['main'] },
    })
    expect([...c]).toEqual(['pr-push'])
  })

  it('classifies push-to-tags as release (tags), NOT pr-push', () => {
    const c = classifyTriggers({ push: { tags: ['v*.*.*'] } })
    expect(c.has('tags')).toBe(true)
    expect(c.has('pr-push')).toBe(false)
  })

  it('classifies a push with BOTH branches and tags as both classes', () => {
    const c = classifyTriggers({ push: { branches: ['main'], tags: ['v*'] } })
    expect(c.has('pr-push')).toBe(true)
    expect(c.has('tags')).toBe(true)
  })

  it('classifies schedule', () => {
    expect(classifyTriggers({ schedule: [{ cron: '0 3 * * 0' }] }).has('schedule')).toBe(true)
  })

  it('handles array and string on-specs (bare push = all branches = pr-push)', () => {
    expect(classifyTriggers(['push', 'pull_request']).has('pr-push')).toBe(true)
    expect(classifyTriggers('push').has('pr-push')).toBe(true)
  })

  it('returns empty for null / unrecognized events', () => {
    expect(classifyTriggers(null).size).toBe(0)
    expect(classifyTriggers({ workflow_dispatch: {} }).size).toBe(0)
  })
})

describe('isArbiterOwnedWorkflow', () => {
  it('treats numbered + underscore + fixed set as arbiter-owned', () => {
    for (const f of [
      '01-pr-fast.yml',
      '05-release.yml',
      '_sigstore-retry-sign.yml',
      'issue-state.yml',
    ])
      expect(isArbiterOwnedWorkflow(f)).toBe(true)
  })
  it('treats user files as legacy', () => {
    for (const f of ['ci.yml', 'release.yml', 'mutation.yml', 'deploy.yaml'])
      expect(isArbiterOwnedWorkflow(f)).toBe(false)
  })
})

describe('detectLegacyWorkflowCollisions (fixture target)', () => {
  let dir: string
  let wf: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arb-b2-'))
    wf = join(dir, '.github', 'workflows')
    mkdirSync(wf, { recursive: true })
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const write = (name: string, body: string): void => writeFileSync(join(wf, name), body)

  it('fires when a legacy release.yml collides with the emitted 05-release.yml', () => {
    write('05-release.yml', "name: release\non:\n  push:\n    tags: ['v*']\n")
    write('release.yml', "name: legacy release\non:\n  push:\n    tags: ['v*.*.*']\n")
    const collisions = detectLegacyWorkflowCollisions(dir)
    expect(collisions).toHaveLength(1)
    expect(collisions[0]).toMatchObject({
      legacyFile: 'release.yml',
      triggerClass: 'tags',
      supersededBy: '05-release.yml',
    })
    const warning = detectLegacyWorkflowCollisionWarning(dir)
    expect(warning).toContain('release.yml')
    expect(warning).toContain('05-release.yml')
    expect(warning).toContain('race')
  })

  it('fires for a legacy ci.yml (push+PR) colliding with 01-pr-fast.yml', () => {
    write('01-pr-fast.yml', 'name: pr-fast\non:\n  pull_request:\n  push:\n    branches: [main]\n')
    write(
      'ci.yml',
      'name: legacy ci\non:\n  pull_request:\n    branches: [main]\n  push:\n    branches: [main]\n',
    )
    const warning = detectLegacyWorkflowCollisionWarning(dir)
    expect(warning).not.toBeNull()
    expect(warning).toContain('ci.yml')
    expect(warning).toContain('01-pr-fast.yml')
    expect(warning).toContain('double-run')
  })

  it('lists BOTH ci.yml and release.yml when both collide', () => {
    write('01-pr-fast.yml', 'on:\n  pull_request:\n')
    write('05-release.yml', "on:\n  push:\n    tags: ['v*']\n")
    write('ci.yml', 'on:\n  push:\n    branches: [main]\n')
    write('release.yml', "on:\n  push:\n    tags: ['v*.*.*']\n")
    const collisions = detectLegacyWorkflowCollisions(dir)
    expect(collisions.map((c) => c.legacyFile).sort()).toEqual(['ci.yml', 'release.yml'])
  })

  it('is SILENT when the legacy workflow trigger does not overlap any numbered set', () => {
    write('01-pr-fast.yml', 'on:\n  pull_request:\n')
    write('docs.yml', 'name: docs\non:\n  workflow_dispatch:\n')
    expect(detectLegacyWorkflowCollisionWarning(dir)).toBeNull()
  })

  it('is SILENT when the superseding numbered workflow is NOT present', () => {
    // legacy release.yml on tags, but no 05-release.yml emitted (starter style)
    write('01-pr-fast.yml', 'on:\n  pull_request:\n')
    write('release.yml', "on:\n  push:\n    tags: ['v*.*.*']\n")
    expect(detectLegacyWorkflowCollisionWarning(dir)).toBeNull()
  })

  it('is SILENT on a clean numbered-only tree (no legacy files)', () => {
    write('01-pr-fast.yml', 'on:\n  pull_request:\n')
    write('05-release.yml', "on:\n  push:\n    tags: ['v*']\n")
    expect(detectLegacyWorkflowCollisionWarning(dir)).toBeNull()
  })

  it('returns empty when no workflows dir exists', () => {
    const empty = mkdtempSync(join(tmpdir(), 'arb-b2-empty-'))
    expect(detectLegacyWorkflowCollisions(empty)).toEqual([])
    rmSync(empty, { recursive: true, force: true })
  })
})
