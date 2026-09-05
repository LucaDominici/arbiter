// INV-143: the arbiter <-> forma schema contract. The property worth testing is not that the
// gate passes today, but that a shared shape cannot be changed on one side and stay green.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'
import { sha256Of, checkContract } from '../../scripts/check-forma-contract.mjs'

const ROOT = resolve(import.meta.dirname, '../..')
const GATE = join(ROOT, 'scripts/check-forma-contract.mjs')

const created: string[] = []
afterEach(() => {
  for (const d of created.splice(0)) rmSync(d, { recursive: true, force: true })
})

const OWNED = '{"owned":true}\n'
const VENDORED = '{"vendored":true}\n'
const hash = (s: string) => createHash('sha256').update(s).digest('hex')

/** An arbiter-shaped root plus a forma-shaped sibling, both holding the same manifest. */
function pair(
  opts: { driftVendored?: boolean; driftSibling?: boolean; driftManifest?: boolean } = {},
) {
  const base = mkdtempSync(join(tmpdir(), 'arbiter-contract-'))
  created.push(base)
  const arb = join(base, 'arbiter')
  const forma = join(base, 'forma')
  mkdirSync(join(arb, 'schemas/vendor'), { recursive: true })
  mkdirSync(join(forma, 'lib/schema'), { recursive: true })

  const contract = {
    contractVersion: '1.0.0',
    schemas: [
      {
        id: 'owned-by-arbiter',
        owner: 'arbiter',
        ownerPath: 'schemas/owned-by-arbiter.schema.json',
        sha256: hash(OWNED),
        consumers: [],
      },
      {
        id: 'c4-model',
        owner: 'forma',
        ownerPath: 'lib/schema/c4-model.schema.json',
        sha256: hash(VENDORED),
        consumers: ['arbiter'],
      },
    ],
  }
  writeFileSync(join(arb, 'schemas/owned-by-arbiter.schema.json'), OWNED)
  writeFileSync(
    join(arb, 'schemas/vendor/c4-model.schema.json'),
    opts.driftVendored ? '{"vendored":"drifted"}\n' : VENDORED,
  )
  writeFileSync(
    join(forma, 'lib/schema/c4-model.schema.json'),
    opts.driftSibling ? '{"vendored":"drifted"}\n' : VENDORED,
  )
  writeFileSync(join(arb, 'schemas/CONTRACT.json'), JSON.stringify(contract, null, 2))
  writeFileSync(
    join(forma, 'lib/schema/CONTRACT.json'),
    opts.driftManifest
      ? '{"contractVersion":"9.9.9","schemas":[]}'
      : JSON.stringify(contract, null, 2),
  )
  return { arb, forma }
}

describe('check-forma-contract.mjs (INV-143)', () => {
  it('passes when every pin matches on both sides', () => {
    const { arb, forma } = pair()
    expect(checkContract(arb, forma).violations).toEqual([])
  })

  it('passes against the real repositories', () => {
    const r = spawnSync('node', [GATE], { cwd: ROOT, encoding: 'utf-8' })
    expect(r.status, r.stderr).toBe(0)
  })

  it('fails when the vendored copy drifts from the pin', () => {
    const { arb, forma } = pair({ driftVendored: true })
    expect(checkContract(arb, forma).violations.join('\n')).toContain('vendored copy hashes')
  })

  it('fails when the sibling changes a shared shape without re-pinning', () => {
    const { arb, forma } = pair({ driftSibling: true })
    expect(checkContract(arb, forma).violations.join('\n')).toContain('without re-pinning')
  })

  it('fails when the two copies of the manifest stop being identical', () => {
    const { arb, forma } = pair({ driftManifest: true })
    expect(checkContract(arb, forma).violations.join('\n')).toContain('differ')
  })

  it('fails when an arbiter-owned schema is edited without re-pinning', () => {
    const { arb, forma } = pair()
    writeFileSync(join(arb, 'schemas/owned-by-arbiter.schema.json'), '{"owned":"edited"}\n')
    expect(checkContract(arb, forma).violations.join('\n')).toContain('re-pin in BOTH')
  })

  it('SKIPS the cross-checkout half OUT LOUD when no sibling is present', () => {
    const { arb } = pair()
    const out = checkContract(arb, join(arb, '..', 'nonexistent'))
    expect(out.violations).toEqual([])
    expect(out.notes.join('\n')).toContain('SKIP cross-checkout half')
  })

  it('sha256Of hashes file bytes', () => {
    const { arb } = pair()
    expect(sha256Of(join(arb, 'schemas/owned-by-arbiter.schema.json'))).toBe(hash(OWNED))
  })
})
