// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  renderTemplate,
  renderFromAbsPath,
  withBasePackageDefault,
  withLevelBooleans,
  withServiceBucket,
  resolveServiceBucket,
} from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

// #1348: `init --language multi` (no basePackage) crashed rc=2 because bare
// `basePackage` references in Java EJS templates throw ReferenceError under
// EJS `with(locals)` when the key is absent from the render data. The render
// boundary must guarantee `basePackage` is always a defined (own) key so each
// template renders its own authored fallback instead of throwing.

const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'templates')

/** A config matching the real `--language multi` path: NO own `basePackage` key. */
function multiConfigWithoutBasePackage(): Record<string, unknown> {
  const cfg = makeConfig('/tmp/test', { language: 'multi' }) as unknown as Record<string, unknown>
  // makeConfig always sets basePackage: undefined as an own key; the real init
  // path omits the key entirely when no package is detected. Delete it to match.
  delete cfg['basePackage']
  return cfg
}

describe('#1348 — render boundary tolerates absent basePackage', () => {
  it('PactVerificationIT.java.ejs does not throw and uses its com.example fallback', () => {
    const data = multiConfigWithoutBasePackage()
    let out = ''
    expect(() => {
      out = renderTemplate('contract-testing/rest-owned/PactVerificationIT.java.ejs', data)
    }).not.toThrow()
    expect(out).toContain('package com.example.contracts;')
  })

  it('NoH2ArchTest.java.ejs does not throw and uses its relative-package fallback', () => {
    const data = multiConfigWithoutBasePackage()
    let out = ''
    expect(() => {
      out = renderTemplate('integration-testing/NoH2ArchTest.java.ejs', data)
    }).not.toThrow()
    expect(out).toContain('package architecture;')
  })

  it('preserves an explicit basePackage (regression: existing behavior unchanged)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'java',
      basePackage: 'com.acme',
    }) as unknown as Record<string, unknown>
    const out = renderTemplate('contract-testing/rest-owned/PactVerificationIT.java.ejs', data)
    expect(out).toContain('package com.acme.contracts;')
  })

  it('renderFromAbsPath (plugin path) also tolerates absent basePackage', () => {
    const abs = join(TEMPLATES_DIR, 'integration-testing', 'NoH2ArchTest.java.ejs')
    expect(() => renderFromAbsPath(abs, {})).not.toThrow()
    expect(renderFromAbsPath(abs, {})).toContain('package architecture;')
  })
})

describe('#1348 — withBasePackageDefault helper', () => {
  it('returns the same reference when basePackage key is already present', () => {
    const data = { basePackage: 'com.x', other: 1 }
    expect(withBasePackageDefault(data)).toBe(data)
  })

  it('returns the same reference when basePackage is an own undefined key', () => {
    const data = { basePackage: undefined, other: 1 }
    expect(withBasePackageDefault(data)).toBe(data)
  })

  it('adds an own basePackage=undefined key when absent, without mutating input', () => {
    const data = { other: 1 }
    const out = withBasePackageDefault(data) as Record<string, unknown>
    expect(Object.prototype.hasOwnProperty.call(out, 'basePackage')).toBe(true)
    expect(out['basePackage']).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(data, 'basePackage')).toBe(false)
  })
})

// #1720 — L4 was silently downgraded below L3 because `levelAtLeast` (the ordinal
// SSOT, src/config/levels.ts, #1516) was never injected into the EJS render
// context. `withLevelBooleans` guarantees `isL2Plus`/`isL3Plus`/`isL4` are own
// keys (no ReferenceError under EJS `with(locals)`) and ALWAYS recomputes them
// from `governanceLevel` — unlike `withBasePackageDefault`'s only-if-absent
// policy, a caller-supplied stale flag must never shadow the SSOT (that would
// reintroduce the exact hand-rolled-boolean bug class this fix kills).
describe('#1720 — withLevelBooleans helper', () => {
  it('L4: isL2Plus, isL3Plus, isL4 all true', () => {
    const out = withLevelBooleans({ governanceLevel: 'L4' }) as Record<string, unknown>
    expect(out['isL2Plus']).toBe(true)
    expect(out['isL3Plus']).toBe(true)
    expect(out['isL4']).toBe(true)
  })

  it('L3: isL2Plus+isL3Plus true, isL4 false', () => {
    const out = withLevelBooleans({ governanceLevel: 'L3' }) as Record<string, unknown>
    expect(out['isL2Plus']).toBe(true)
    expect(out['isL3Plus']).toBe(true)
    expect(out['isL4']).toBe(false)
  })

  it('L2: isL2Plus true, isL3Plus+isL4 false', () => {
    const out = withLevelBooleans({ governanceLevel: 'L2' }) as Record<string, unknown>
    expect(out['isL2Plus']).toBe(true)
    expect(out['isL3Plus']).toBe(false)
    expect(out['isL4']).toBe(false)
  })

  it('L1: all three false', () => {
    const out = withLevelBooleans({ governanceLevel: 'L1' }) as Record<string, unknown>
    expect(out['isL2Plus']).toBe(false)
    expect(out['isL3Plus']).toBe(false)
    expect(out['isL4']).toBe(false)
  })

  it('absent governanceLevel: all three false, does not throw', () => {
    let out: Record<string, unknown> = {}
    expect(() => {
      out = withLevelBooleans({ other: 1 }) as Record<string, unknown>
    }).not.toThrow()
    expect(out['isL2Plus']).toBe(false)
    expect(out['isL3Plus']).toBe(false)
    expect(out['isL4']).toBe(false)
  })

  it('invalid governanceLevel: all three false, does not throw', () => {
    const out = withLevelBooleans({ governanceLevel: 'bogus' }) as Record<string, unknown>
    expect(out['isL2Plus']).toBe(false)
    expect(out['isL3Plus']).toBe(false)
    expect(out['isL4']).toBe(false)
  })

  it('does not mutate the input object', () => {
    const data = { governanceLevel: 'L4' as const }
    withLevelBooleans(data)
    expect(Object.prototype.hasOwnProperty.call(data, 'isL2Plus')).toBe(false)
  })

  it('recomputes caller-provided isL2Plus/isL3Plus/isL4 keys (always-overwrite: derived from the SSOT, a stale hand-rolled flag must never win)', () => {
    const data = { governanceLevel: 'L4' as const, isL2Plus: false, isL3Plus: 'stale', isL4: 0 }
    const out = withLevelBooleans(data) as Record<string, unknown>
    expect(out['isL2Plus']).toBe(true)
    expect(out['isL3Plus']).toBe(true)
    expect(out['isL4']).toBe(true)
  })

  it('renderTemplate composes withLevelBooleans: a template can reference bare isL4', () => {
    const data = makeConfig('/tmp/test', { governanceLevel: 'L4' }) as unknown as Record<
      string,
      unknown
    >
    // CODEOWNERS.ejs is rendered at L4 elsewhere in the suite; here we only assert
    // that referencing the injected boolean does not throw a ReferenceError.
    expect(() => renderTemplate('root/CODEOWNERS.ejs', data)).not.toThrow()
  })
})

// #1723: the archetype→"service bucket" map (service/cli/batch/lib) was hand-duplicated
// 6 times — inline in 5 workflow EJS templates (_nightly/_shared-security/_weekly/
// 05-release/02-pr-extended) and again as `serviceBucket()` in commands/init.ts. Root-cause
// fix: a single resolver (`resolveServiceBucket`) consumed both by the render boundary
// (`withServiceBucket`, injecting `serviceBucket`/`isService`/`isCli`/`isBatch` so the EJS
// templates no longer re-declare the map) and by the L3 gate (`workflowCtx` in init.ts).
describe('#1723 — resolveServiceBucket / withServiceBucket helper', () => {
  it('resolveServiceBucket: backend-web-db -> service', () => {
    expect(resolveServiceBucket('backend-web-db')).toBe('service')
  })

  it('resolveServiceBucket: cli -> cli', () => {
    expect(resolveServiceBucket('cli')).toBe('cli')
  })

  it('resolveServiceBucket: embedded -> cli', () => {
    expect(resolveServiceBucket('embedded')).toBe('cli')
  })

  it('resolveServiceBucket: data-pipeline -> batch', () => {
    expect(resolveServiceBucket('data-pipeline')).toBe('batch')
  })

  it('resolveServiceBucket: library (and any unmodeled archetype) -> lib', () => {
    expect(resolveServiceBucket('library')).toBe('lib')
    expect(resolveServiceBucket('unknown-archetype')).toBe('lib')
  })

  it('resolveServiceBucket: non-string/absent archetype -> lib, does not throw', () => {
    expect(resolveServiceBucket(undefined)).toBe('lib')
    expect(resolveServiceBucket(42)).toBe('lib')
  })

  it('withServiceBucket: injects serviceBucket + isService/isCli/isBatch booleans', () => {
    const out = withServiceBucket({ archetype: 'backend-web-db' }) as Record<string, unknown>
    expect(out['serviceBucket']).toBe('service')
    expect(out['isService']).toBe(true)
    expect(out['isCli']).toBe(false)
    expect(out['isBatch']).toBe(false)
  })

  it('withServiceBucket: cli archetype', () => {
    const out = withServiceBucket({ archetype: 'cli' }) as Record<string, unknown>
    expect(out['isService']).toBe(false)
    expect(out['isCli']).toBe(true)
    expect(out['isBatch']).toBe(false)
  })

  it('withServiceBucket: data-pipeline archetype', () => {
    const out = withServiceBucket({ archetype: 'data-pipeline' }) as Record<string, unknown>
    expect(out['isService']).toBe(false)
    expect(out['isCli']).toBe(false)
    expect(out['isBatch']).toBe(true)
  })

  it('withServiceBucket: does not mutate the input object', () => {
    const data = { archetype: 'backend-web-db' }
    withServiceBucket(data)
    expect(Object.prototype.hasOwnProperty.call(data, 'serviceBucket')).toBe(false)
  })

  it('renderTemplate composes withServiceBucket: a template can reference bare serviceBucket/isService', () => {
    const data = makeConfig('/tmp/test', { archetype: 'backend-web-db' }) as unknown as Record<
      string,
      unknown
    >
    // _shared-security.yml.ejs references the injected locals; assert no ReferenceError.
    expect(() => renderTemplate('github/workflows/_shared-security.yml.ejs', data)).not.toThrow()
  })
})
