// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { withPluginRenderDefaults } from '../../../src/utils/plugin-worker.js'

describe('withPluginRenderDefaults (#1751)', () => {
  it('injects isL2Plus/isL3Plus/isL4 mirroring the withLevelBooleans render boundary', () => {
    const result = withPluginRenderDefaults({ governanceLevel: 'L3' })
    expect(result).toMatchObject({ isL2Plus: true, isL3Plus: true, isL4: false })
  })

  it('marks isL4 true only at L4', () => {
    const result = withPluginRenderDefaults({ governanceLevel: 'L4' })
    expect(result).toMatchObject({ isL2Plus: true, isL3Plus: true, isL4: true })
  })

  it('leaves all level booleans false for L1', () => {
    const result = withPluginRenderDefaults({ governanceLevel: 'L1' })
    expect(result).toMatchObject({ isL2Plus: false, isL3Plus: false, isL4: false })
  })

  it('defaults to false for a missing/invalid governanceLevel rather than throwing', () => {
    const result = withPluginRenderDefaults({})
    expect(result).toMatchObject({ isL2Plus: false, isL3Plus: false, isL4: false })
  })

  it('still applies the #1348 basePackage default alongside the level booleans', () => {
    const result = withPluginRenderDefaults({ governanceLevel: 'L2' })
    expect(Object.prototype.hasOwnProperty.call(result, 'basePackage')).toBe(true)
    expect((result as Record<string, unknown>)['basePackage']).toBeUndefined()
  })

  it('does not mutate the input object', () => {
    const input = { governanceLevel: 'L2' as const }
    withPluginRenderDefaults(input)
    expect(input).toEqual({ governanceLevel: 'L2' })
  })
})
