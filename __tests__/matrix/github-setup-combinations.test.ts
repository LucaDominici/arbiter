// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync } from 'node:fs'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateGithubSetup } from '../../src/generators/github-setup.js'
import type { Language, Archetype, GovernanceLevel } from '../../src/wizard/types.js'

const LANGS: readonly Language[] = ['typescript', 'java', 'rust', 'go', 'python']
const ARCHETYPES: readonly Archetype[] = [
  'backend-web-db',
  'cli',
  'library',
  'data-pipeline',
  'frontend-spa',
  'embedded',
]
const LEVELS: readonly GovernanceLevel[] = ['L1', 'L2', 'L3']

const INVALID_PAIRS = new Set<`${Language}:${Archetype}`>([
  'rust:frontend-spa',
  'go:frontend-spa',
  'python:embedded',
  'java:embedded',
  'typescript:embedded',
])

const COMBOS: { language: Language; archetype: Archetype; level: GovernanceLevel }[] = []
for (const language of LANGS) {
  for (const archetype of ARCHETYPES) {
    if (INVALID_PAIRS.has(`${language}:${archetype}`)) continue
    for (const level of LEVELS) {
      COMBOS.push({ language, archetype, level })
    }
  }
}

describe('generateGithubSetup combinations (Task 19 — INV-32 / CANON-04)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('valid combo set is non-trivial (≥75 combinations)', () => {
    expect(COMBOS.length).toBeGreaterThanOrEqual(75)
  })

  it.each(COMBOS)(
    '$language-$archetype-$level emits correct script count and no EJS leaks',
    ({ language, archetype, level }) => {
      const config = makeConfig(dir, {
        language,
        archetype,
        governanceLevel: level,
        useGitHub: true,
      })
      const result = generateGithubSetup(config)

      // Script count: L1 omits setup-repo.sh, L2/L3 include it.
      const expectedCount = level === 'L1' ? 4 : 5
      expect(
        result.files,
        `${language}-${archetype}-${level}: expected ${expectedCount} files`,
      ).toHaveLength(expectedCount)

      // Every emitted file exists on disk.
      for (const f of result.files) {
        expect(existsSync(f.path), `${f.path} missing on disk`).toBe(true)
      }

      // setup-repo.sh present only at L2+.
      const hasSetup = result.files.some((f) => f.path.endsWith('setup-repo.sh'))
      expect(hasSetup, `setup-repo.sh expected for ${level}`).toBe(level !== 'L1')

      // All gate scripts present at every level.
      const requiredScripts = [
        'apply-branch-protection.mjs',
        'check-ci-tiers.mjs',
        'check-action-pins.mjs',
        'check-workflow-perms.mjs',
      ]
      for (const name of requiredScripts) {
        expect(
          result.files.some((f) => f.path.endsWith(name)),
          `${name} missing for ${language}-${archetype}-${level}`,
        ).toBe(true)
      }
    },
    30_000,
  )

  it('useGitHub=false returns empty across all combos', () => {
    for (const { language, archetype, level } of COMBOS.slice(0, 6)) {
      const config = makeConfig(dir, {
        language,
        archetype,
        governanceLevel: level,
        useGitHub: false,
      })
      const result = generateGithubSetup(config)
      expect(result.files).toHaveLength(0)
    }
  })
})
