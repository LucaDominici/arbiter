import { describe, it, expect } from 'vitest'
import { getRequiredPatches } from '../../src/notary/patch-deps.js'

describe('getRequiredPatches', () => {
  it('returns SSOT_CORE_SET.md for docs/SYSTEM/ markdown files', () => {
    const patches = getRequiredPatches('docs/SYSTEM/CANON.md')
    expect(patches).toContain('docs/SSOT_CORE_SET.md')
  })

  it('returns KNOWLEDGE_MAP.md for docs/ markdown files', () => {
    const patches = getRequiredPatches('docs/ARCHITECTURE.md')
    expect(patches).toContain('docs/KNOWLEDGE_MAP.md')
  })

  it('returns empty array for non-doc files', () => {
    const patches = getRequiredPatches('src/commands/init.ts')
    expect(patches).toEqual([])
  })

  it('returns empty array for exempted paths', () => {
    const patches = getRequiredPatches('.evidence/run-001.json')
    expect(patches).toEqual([])
  })

  it('returns empty array for .claude/plans/ files', () => {
    const patches = getRequiredPatches('.claude/plans/plan-001.md')
    expect(patches).toEqual([])
  })

  it('returns both index files for docs/SYSTEM/ content', () => {
    const patches = getRequiredPatches('docs/SYSTEM/DECISIONS.md')
    expect(patches).toContain('docs/SSOT_CORE_SET.md')
    expect(patches).toContain('docs/KNOWLEDGE_MAP.md')
  })
})
