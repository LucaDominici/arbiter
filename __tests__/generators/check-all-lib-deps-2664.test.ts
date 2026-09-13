// SPDX-License-Identifier: Apache-2.0
// #2664: unit coverage for `extractLibDependencies`'s `libTemplateExists(name)
// ? resolved : unresolved` branch (src/generators/check-all.ts) — both arms,
// against a synthetic rendered string. No mocking: `extractLibDependencies`
// is a pure function of its string argument.
import { describe, it, expect } from 'vitest'
import { extractLibDependencies } from '../../src/generators/check-all.js'

describe('#2664 unit coverage: extractLibDependencies resolved/unresolved split', () => {
  it('a real lib module resolves, a made-up one is unresolved', () => {
    const rendered = `
import { runCheck } from './lib/run-helpers.mjs';
import { GATE_MUTEX_HELD_ENV } from './lib/gate-mutex.mjs';
import { totallyMadeUp } from './lib/this-module-does-not-exist.mjs';
`
    const { resolved, unresolved } = extractLibDependencies(rendered)
    expect(resolved).toContain('scripts/lib/run-helpers.mjs')
    expect(resolved).toContain('scripts/lib/gate-mutex.mjs')
    expect(resolved).not.toContain('scripts/lib/this-module-does-not-exist.mjs')
    expect(unresolved).toEqual(['scripts/lib/this-module-does-not-exist.mjs'])
  })

  it('an empty/no-import source resolves nothing and is not an error', () => {
    const { resolved, unresolved } = extractLibDependencies('// no lib imports here\n')
    expect(resolved).toEqual([])
    expect(unresolved).toEqual([])
  })
})
