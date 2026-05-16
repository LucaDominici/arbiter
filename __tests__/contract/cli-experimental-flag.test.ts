// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { getExperiment, listExperiments, isEnabled } from '../../src/experimental/registry.js'
import { parseExperimentalArgv } from '../../src/experimental/index.js'

describe('cli experimental flag contract (#601)', () => {
  it('parseExperimentalArgv strips --experimental.<name> tokens from argv', () => {
    const experiments = listExperiments()
    if (experiments.length === 0) return
    const name = experiments[0]!.name
    const argv = ['node', 'arbiter', `--experimental.${name}`, 'init']
    const { remaining, flags } = parseExperimentalArgv(argv)
    expect(remaining).not.toContain(`--experimental.${name}`)
    expect(flags[name]).toBe(true)
  })

  it('parseExperimentalArgv rejects unknown experiment names', () => {
    const argv = ['node', 'arbiter', '--experimental.totally-unknown-xyz', 'init']
    expect(() => parseExperimentalArgv(argv)).toThrow(/unknown.*experiment/i)
  })

  it('parseExperimentalArgv preserves non-experimental args', () => {
    const argv = ['node', 'arbiter', '--verbose', 'init', '--dry-run']
    const { remaining } = parseExperimentalArgv(argv)
    expect(remaining).toContain('--verbose')
    expect(remaining).toContain('init')
    expect(remaining).toContain('--dry-run')
  })

  it('getExperiment throws on unknown name (registry rejects unknown keys)', () => {
    expect(() => getExperiment('does-not-exist')).toThrow()
  })

  it('isEnabled returns false for a known experiment when not in flags', () => {
    const experiments = listExperiments()
    if (experiments.length === 0) return
    const name = experiments[0]!.name
    expect(isEnabled(name, {})).toBe(false)
  })
})
