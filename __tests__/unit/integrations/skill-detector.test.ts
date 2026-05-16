// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { detectInstalledSkills } from '../../../src/integrations/skill-detector.js'

const FIXTURES = join(
  process.env['VITEST_ROOT'] ?? join(import.meta.dirname, '../../..'),
  '__tests__/fixtures/skill-trees',
)

describe('detectInstalledSkills', () => {
  it('detects skills from plugin cache (scan location 3)', async () => {
    const skills = detectInstalledSkills({
      targetDir: '/nonexistent',
      claudeHome: join(FIXTURES, 'with-superpowers'),
    })
    expect(skills).toHaveLength(2)
    const tdd = skills.find((s) => s.skillId === 'superpowers:test-driven-development')
    expect(tdd).toBeDefined()
    expect(tdd?.pluginOwner).toBe('superpowers')
    expect(tdd?.version).toBe('5.0.0')
    expect(tdd?.role).toBe('TDD enforcement')
    const vbc = skills.find((s) => s.skillId === 'superpowers:verification-before-completion')
    expect(vbc).toBeDefined()
    expect(vbc?.role).toBe('completion-claim verification')
  })

  it('detects skills from targetDir local skills dir (scan location 2)', async () => {
    const skills = detectInstalledSkills({
      targetDir: join(FIXTURES, 'with-frontend-design'),
      claudeHome: '/nonexistent',
    })
    expect(skills).toHaveLength(1)
    const fd = skills.find((s) => s.skillId === 'frontend-design:frontend-design')
    expect(fd).toBeDefined()
    expect(fd?.pluginOwner).toBe('frontend-design')
    expect(fd?.role).toBe('UI/UX guidance for frontend-spa')
  })

  it('returns empty array when no skills found', async () => {
    const skills = detectInstalledSkills({
      targetDir: join(FIXTURES, 'empty'),
      claudeHome: join(FIXTURES, 'empty'),
    })
    expect(skills).toHaveLength(0)
  })

  it('silently skips malformed SKILL.md files', async () => {
    const skills = detectInstalledSkills({
      targetDir: join(FIXTURES, 'with-malformed'),
      claudeHome: '/nonexistent',
    })
    expect(skills).toHaveLength(0)
  })

  it('deduplicates skills by skillId (first hit wins)', async () => {
    // Both targetDir and claudeHome have the same skill — targetDir wins (scan 2 before 3)
    const skills = detectInstalledSkills({
      targetDir: join(FIXTURES, 'with-frontend-design'),
      claudeHome: join(FIXTURES, 'with-frontend-design'),
    })
    const fdSkills = skills.filter((s) => s.skillId === 'frontend-design:frontend-design')
    expect(fdSkills).toHaveLength(1)
  })

  it('handles nonexistent targetDir gracefully', async () => {
    const skills = detectInstalledSkills({
      targetDir: '/does/not/exist',
      claudeHome: '/also/does/not/exist',
    })
    expect(skills).toHaveLength(0)
  })
})
