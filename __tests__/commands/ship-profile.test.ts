// SPDX-License-Identifier: Apache-2.0
//
// #1288 — de-self-only the `arbiter ship` engine: resolve a runtime ShipProfile from the
// TARGET repo's arbiter.json (not arbiter-self assumptions) and detect arbiter-self by the
// unique npm package name. Crash-safe (malformed config/package.json must NOT throw).
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  resolveShipProfile,
  isArbiterSelf,
  CONSUMER_DEFAULT_PROFILE,
} from '../../src/commands/ship-profile.js'

const dirs: string[] = []
function tmpRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-shipprofile-'))
  dirs.push(dir)
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content)
  }
  return dir
}
afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop()
    if (d) rmSync(d, { recursive: true, force: true })
  }
})

const pkg = (name: string): string => JSON.stringify({ name, version: '1.0.0' })
const cfg = (extra: Record<string, unknown>): string =>
  JSON.stringify({
    version: '2.0.0',
    governanceLevel: 'L2',
    tools: {},
    features: {},
    thresholds: {},
    ...extra,
  })

describe('resolveShipProfile — reads the TARGET repo arbiter.json (#1288)', () => {
  it('consumer repo (peer-review) → not self, peer-review, pr-ff, L2', () => {
    const dir = tmpRepo({
      'package.json': pkg('acme-app'),
      'arbiter.json': cfg({ collaborationMode: 'peer-review' }),
    })
    expect(resolveShipProfile(dir)).toEqual({
      isArbiterSelf: false,
      collaborationMode: 'peer-review',
      mergeMode: 'pr-ff',
      governanceLevel: 'L2',
    })
  })

  it('consumer trunk-solo + solo.mergeMode:direct → mergeMode direct (RT-02 override honored)', () => {
    const dir = tmpRepo({
      'package.json': pkg('acme-app'),
      'arbiter.json': cfg({ collaborationMode: 'trunk-solo', solo: { mergeMode: 'direct' } }),
    })
    const p = resolveShipProfile(dir)
    expect(p.collaborationMode).toBe('trunk-solo')
    expect(p.mergeMode).toBe('direct')
  })

  it('canonical collaborationMode field is authoritative; legacy features.soloDevMode is normalized away by loadConfig (RT-03)', () => {
    // loadConfig rebuilds `features` to the fixed FeatureFlags set, dropping the legacy
    // soloDevMode alias (migration maps v1 configs to collaborationMode instead). A consumer
    // that sets ONLY the legacy flag therefore resolves to the safe default, not trunk-solo —
    // the engine relies on the canonical collaborationMode field, never the dropped alias.
    const dir = tmpRepo({
      'package.json': pkg('acme-app'),
      'arbiter.json': cfg({ features: { soloDevMode: true } }),
    })
    expect(resolveShipProfile(dir).collaborationMode).toBe('peer-review')
    // Explicit canonical field IS honored.
    const dir2 = tmpRepo({
      'package.json': pkg('acme-app'),
      'arbiter.json': cfg({ collaborationMode: 'trunk-solo' }),
    })
    expect(resolveShipProfile(dir2).collaborationMode).toBe('trunk-solo')
  })

  it('malformed arbiter.json → safe defaults, never throws (RT-01)', () => {
    const dir = tmpRepo({
      'package.json': pkg('acme-app'),
      'arbiter.json': '{ this is not valid json',
    })
    expect(() => resolveShipProfile(dir)).not.toThrow()
    expect(resolveShipProfile(dir)).toEqual(CONSUMER_DEFAULT_PROFILE)
  })

  it('absent arbiter.json → consumer-safe defaults (peer-review / pr-ff / L2)', () => {
    const dir = tmpRepo({ 'package.json': pkg('acme-app') })
    expect(resolveShipProfile(dir)).toEqual(CONSUMER_DEFAULT_PROFILE)
  })

  it('arbiter-self (pkg @arbiter/cli, trunk-solo + pr-ff) → isArbiterSelf true', () => {
    const dir = tmpRepo({
      'package.json': pkg('@arbiter/cli'),
      'arbiter.json': cfg({ collaborationMode: 'trunk-solo', solo: { mergeMode: 'pr-ff' } }),
    })
    expect(resolveShipProfile(dir)).toEqual({
      isArbiterSelf: true,
      collaborationMode: 'trunk-solo',
      mergeMode: 'pr-ff',
      governanceLevel: 'L2',
    })
  })
})

describe('isArbiterSelf — package-name signal, rooted, crash-safe (#1288 RT-04/09)', () => {
  it('true only for the unique @arbiter/cli package name', () => {
    const self = tmpRepo({ 'package.json': pkg('@arbiter/cli') })
    expect(isArbiterSelf(self)).toBe(true)
  })

  it('false for a consumer even if it has a src/templates dir (no path false-positive, RT-04)', () => {
    const dir = tmpRepo({
      'package.json': pkg('acme-codegen'),
      'src/templates/x.ejs': '<%= 1 %>',
      'src/invariants/catalog.ts': 'export const x = 1',
    })
    expect(isArbiterSelf(dir)).toBe(false)
  })

  it('false (no throw) when package.json is missing or malformed (RT-09)', () => {
    const missing = tmpRepo({ 'arbiter.json': cfg({}) })
    expect(isArbiterSelf(missing)).toBe(false)
    const malformed = tmpRepo({ 'package.json': '{ broken' })
    expect(isArbiterSelf(malformed)).toBe(false)
  })

  it('resolves against the passed root, not process.cwd() (RT-09)', () => {
    const dir = tmpRepo({ 'package.json': pkg('@arbiter/cli') })
    // cwd is the arbiter worktree (also @arbiter/cli) — assert the function honors `dir`
    const consumer = tmpRepo({ 'package.json': pkg('other') })
    expect(isArbiterSelf(dir)).toBe(true)
    expect(isArbiterSelf(consumer)).toBe(false)
  })
})
