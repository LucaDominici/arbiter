// SPDX-License-Identifier: Apache-2.0
/**
 * #2328 (INV-48 / CANON-04) — render coverage for
 * `src/templates/scripts/lib/gate-evidence.mjs.ejs`, the gate-pass identity
 * binding arbiter ships INTO every generated project.
 *
 * A string check would prove nothing here: the point of the dual track is that
 * the emitted verifier actually binds. So the rendered template is imported and
 * exercised against a real git repo — happy path, then one planted defect per
 * identity axis the emitted copy is responsible for.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

interface RenderedLib {
  captureGateStart: (root: string) => Record<string, unknown> | null
  buildGateEvidence: (opts: {
    root: string
    level: string
    taskId: string
    start: Record<string, unknown> | null
  }) => Record<string, unknown> | null
  verifyGateEvidence: (
    marker: unknown,
    opts: Record<string, unknown>,
  ) => { ok: boolean; reason?: string }
}

const dirs: string[] = []
function track(dir: string): string {
  dirs.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8' }).trim()
}

function makeRepo(): string {
  const dir = track(realpathSync(mkdtempSync(join(tmpdir(), 'arbiter-ge-render-'))))
  git(dir, ['init', '-q', '-b', 'task/render'])
  git(dir, ['config', 'user.email', 'test@arbiter.dev'])
  git(dir, ['config', 'user.name', 'Arbiter Test'])
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fx' }))
  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3 }))
  writeFileSync(join(dir, 'app.txt'), 'hello\n')
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', 'init', '--no-gpg-sign'])
  return dir
}

describe('scripts/lib/gate-evidence.mjs.ejs — rendering (#2328, INV-48/CANON-04)', () => {
  let lib: RenderedLib

  beforeAll(async () => {
    const cfg = makeConfig('/tmp/render', { language: 'typescript', governanceLevel: 'L2' })
    const rendered = renderTemplate('scripts/lib/gate-evidence.mjs.ejs', cfg)
    expect(rendered).toContain('export function verifyGateEvidence')
    expect(rendered).not.toContain('<%')

    // Emitted alongside run-helpers.mjs, exactly as generateCheckAll co-emits both.
    const dir = track(mkdtempSync(join(tmpdir(), 'arbiter-ge-lib-')))
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'run-helpers.mjs'),
      renderTemplate('scripts/lib/run-helpers.mjs.ejs', {}),
    )
    const file = join(dir, 'gate-evidence.mjs')
    writeFileSync(file, rendered)
    lib = (await import(pathToFileURL(file).href)) as unknown as RenderedLib
  })

  it('the emitted verifier accepts evidence it just stamped for this tree', () => {
    const dir = makeRepo()
    const marker = lib.buildGateEvidence({
      root: dir,
      level: 'L2',
      taskId: '#1',
      start: lib.captureGateStart(dir),
    })
    expect(marker).not.toBeNull()
    expect(lib.verifyGateEvidence(marker, { root: dir, minLevel: 'L2', maxAgeMin: 240 })).toEqual({
      ok: true,
    })
  })

  it.each([
    ['old-schema marker', (m: Record<string, unknown>) => delete m.schema, /schema|missing/i],
    ['blank tree hash', (m: Record<string, unknown>) => (m.tree_hash = ''), /tree_hash/i],
    [
      'foreign checkout',
      (m: Record<string, unknown>) => (m.checkout_root = '/elsewhere'),
      /checkout_root/i,
    ],
    [
      'forged toolchain',
      (m: Record<string, unknown>) => (m.toolchain_fingerprint = 'sha256:00'),
      /toolchain_fingerprint/i,
    ],
    ['insufficient level', (m: Record<string, unknown>) => (m.level = 'L1'), /level/i],
    [
      'expired',
      (m: Record<string, unknown>) =>
        (m.timestamp = new Date(Date.now() - 600 * 60_000).toISOString()),
      /expired/i,
    ],
    [
      'forged ttl type',
      (m: Record<string, unknown>) => (m.ttl_minutes = 'forever'),
      /ttl_minutes/i,
    ],
  ])('the emitted verifier rejects: %s', (_label, plant, pattern) => {
    const dir = makeRepo()
    const marker = lib.buildGateEvidence({
      root: dir,
      level: 'L2',
      taskId: '#1',
      start: lib.captureGateStart(dir),
    }) as Record<string, unknown>
    plant(marker)
    const result = lib.verifyGateEvidence(marker, { root: dir, minLevel: 'L2', maxAgeMin: 240 })
    expect(result.ok).toBe(false)
    expect(String(result.reason)).toMatch(pattern)
  })

  it('the emitted verifier rejects evidence once the working tree changed', () => {
    const dir = makeRepo()
    const marker = lib.buildGateEvidence({
      root: dir,
      level: 'L2',
      taskId: '#1',
      start: lib.captureGateStart(dir),
    })
    writeFileSync(join(dir, 'app.txt'), 'tampered\n')
    const result = lib.verifyGateEvidence(marker, { root: dir, minLevel: 'L2', maxAgeMin: 240 })
    expect(result.ok).toBe(false)
    expect(String(result.reason)).toMatch(/tree_hash/i)
  })
})
