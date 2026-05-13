import { describe, it, expect } from 'vitest'
import {
  classifyPath,
  isClassified,
  assertClassified,
  highestRisk,
  UNCLASSIFIED_LEVEL,
} from '../../src/risk/classifier.js'

describe('classifyPath (#238)', () => {
  it('javascript: classifies migrations as R0 (highest risk)', () => {
    expect(classifyPath('src/db/migrations/001_init.sql', 'typescript')).toBe('R0')
  })

  it('javascript: classifies auth code as R1', () => {
    expect(classifyPath('src/auth/login.ts', 'typescript')).toBe('R1')
  })

  it('javascript: classifies API handlers as R2', () => {
    expect(classifyPath('src/api/users.ts', 'typescript')).toBe('R2')
  })

  it('javascript: classifies UI components as R3', () => {
    expect(classifyPath('src/components/Button.tsx', 'typescript')).toBe('R3')
  })

  it('javascript: classifies docs/test scaffolding as R4 (lowest risk)', () => {
    expect(classifyPath('README.md', 'typescript')).toBe('R4')
    expect(classifyPath('docs/intro.md', 'typescript')).toBe('R4')
  })

  it('python: classifies migrations as R0', () => {
    expect(classifyPath('alembic/versions/001_init.py', 'python')).toBe('R0')
  })

  it('python: classifies auth modules as R1', () => {
    expect(classifyPath('app/auth/middleware.py', 'python')).toBe('R1')
  })

  it('rust: classifies unsafe blocks as R0', () => {
    expect(classifyPath('src/core/unsafe_ops.rs', 'rust')).toBe('R0')
  })

  it('rust: classifies regular .rs files as R2 default', () => {
    expect(classifyPath('src/server/router.rs', 'rust')).toBe('R2')
  })

  it('returns UNCLASSIFIED for unknown languages (no opinion)', () => {
    expect(classifyPath('foo/bar.txt', 'unknown' as never)).toBe(UNCLASSIFIED_LEVEL)
  })

  it('returns UNCLASSIFIED on invalid input (empty path)', () => {
    expect(classifyPath('', 'typescript')).toBe(UNCLASSIFIED_LEVEL)
  })

  it('returns UNCLASSIFIED when no rule matches the path', () => {
    expect(classifyPath('random/file.xyz', 'typescript')).toBe(UNCLASSIFIED_LEVEL)
  })
})

describe('isClassified / assertClassified (#238)', () => {
  it('isClassified true for R0..R4', () => {
    for (const l of ['R0', 'R1', 'R2', 'R3', 'R4'] as const) {
      expect(isClassified(l)).toBe(true)
    }
  })

  it('isClassified false for UNCLASSIFIED', () => {
    expect(isClassified(UNCLASSIFIED_LEVEL)).toBe(false)
  })

  it('assertClassified returns the level when classified', () => {
    expect(assertClassified('R2')).toBe('R2')
  })

  it('assertClassified throws on UNCLASSIFIED (fail-closed)', () => {
    expect(() => assertClassified(UNCLASSIFIED_LEVEL, 'test path')).toThrow(
      /UNCLASSIFIED.*test path/,
    )
  })
})

describe('highestRisk (#238)', () => {
  it('picks the highest-risk level (R0 wins over R4)', () => {
    expect(highestRisk(['R4', 'R0', 'R2'])).toBe('R0')
  })

  it('returns the only level when given a singleton', () => {
    expect(highestRisk(['R3'])).toBe('R3')
  })

  it('UNCLASSIFIED in any input poisons the combined result (fail-closed)', () => {
    expect(highestRisk(['R0', UNCLASSIFIED_LEVEL])).toBe(UNCLASSIFIED_LEVEL)
  })

  it('returns UNCLASSIFIED for an empty input set', () => {
    expect(highestRisk([])).toBe(UNCLASSIFIED_LEVEL)
  })
})
