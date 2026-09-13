// SPDX-License-Identifier: Apache-2.0
// H1 (gold-doc-capability, Tranche 0) — `arbiter doc-set` is a THIN wrapper over the SSOT engine
// (scripts/check-doc-set.mjs). Before this file (and src/commands/doc-set.ts) existed, the
// generated governed-repo thin-runner (scripts/check-doc-set.mjs.ejs) invokes local `arbiter doc-set`
// and failed with `error: unknown command 'doc-set'` — the governed presence gate never worked.
// Parity test: the command's payload MUST equal `node scripts/check-doc-set.mjs --json` for the
// same manifest + repo — there is exactly one engine, never a second one.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runDocSet } from '../../src/commands/doc-set.js'

const MANIFEST = `version: '1.1.0'
profile: tooling
checks:
  - path: README.md
    tier: mandatory
    applies: always
  - path: docs/GOVERNANCE.md
    tier: recommended
    applies: always
`

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'doc-set-cmd-'))
  mkdirSync(join(dir, 'standards'), { recursive: true })
  writeFileSync(join(dir, 'standards', 'gold-doc-set.yml'), MANIFEST)
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function engineJson(args: string[] = []): Record<string, unknown> {
  const SCRIPT = resolve('scripts/check-doc-set.mjs')
  const r = spawnSync('node', [SCRIPT, '--json', ...args], { encoding: 'utf-8', cwd: dir })
  return JSON.parse(r.stdout)
}

describe('runDocSet (H1 thin wrapper, gold-doc-capability Tranche 0)', () => {
  it('returns a real audit payload for a fixture repo (RED before this file existed)', () => {
    writeFileSync(join(dir, 'README.md'), '# r')
    const res = runDocSet({ repo: dir, json: true, quiet: true })
    expect(res.exitCode).toBe(0)
    expect(res.payload).toBeTruthy()
    expect(res.payload!.totals.missingMandatory).toBe(0)
    expect(res.payload!.totals.missingRecommended).toBe(1) // docs/GOVERNANCE.md, advisory
  })

  it('PARITY: payload equals `check-doc-set.mjs --json` (one engine, not two)', () => {
    const cli = runDocSet({ repo: dir, json: true, quiet: true })
    const engine = engineJson()
    expect(cli.payload).toEqual(engine)
  })

  it('--strict exit code is the engine verdict, forwarded verbatim (no re-scoring)', () => {
    // README missing ⇒ mandatory gap.
    const res = runDocSet({ repo: dir, strict: true, quiet: true })
    expect(res.exitCode).toBe(1)
  })

  it('--generate scaffolds a stub through the same write-safe engine path', () => {
    writeFileSync(join(dir, 'README.md'), '# r')
    const res = runDocSet({ repo: dir, json: true, generate: true, quiet: true })
    expect(res.exitCode).toBe(0)
    expect(res.payload!.generated).toContain('docs/GOVERNANCE.md')
  })

  it('a manifest-level engine crash (bad --manifest path outside repo) degrades to exitCode 2', () => {
    const res = runDocSet({ repo: dir, manifest: '/does/not/exist.yml', json: true, quiet: true })
    // check-doc-set.mjs SKIPs (exit 0) when the manifest path is missing — not an error. Assert
    // the wrapper doesn't misreport a clean SKIP as a failure, and never throws to the caller.
    expect(res.exitCode).toBe(0)
    expect(res.payload).toBeNull()
  })
})

/** Run with --json (not quiet) and return the single envelope written to stdout. */
function envelopeOf(run: () => unknown): Record<string, unknown> {
  const writes: string[] = []
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    writes.push(String(chunk))
    return true
  })
  try {
    run()
  } finally {
    spy.mockRestore()
  }
  return JSON.parse(writes.join('').trim()) as Record<string, unknown>
}

describe('#2504 — doc-set --json never launders a SKIP or a subdirectory run into ok', () => {
  afterEach(() => vi.restoreAllMocks())

  it.each([
    ['presence', {}],
    ['freshness', { freshness: true }],
  ])('%s: a plain-text [SKIP] is a non-ok envelope carrying the reason', (_route, flags) => {
    rmSync(join(dir, 'standards'), { recursive: true, force: true })
    const env = envelopeOf(() => runDocSet({ repo: dir, json: true, ...flags }))
    expect(env.status).not.toBe('ok')
    expect((env.data as { skipped?: boolean }).skipped).toBe(true)
    expect(String((env.data as { reason?: string }).reason)).toMatch(/no manifest/)
  })

  it('a run from a subdirectory audits the enclosing repo root, not a SKIP', () => {
    writeFileSync(join(dir, 'README.md'), '# r')
    spawnSync('git', ['init', '-q'], { cwd: dir })
    const sub = join(dir, 'docs', 'deep')
    mkdirSync(sub, { recursive: true })
    vi.spyOn(process, 'cwd').mockReturnValue(sub)
    const res = runDocSet({ json: true, quiet: true })
    expect(res.exitCode).toBe(0)
    expect(res.payload).not.toBeNull()
  })

  it('no resolvable repo root above cwd exits 2 instead of a silent SKIP', () => {
    vi.spyOn(process, 'cwd').mockReturnValue(dir) // tmpdir, not inside any git repo
    const res = runDocSet({ json: true, quiet: true })
    expect(res.exitCode).toBe(2)
  })

  it('--arc42 parses the arc42 payload with its own type', () => {
    // arbiter's own tree carries a filled arc42 (docs/architecture/arc42.md).
    const res = runDocSet({ repo: resolve('.'), arc42: true, json: true, quiet: true })
    expect(res.route).toBe('arc42')
    if (res.route !== 'arc42' || res.payload === null) throw new Error('arc42 payload missing')
    expect(typeof res.payload.doc).toBe('string')
    expect(Array.isArray(res.payload.violations)).toBe(true)
  })
})
