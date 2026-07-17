// SPDX-License-Identifier: Apache-2.0
// #1983: `arbiter update` never refreshes the codex-track files emitted with
// `skipIfExists: true` (`.agents/rules/*`, `.codex/codex-adapter.mjs`,
// `.claude/hooks/*` when codex is the sole tool) — once present in a governed
// repo, a later template fix (e.g. a CANON-22-class section landing in
// 90-exec-protocol.md.ejs) never reaches it. This suite proves the opt-in
// `--refresh-derived` flag (analogous to `update --adopt`, #1926): (1) without
// the flag a stale derived rule stays untouched; (2) with the flag it is
// refreshed to the current template render; (3) a file carrying the
// `arbiter:preserve` marker (#1980) is NEVER overwritten, even with the flag,
// and is reported as preserved.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInit } from '../../src/commands/init.js'
import { runUpdate } from '../../src/commands/update.js'
import { loadGeneratedManifest, saveGeneratedManifest } from '../../src/state/generated-manifest.js'
import { PRESERVE_MARKER } from '../../src/utils/fs.js'

const DERIVED_RULE = '.agents/rules/90-exec-protocol.md'
const OTHER_DERIVED_RULE = '.agents/rules/05-agent-lifecycle.md'

function initGit(dir: string): void {
  for (const args of [
    ['init'],
    ['config', 'user.email', 'test@test.com'],
    ['config', 'user.name', 'Test'],
  ]) {
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  }
}

/** Simulate template drift: disk still holds an OLD render (stale, pre-fix
 * content), but the manifest baseline is unchanged — so a plain `writeFile`
 * with `skipIfExists:true` treats it as "user-modified/unknown" and withholds
 * the current template, exactly like the real erosion case (#1983 evidence:
 * `.agents/rules/90-exec-protocol.md` missing a section the current template
 * carries). */
function goStale(dir: string, key: string): string {
  const manifest = loadGeneratedManifest(dir)
  expect(manifest[key]).toBeDefined()
  const staleContent = '# stale rule content — predates the current template fix\n'
  writeFileSync(join(dir, key), staleContent)
  saveGeneratedManifest(dir, manifest)
  return staleContent
}

describe('#1983 red-path: `update --refresh-derived` refreshes stale codex-track derived files', () => {
  let dir: string

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'arb-1983-refresh-'))
    initGit(dir)
    await runInit({ yes: true, tools: 'codex', level: 'L2', dir, noVerify: true })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('sanity: init emits the derived rule files under .agents/rules/', () => {
    expect(existsSync(join(dir, DERIVED_RULE))).toBe(true)
    expect(existsSync(join(dir, OTHER_DERIVED_RULE))).toBe(true)
  })

  it('without --refresh-derived, a stale derived rule stays untouched', async () => {
    const staleContent = goStale(dir, DERIVED_RULE)

    await runUpdate({ dir, github: false })

    expect(readFileSync(join(dir, DERIVED_RULE), 'utf-8')).toBe(staleContent)
  })

  it('with --refresh-derived, a stale derived rule IS refreshed to the current template', async () => {
    const staleContent = goStale(dir, DERIVED_RULE)

    await runUpdate({ dir, github: false, refreshDerived: true })

    const onDisk = readFileSync(join(dir, DERIVED_RULE), 'utf-8')
    expect(onDisk).not.toBe(staleContent)
    expect(onDisk).not.toContain('stale rule content')
  })

  it('a preserve-marked derived file is NEVER overwritten, even with --refresh-derived', async () => {
    goStale(dir, DERIVED_RULE)
    const preserved = `<!-- ${PRESERVE_MARKER} -->\nHand-maintained pointer stub. Do not edit.\n`
    writeFileSync(join(dir, DERIVED_RULE), preserved)

    const writes: string[] = []
    const spy = (s: unknown): boolean => {
      writes.push(String(s))
      return true
    }
    const origWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = spy as typeof process.stdout.write
    try {
      await runUpdate({ dir, github: false, refreshDerived: true })
    } finally {
      process.stdout.write = origWrite
    }

    // Byte-for-byte untouched — the preserve marker wins over every write policy.
    expect(readFileSync(join(dir, DERIVED_RULE), 'utf-8')).toBe(preserved)
    // Reported as preserved/skipped, not silently dropped from the summary.
    expect(writes.some((w) => w.includes(DERIVED_RULE))).toBe(true)
  })

  it('--refresh-derived does not touch non-derived skipIfExists files', async () => {
    const NON_DERIVED = 'scripts/check-collab-mode-wired.mjs'
    const manifest = loadGeneratedManifest(dir)
    expect(manifest[NON_DERIVED]).toBeDefined()
    const staleContent = '// stale non-derived script\n'
    writeFileSync(join(dir, NON_DERIVED), staleContent)
    saveGeneratedManifest(dir, manifest)

    await runUpdate({ dir, github: false, refreshDerived: true })

    expect(readFileSync(join(dir, NON_DERIVED), 'utf-8')).toBe(staleContent)
  })
})
