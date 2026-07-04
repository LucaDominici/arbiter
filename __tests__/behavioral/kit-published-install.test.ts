// SPDX-License-Identifier: Apache-2.0
// #1575: the `arbiter kit` family must work in a PUBLISHED install — where `src/`
// never ships and only the `files[]` allowlist (dist/ + docs/internal/audits/kit-
// canonical-mapping.json) is present. Earlier, kit resolved its runtime data into
// `../../../src/kit/*.json` and the build never copied the data into `dist/kit/`, so
// every kit subcommand threw `ENOENT` (or the gate fail-closed at severity 2) in any
// npm/npx install. The dev checkout masked it because `src/` sits right next to dist.
//
// This test reproduces a real install: it copies ONLY the shipped surface into an
// isolated dir that has no `src/` and no `scripts/`, then runs the compiled CLI from
// there and asserts the kit subcommands succeed. It is the surface the bug lived on.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const REPO = resolve(import.meta.dirname, '../..')
const DIST = join(REPO, 'dist')
const NODE = process.execPath

function buildIfNeeded(): void {
  if (existsSync(join(DIST, 'kit', 'catalog.json')) && existsSync(join(DIST, 'cli.js'))) return
  const r = spawnSync('npm', ['run', 'build'], { cwd: REPO, encoding: 'utf-8', timeout: 240_000 })
  if (r.status !== 0) {
    throw new Error(`npm run build failed for kit-published-install test:\n${r.stderr ?? ''}`)
  }
}

let pkgRoot: string

beforeAll(() => {
  buildIfNeeded()
  // Place the simulated install under node_modules/.cache (git-ignored) so Node's
  // ESM resolver still finds the repo's node_modules by walking up the parent chain.
  const cacheBase = join(REPO, 'node_modules', '.cache')
  mkdirSync(cacheBase, { recursive: true })
  pkgRoot = mkdtempSync(join(cacheBase, 'arbiter-pkgtest-'))
  // Copy ONLY the published surface: dist/ + the one shipped doc the CLI reads.
  cpSync(DIST, join(pkgRoot, 'dist'), { recursive: true })
  const mappingRel = 'docs/internal/audits/kit-canonical-mapping.json'
  mkdirSync(dirname(join(pkgRoot, mappingRel)), { recursive: true })
  cpSync(join(REPO, mappingRel), join(pkgRoot, mappingRel))
}, 240_000)

afterAll(() => {
  if (pkgRoot) rmSync(pkgRoot, { recursive: true, force: true })
})

function runKit(args: string[]): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(NODE, [join(pkgRoot, 'dist', 'cli.js'), ...args], {
    cwd: pkgRoot,
    encoding: 'utf-8',
    timeout: 30_000,
  })
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status ?? 1 }
}

describe('arbiter kit in a published install (no src/) — #1575', () => {
  it('ships the kit runtime data co-located with the compiled modules', () => {
    expect(existsSync(join(pkgRoot, 'dist', 'kit', 'catalog.json'))).toBe(true)
    expect(existsSync(join(pkgRoot, 'dist', 'kit', 'derived.json'))).toBe(true)
    // The install genuinely has no source tree — the old resolve target.
    expect(existsSync(join(pkgRoot, 'src'))).toBe(false)
  })

  it('kit validate gate passes (does not fail-closed on a missing src/kit/catalog.json)', () => {
    const { status, stdout, stderr } = runKit(['kit', 'validate', '--experimental.kit'])
    expect(status, `stdout:${stdout}\nstderr:${stderr}`).toBe(0)
    expect(stdout + stderr).toMatch(/\d+ dims/)
  })

  it('kit list reads derived.json from dist and prints all dimensions', () => {
    const { status, stdout } = runKit(['kit', 'list', '--format', 'json', '--experimental.kit'])
    expect(status).toBe(0)
    const parsed = JSON.parse(stdout) as unknown[]
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.length).toBeGreaterThan(0)
  })

  it('kit show resolves catalog data from dist for a single dimension', () => {
    const { status, stdout } = runKit(['kit', 'show', 'N01', '--experimental.kit'])
    expect(status).toBe(0)
    expect(stdout).toContain('"id"')
    expect(stdout).toContain('N01')
  })
})
