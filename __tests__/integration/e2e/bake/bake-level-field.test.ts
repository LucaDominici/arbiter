// SPDX-License-Identifier: Apache-2.0
// #2543: `bakeLevel` — the manifest's explicit bake-level selector. The bake
// harness previously picked `manifest.levels[0] ?? 'L1'` — an ordering
// accident (28 of 30 manifests are authored as an ascending SET of supported
// levels; only java-spring-L4 lists descending, so only its author knew
// position 0 was load-bearing). `bakeLevel` makes intent legible and array
// order non-load-bearing: it defaults to 'L1', NEVER to `levels[0]`.
//
// CANON-24 inversion this file guards against: a `bakeLevel` that is
// silently ignored and falls back to L1 would look IDENTICAL to today's
// (defective) behaviour and to a fully green suite. Every assertion below
// proves the field is actually READ — not merely present in the schema.
import { existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runInit } from '../../../../src/commands/init.js'
import { loadFixtureManifest, resolveBakeLevel, stageFixture } from '../helpers.js'
import type { FixtureManifest } from '../helpers.js'

describe('resolveBakeLevel (#2543)', () => {
  it('defaults to L1 when bakeLevel is absent — NEVER levels[0]', () => {
    // Descending array (the java-spring-L4 shape) with NO bakeLevel set: the
    // old `levels[0] ?? 'L1'` mechanism would resolve 'L4' here. The fix must
    // default to 'L1' regardless of how `levels` happens to be ordered.
    const manifest: FixtureManifest = {
      language: 'java',
      archetype: 'backend-web-db',
      levels: ['L4', 'L3', 'L2', 'L1'],
      tier: 'bake',
    }
    expect(resolveBakeLevel(manifest)).toBe('L1')
  })

  it('reads an explicit bakeLevel instead of deriving anything from levels', () => {
    const manifest: FixtureManifest = {
      language: 'java',
      archetype: 'backend-web-db',
      levels: ['L1', 'L2', 'L3', 'L4'],
      tier: 'bake',
      bakeLevel: 'L3',
    }
    expect(resolveBakeLevel(manifest)).toBe('L3')
  })
})

describe('java-spring-L3 bakes at the level its manifest declares (#2543 AC-2/AC-3)', () => {
  it('emits L2+-gated wiki files once bakeLevel promotes it off L1', async () => {
    const manifest = loadFixtureManifest('java-spring-L3')
    const level = resolveBakeLevel(manifest)
    // The whole point of AC-3: this fixture must no longer bake at L1 despite
    // its name — closing the total L3 coverage gap the issue measured.
    expect(level).toBe('L3')

    const dir = stageFixture('java-spring-L3')
    try {
      await runInit({
        yes: true,
        tools: manifest.tools ?? 'claude',
        level,
        dir,
        dryRun: false,
        brownfield: false,
        noVerify: true,
        language: manifest.language as never,
        archetype: manifest.archetype as never,
      })
      // src/generators/wiki.ts returns `{ files: [] }` at L1 and only emits
      // scripts/gen-wiki.mjs at L2+. Its presence here is direct, observable
      // proof that the resolved `level` actually reached `runInit` — a
      // silently ignored `bakeLevel` would bake this fixture at L1 and this
      // file would be absent, identical to today's defective behaviour.
      expect(existsSync(join(dir, 'scripts', 'gen-wiki.mjs'))).toBe(true)
    } finally {
      rmSync(dirname(dir), { recursive: true, force: true })
    }
  }, 60_000)
})
