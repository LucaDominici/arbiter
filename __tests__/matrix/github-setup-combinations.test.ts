// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
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
  it('valid combo set is non-trivial (≥75 combinations)', () => {
    expect(COMBOS.length).toBeGreaterThanOrEqual(75)
  })

  it.each(COMBOS)(
    '$language-$archetype-$level emits scripts with valid content',
    ({ language, archetype, level }) => {
      const dir = createTestProject(language)
      try {
        const config = makeConfig(dir, {
          language,
          archetype,
          governanceLevel: level,
          useGitHub: true,
        })
        const result = generateGithubSetup(config)

        // #1331: +ci-classify-changes.mjs in every cell (L1: 6, L2/L3: 7).
        const expectedCount = level === 'L1' ? 6 : 7
        expect(
          result.files,
          `${language}-${archetype}-${level}: expected ${expectedCount} files`,
        ).toHaveLength(expectedCount)

        for (const f of result.files) {
          expect(existsSync(f.path), `${f.path} missing on disk`).toBe(true)
          const content = readFileSync(f.path, 'utf-8')
          expect(content, `${f.path} contains unrendered EJS opening tag`).not.toContain('<%')
          expect(content, `${f.path} contains unrendered EJS closing tag`).not.toContain('%>')
        }

        const hasSetup = result.files.some((f) => f.path.endsWith('setup-repo.sh'))
        expect(hasSetup, `setup-repo.sh expected for ${level}`).toBe(level !== 'L1')

        // Governance level must propagate into the L1/L2/L3-branching gate script.
        const pinsScript = result.files.find((f) => f.path.endsWith('check-action-pins.mjs'))
        expect(pinsScript).toBeDefined()
        const pinsContent = readFileSync(pinsScript!.path, 'utf-8')
        expect(
          pinsContent,
          `${language}-${archetype}-${level}: governance level not embedded`,
        ).toContain(`LEVEL = '${level}'`)

        for (const name of [
          'apply-branch-protection.mjs',
          'check-ci-tiers.mjs',
          'check-action-pins.mjs',
          'check-workflow-perms.mjs',
          'check-merge-method.mjs',
          'ci-classify-changes.mjs',
        ]) {
          expect(
            result.files.some((f) => f.path.endsWith(name)),
            `${name} missing for ${language}-${archetype}-${level}`,
          ).toBe(true)
        }
      } finally {
        cleanupTestProject(dir)
      }
    },
    30_000,
  )

  it('useGitHub=false returns empty across a sampled subset', () => {
    for (const { language, archetype, level } of COMBOS.slice(0, 6)) {
      const dir = createTestProject(language)
      try {
        const config = makeConfig(dir, {
          language,
          archetype,
          governanceLevel: level,
          useGitHub: false,
        })
        const result = generateGithubSetup(config)
        expect(result.files).toHaveLength(0)
      } finally {
        cleanupTestProject(dir)
      }
    }
  })
})
