// SPDX-License-Identifier: Apache-2.0
// A9 (#1817): Java test taxonomy gate — @Tag("unit")/@Tag("integration") enforced by a
// count gate (zero untagged tests allowed).

import { describe, it, expect } from 'vitest'
import {
  checkJavaTestTaxonomy,
  isTaxonomyGatePass,
} from '../../../src/kit/checks/java-test-taxonomy.js'

describe('checkJavaTestTaxonomy', () => {
  it('accepts a class tagged @Tag("unit")', () => {
    const result = checkJavaTestTaxonomy([
      {
        path: 'FooTest.java',
        content: '@Tag("unit")\nclass FooTest {\n  @Test void ok() {}\n}\n',
      },
    ])
    expect(result.untaggedFiles).toHaveLength(0)
    expect(result.totalFiles).toBe(1)
  })

  it('accepts a class tagged @Tag("integration")', () => {
    const result = checkJavaTestTaxonomy([
      {
        path: 'FooIT.java',
        content: '@Tag("integration")\nclass FooIT {\n  @Test void ok() {}\n}\n',
      },
    ])
    expect(result.untaggedFiles).toHaveLength(0)
  })

  it('flags a test file with no @Tag at all', () => {
    const result = checkJavaTestTaxonomy([
      { path: 'BarTest.java', content: 'class BarTest {\n  @Test void ok() {}\n}\n' },
    ])
    expect(result.untaggedFiles).toEqual(['BarTest.java'])
  })

  it('flags a test file tagged with an unrecognized tag only', () => {
    const result = checkJavaTestTaxonomy([
      {
        path: 'BazTest.java',
        content: '@Tag("slow")\nclass BazTest {\n  @Test void ok() {}\n}\n',
      },
    ])
    expect(result.untaggedFiles).toEqual(['BazTest.java'])
  })

  it('honors a custom requiredTags allowlist', () => {
    const result = checkJavaTestTaxonomy(
      [{ path: 'ArchTest.java', content: '@Tag("archunit")\nclass ArchTest {}\n' }],
      { requiredTags: ['archunit'] },
    )
    expect(result.untaggedFiles).toHaveLength(0)
  })

  it('reports zero untagged files for an empty input', () => {
    const result = checkJavaTestTaxonomy([])
    expect(result.totalFiles).toBe(0)
    expect(result.untaggedFiles).toHaveLength(0)
  })
})

describe('isTaxonomyGatePass', () => {
  it('passes when there are no untagged files', () => {
    expect(isTaxonomyGatePass({ totalFiles: 3, untaggedFiles: [], requiredTags: ['unit'] })).toBe(
      true,
    )
  })

  it('fails when at least one file is untagged', () => {
    expect(
      isTaxonomyGatePass({ totalFiles: 3, untaggedFiles: ['X.java'], requiredTags: ['unit'] }),
    ).toBe(false)
  })
})
