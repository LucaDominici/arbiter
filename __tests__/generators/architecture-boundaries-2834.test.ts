// SPDX-License-Identifier: Apache-2.0
// #2834 — declared `architecture` (components/deny) rendered into the TS/eslint
// boundaries generator instead of the fixed hexagonal layers. See ADR-123.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateEslintBoundaries, toBoundariesRules } from '../../src/generators/boundaries.js'

describe('toBoundariesRules — deny-list -> allow-list conversion (#2834)', () => {
  it('a component absent from any deny edge is allowed by default (adding a component is never itself a violation)', () => {
    const { elementTypeRules } = toBoundariesRules({
      components: { api: ['src/api/**'], db: ['src/db/**'], billing: ['src/billing/**'] },
      deny: ['db -> api'],
    })
    const billing = elementTypeRules.find((r) => r.from === 'billing')
    expect(billing?.allow.sort()).toEqual(['api', 'db'])
    const db = elementTypeRules.find((r) => r.from === 'db')
    expect(db?.allow.sort()).toEqual(['billing'])
    const api = elementTypeRules.find((r) => r.from === 'api')
    expect(api?.allow.sort()).toEqual(['billing', 'db'])
  })

  it('"comp -> *" denies every other declared component', () => {
    const { elementTypeRules } = toBoundariesRules({
      components: { core: ['src/core/**'], api: ['src/api/**'], db: ['src/db/**'] },
      deny: ['core -> *'],
    })
    expect(elementTypeRules.find((r) => r.from === 'core')?.allow).toEqual([])
    // core -> * says nothing about api/db, which stay mutually allowed.
    expect(elementTypeRules.find((r) => r.from === 'api')?.allow.sort()).toEqual(['core', 'db'])
  })

  it('flattens multiple globs per component into one element entry each', () => {
    const { elements } = toBoundariesRules({
      components: { api: ['src/api/**', 'src/http/**'] },
      deny: [],
    })
    expect(elements).toEqual([
      { type: 'api', pattern: 'src/api/**' },
      { type: 'api', pattern: 'src/http/**' },
    ])
  })
})

describe('generateEslintBoundaries — declared architecture (#2834)', () => {
  it('config absent + architectureStyle none: still emits nothing (regression zero)', () => {
    const dir = createTestProject('typescript')
    try {
      const result = generateEslintBoundaries(makeConfig(dir, { language: 'typescript' }))
      expect(result.files).toHaveLength(0)
    } finally {
      cleanupTestProject(dir)
    }
  })

  it('declared architecture emits files even without architectureStyle: hexagonal', () => {
    const dir = createTestProject('typescript')
    try {
      const result = generateEslintBoundaries(
        makeConfig(dir, {
          language: 'typescript',
          architectureStyle: 'none',
          architecture: {
            components: { api: ['src/api/**'], db: ['src/db/**'] },
            deny: ['db -> api'],
          },
        }),
      )
      expect(result.files.length).toBe(3)
      const flat = readFileSync(join(dir, 'eslint.config.boundaries.mjs'), 'utf-8')
      // Declared shape, not the hexagonal default.
      expect(flat).toContain('"type": "api"')
      expect(flat).toContain('"type": "db"')
      expect(flat).toContain('"from": "db"')
      expect(flat).not.toContain('src/domain/**')
      expect(flat).not.toContain('boundaries/external')
      expect(flat).not.toContain('<%')
      expect(flat).not.toContain('%>')
    } finally {
      cleanupTestProject(dir)
    }
  })

  it('existing hexagonal repos with no architecture section render byte-identical to before #2834', () => {
    const dir = createTestProject('typescript')
    try {
      generateEslintBoundaries(
        makeConfig(dir, { language: 'typescript', architectureStyle: 'hexagonal' }),
      )
      const flat = readFileSync(join(dir, 'eslint.config.boundaries.mjs'), 'utf-8')
      expect(flat).toContain('src/domain/**')
      expect(flat).toContain('boundaries/external')
      expect(flat).not.toContain('<%')
      expect(flat).not.toContain('%>')
    } finally {
      cleanupTestProject(dir)
    }
  })
})
