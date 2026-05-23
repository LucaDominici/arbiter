// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import {
  KIT_THRESHOLDS,
  resolveThreshold,
  languageToThresholdStack,
  type BrownfieldClass,
} from '../../src/kit/thresholds.js'

describe('KIT_THRESHOLDS — java stack', () => {
  it('has all four brownfield classes for JaCoCo line coverage', () => {
    const row = KIT_THRESHOLDS.java.jacoco.line
    expect(row.gold).toBe(0.8)
    expect(row.light).toBe(0.6)
    expect(row.medium).toBe(0.4)
    expect(row.heavy).toBe(0.2)
  })

  it('has all four brownfield classes for PITest mutationThreshold', () => {
    const row = KIT_THRESHOLDS.java.pitest.mutationThreshold
    expect(row.gold).toBe(80)
    expect(row.light).toBe(70)
    expect(row.medium).toBe(60)
    expect(row.heavy).toBe(0)
  })

  it('OWASP failBuildOnCVSS is always 7.0 regardless of brownfield class', () => {
    const row = KIT_THRESHOLDS.java.owasp.failBuildOnCVSS
    const classes: BrownfieldClass[] = ['gold', 'light', 'medium', 'heavy']
    for (const cls of classes) {
      expect(resolveThreshold(row, cls)).toBe(7.0)
    }
  })

  it('CheckStyle CyclomaticComplexity gold=15, heavy=25', () => {
    const row = KIT_THRESHOLDS.java.checkstyle.CyclomaticComplexity
    expect(row.gold).toBe(15)
    expect(row.heavy).toBe(25)
  })
})

describe('KIT_THRESHOLDS — typescript stack', () => {
  it('has all four brownfield classes for coverage lines', () => {
    const row = KIT_THRESHOLDS.typescript.coverage.lines
    expect(row.gold).toBe(85)
    expect(row.light).toBe(50)
    expect(row.medium).toBe(20)
    expect(row.heavy).toBe(5)
  })

  it('ESLint max_warnings gold=0, heavy=200', () => {
    const row = KIT_THRESHOLDS.typescript.eslint.max_warnings
    expect(row.gold).toBe(0)
    expect(row.heavy).toBe(200)
  })
})

describe('resolveThreshold', () => {
  it('returns correct value for each class', () => {
    const row = { gold: 10, new_code: 10, light: 20, medium: 30, heavy: 40 }
    expect(resolveThreshold(row, 'gold')).toBe(10)
    expect(resolveThreshold(row, 'light')).toBe(20)
    expect(resolveThreshold(row, 'medium')).toBe(30)
    expect(resolveThreshold(row, 'heavy')).toBe(40)
  })
})

describe('languageToThresholdStack', () => {
  it('maps java to java', () => {
    expect(languageToThresholdStack('java')).toBe('java')
  })

  it('maps typescript to typescript', () => {
    expect(languageToThresholdStack('typescript')).toBe('typescript')
  })

  it('returns null for unmapped stacks', () => {
    expect(languageToThresholdStack('python')).toBeNull()
    expect(languageToThresholdStack('go')).toBeNull()
    expect(languageToThresholdStack('rust')).toBeNull()
  })
})
