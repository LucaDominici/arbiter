// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateGithub } from '../../src/generators/github.js'
import { makeConfig } from '../helpers.js'

// CI gap closure generator tests (ADR-053)
// Verifies generateCiGapWorkflows() emits correct files per collaborationMode × governanceLevel

describe('generateGithub — CI gap workflows (ADR-053)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-ci-gap-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  // ─── trunk-solo: nightly-lite ───────────────────────────────────────────────

  it('trunk-solo L2: 06-nightly-lite.yml emitted', () => {
    generateGithub(makeConfig(dir, { collaborationMode: 'trunk-solo', governanceLevel: 'L2' }))
    expect(existsSync(join(dir, '.github', 'workflows', '06-nightly-lite.yml'))).toBe(true)
  })

  it('trunk-solo L2: 06-nightly.yml NOT emitted (lite replaces full nightly)', () => {
    generateGithub(makeConfig(dir, { collaborationMode: 'trunk-solo', governanceLevel: 'L2' }))
    expect(existsSync(join(dir, '.github', 'workflows', '06-nightly.yml'))).toBe(false)
  })

  it('trunk-solo L1: 06-nightly-lite.yml NOT emitted (L1 has no nightly)', () => {
    generateGithub(makeConfig(dir, { collaborationMode: 'trunk-solo', governanceLevel: 'L1' }))
    expect(existsSync(join(dir, '.github', 'workflows', '06-nightly-lite.yml'))).toBe(false)
  })

  it('peer-review L2: 06-nightly-lite.yml NOT emitted (peer-review uses full nightly)', () => {
    generateGithub(makeConfig(dir, { collaborationMode: 'peer-review', governanceLevel: 'L2' }))
    expect(existsSync(join(dir, '.github', 'workflows', '06-nightly-lite.yml'))).toBe(false)
  })

  // ─── PORT A2 (#1502): trunk-solo L3+ weekly-lite ───────────────────────────

  it('trunk-solo L3: 07-weekly-lite.yml emitted', () => {
    generateGithub(makeConfig(dir, { collaborationMode: 'trunk-solo', governanceLevel: 'L3' }))
    expect(existsSync(join(dir, '.github', 'workflows', '07-weekly-lite.yml'))).toBe(true)
  })

  it('trunk-solo L4: 07-weekly-lite.yml emitted', () => {
    generateGithub(makeConfig(dir, { collaborationMode: 'trunk-solo', governanceLevel: 'L4' }))
    expect(existsSync(join(dir, '.github', 'workflows', '07-weekly-lite.yml'))).toBe(true)
  })

  it('trunk-solo L2: 07-weekly-lite.yml NOT emitted (L3+ only)', () => {
    generateGithub(makeConfig(dir, { collaborationMode: 'trunk-solo', governanceLevel: 'L2' }))
    expect(existsSync(join(dir, '.github', 'workflows', '07-weekly-lite.yml'))).toBe(false)
  })

  it('trunk-solo L3: full 07-weekly.yml NOT emitted (lite replaces it for solo)', () => {
    generateGithub(makeConfig(dir, { collaborationMode: 'trunk-solo', governanceLevel: 'L3' }))
    expect(existsSync(join(dir, '.github', 'workflows', '07-weekly.yml'))).toBe(false)
  })

  it('peer-review L3: 07-weekly-lite.yml NOT emitted (peer-review uses full weekly)', () => {
    generateGithub(makeConfig(dir, { collaborationMode: 'peer-review', governanceLevel: 'L3' }))
    expect(existsSync(join(dir, '.github', 'workflows', '07-weekly-lite.yml'))).toBe(false)
  })

  // ─── peer-review: codeql + dep-review in 01-pr-fast ────────────────────────

  it('peer-review L2: 15-codeql.yml emitted', () => {
    generateGithub(makeConfig(dir, { collaborationMode: 'peer-review', governanceLevel: 'L2' }))
    expect(existsSync(join(dir, '.github', 'workflows', '15-codeql.yml'))).toBe(true)
  })

  it('peer-review L1: 15-codeql.yml NOT emitted', () => {
    generateGithub(makeConfig(dir, { collaborationMode: 'peer-review', governanceLevel: 'L1' }))
    expect(existsSync(join(dir, '.github', 'workflows', '15-codeql.yml'))).toBe(false)
  })

  it('trunk-solo L2: 15-codeql.yml NOT emitted (trunk-solo uses lighter CI)', () => {
    generateGithub(makeConfig(dir, { collaborationMode: 'trunk-solo', governanceLevel: 'L2' }))
    expect(existsSync(join(dir, '.github', 'workflows', '15-codeql.yml'))).toBe(false)
  })

  // ─── peer-review + web archetype: frontend quality ─────────────────────────

  it('peer-review L2 + frontend-spa archetype: 16-frontend-quality.yml emitted', () => {
    generateGithub(
      makeConfig(dir, {
        collaborationMode: 'peer-review',
        governanceLevel: 'L2',
        archetype: 'frontend-spa',
      }),
    )
    expect(existsSync(join(dir, '.github', 'workflows', '16-frontend-quality.yml'))).toBe(true)
  })

  it('gated-review L2 + frontend-spa archetype: 16-frontend-quality.yml emitted', () => {
    generateGithub(
      makeConfig(dir, {
        collaborationMode: 'gated-review',
        governanceLevel: 'L2',
        archetype: 'frontend-spa',
      }),
    )
    expect(existsSync(join(dir, '.github', 'workflows', '16-frontend-quality.yml'))).toBe(true)
  })

  it('trunk-solo L2 + frontend-spa archetype: 16-frontend-quality.yml NOT emitted', () => {
    generateGithub(
      makeConfig(dir, {
        collaborationMode: 'trunk-solo',
        governanceLevel: 'L2',
        archetype: 'frontend-spa',
      }),
    )
    expect(existsSync(join(dir, '.github', 'workflows', '16-frontend-quality.yml'))).toBe(false)
  })

  it('peer-review L2 + library archetype: 16-frontend-quality.yml NOT emitted', () => {
    generateGithub(
      makeConfig(dir, {
        collaborationMode: 'peer-review',
        governanceLevel: 'L2',
        archetype: 'library',
      }),
    )
    expect(existsSync(join(dir, '.github', 'workflows', '16-frontend-quality.yml'))).toBe(false)
  })

  // ─── gated-review + L3+: OSSF Scorecard ────────────────────────────────────

  it('gated-review L3: 17-ossf-scorecard.yml emitted', () => {
    generateGithub(makeConfig(dir, { collaborationMode: 'gated-review', governanceLevel: 'L3' }))
    expect(existsSync(join(dir, '.github', 'workflows', '17-ossf-scorecard.yml'))).toBe(true)
  })

  it('gated-review L4: 17-ossf-scorecard.yml emitted', () => {
    generateGithub(makeConfig(dir, { collaborationMode: 'gated-review', governanceLevel: 'L4' }))
    expect(existsSync(join(dir, '.github', 'workflows', '17-ossf-scorecard.yml'))).toBe(true)
  })

  it('gated-review L2: 17-ossf-scorecard.yml NOT emitted (L3+ only)', () => {
    generateGithub(makeConfig(dir, { collaborationMode: 'gated-review', governanceLevel: 'L2' }))
    expect(existsSync(join(dir, '.github', 'workflows', '17-ossf-scorecard.yml'))).toBe(false)
  })

  it('peer-review L3: 17-ossf-scorecard.yml NOT emitted (gated-review only)', () => {
    generateGithub(makeConfig(dir, { collaborationMode: 'peer-review', governanceLevel: 'L3' }))
    expect(existsSync(join(dir, '.github', 'workflows', '17-ossf-scorecard.yml'))).toBe(false)
  })

  // ─── gated-review: also emits codeql (gated-review always gets it) ──────────

  it('gated-review L2: 15-codeql.yml emitted (gated-review always gets CodeQL)', () => {
    generateGithub(makeConfig(dir, { collaborationMode: 'gated-review', governanceLevel: 'L2' }))
    expect(existsSync(join(dir, '.github', 'workflows', '15-codeql.yml'))).toBe(true)
  })

  it('gated-review L1: 15-codeql.yml emitted (gated-review has no level restriction for CodeQL)', () => {
    generateGithub(makeConfig(dir, { collaborationMode: 'gated-review', governanceLevel: 'L1' }))
    expect(existsSync(join(dir, '.github', 'workflows', '15-codeql.yml'))).toBe(true)
  })

  it('peer-review L2 + rust language: 15-codeql.yml NOT emitted (Rust unsupported by CodeQL)', () => {
    generateGithub(
      makeConfig(dir, {
        collaborationMode: 'peer-review',
        governanceLevel: 'L2',
        language: 'rust',
        buildTool: 'cargo',
      }),
    )
    expect(existsSync(join(dir, '.github', 'workflows', '15-codeql.yml'))).toBe(false)
  })
})
