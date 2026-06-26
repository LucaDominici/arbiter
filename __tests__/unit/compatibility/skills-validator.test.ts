// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { validateSkillsMatrix } from '../../../src/compatibility/skills-validator.js'
import type { SkillsMatrix } from '../../../src/compatibility/skills-validator.js'
import { SKILL_NAMES } from '../../../src/generators/skills.js'

const VALID_MATRIX: SkillsMatrix = {
  $schemaVersion: 1,
  _lastUpdated: '2026-05-16',
  _refreshCadence: 'monthly',
  _promotionCriteria: 'test',
  skills: [
    {
      skillId: 'superpowers:test-driven-development',
      pluginOwner: 'superpowers',
      versionRange: '>=5.0.0',
      role: 'TDD enforcement',
      integrationStatus: 'proven',
      replaces: ['tdd'],
      referenceUrl: 'https://example.com',
    },
    {
      skillId: 'pr-review-toolkit:code-reviewer',
      pluginOwner: 'pr-review-toolkit',
      versionRange: '>=1.0.0',
      role: 'PR code review',
      integrationStatus: 'proven',
      replaces: [],
      referenceUrl: 'https://example.com',
    },
  ],
}

describe('validateSkillsMatrix', () => {
  it('accepts a valid matrix', () => {
    const result = validateSkillsMatrix(VALID_MATRIX)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('rejects matrix with invalid schemaVersion', () => {
    const bad = { ...VALID_MATRIX, $schemaVersion: 2 }
    const result = validateSkillsMatrix(bad as unknown as SkillsMatrix)
    expect(result.valid).toBe(false)
  })

  it('rejects skill with replaces entry not in SKILL_NAMES', () => {
    const bad: SkillsMatrix = {
      ...VALID_MATRIX,
      skills: [
        {
          skillId: 'some:skill',
          pluginOwner: 'some',
          versionRange: '>=1.0.0',
          role: 'test',
          integrationStatus: 'beta',
          replaces: ['nonexistent-skill-name'],
          referenceUrl: '',
        },
      ],
    }
    const result = validateSkillsMatrix(bad)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('nonexistent-skill-name'))).toBe(true)
  })

  it('rejects skill with invalid integrationStatus', () => {
    const bad = {
      ...VALID_MATRIX,
      skills: [
        {
          ...VALID_MATRIX.skills[0],
          integrationStatus: 'invalid-status',
        },
      ],
    }
    const result = validateSkillsMatrix(bad as unknown as SkillsMatrix)
    expect(result.valid).toBe(false)
  })

  it('rejects missing required fields', () => {
    const bad = {
      ...VALID_MATRIX,
      skills: [{ skillId: 'foo:bar' }],
    }
    const result = validateSkillsMatrix(bad as unknown as SkillsMatrix)
    expect(result.valid).toBe(false)
  })

  // #1559: the validator allow-list must derive from the canonical SKILL_NAMES
  // SSOT — not a stale hand-copy. gold-audit and levelup are legitimate
  // canonical skills that the old 12-entry hand-copy silently omitted.
  it('accepts gold-audit and levelup in replaces (regression for SSOT drift)', () => {
    const withDrifted: SkillsMatrix = {
      ...VALID_MATRIX,
      skills: [
        {
          skillId: 'superpowers:levelup',
          pluginOwner: 'superpowers',
          versionRange: '>=1.0.0',
          role: 'level-up loop',
          integrationStatus: 'beta',
          replaces: ['gold-audit', 'levelup'],
          referenceUrl: '',
        },
      ],
    }
    const result = validateSkillsMatrix(withDrifted)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  // #1559: assert the validator accepts EVERY canonical name — derived from the
  // SSOT so a future name addition cannot silently drift out of the allow-list.
  it('accepts all valid SKILL_NAMES in replaces', () => {
    const allSkillNames = [...SKILL_NAMES]
    const withAll: SkillsMatrix = {
      ...VALID_MATRIX,
      skills: [
        {
          skillId: 'some:skill',
          pluginOwner: 'some',
          versionRange: '>=1.0.0',
          role: 'all-in-one',
          integrationStatus: 'proven',
          replaces: allSkillNames,
          referenceUrl: '',
        },
      ],
    }
    const result = validateSkillsMatrix(withAll)
    expect(result.valid).toBe(true)
  })
})
