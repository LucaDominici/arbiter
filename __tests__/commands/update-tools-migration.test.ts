// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject } from '../helpers.js'
import { runUpdate } from '../../src/commands/update.js'
import { DEFAULT_THRESHOLDS } from '../../src/config/schema.js'
import { loadSnapshot } from '../../src/utils/config.js'
import { diffConfig } from '../../src/config/diff.js'

// ── #2661: `update` must never silently rewrite retired `tools` values ─────
// A project-declared `tools: ["claude","codex","cursor","copilot"]` fails strict
// v0.2 validation since ADR-122 retired cursor/copilot. `loadConfig`'s never-brick
// fallback (`sanitizeCoercibleFields`) coerces this IN MEMORY to
// `["claude","codex"]` so generation can proceed — but `update` then persisted
// that coerced value back to `arbiter.json` on every run, silently discarding the
// user's declared value (the worker had to `git checkout -- arbiter.json` after
// each run). `update` must keep the on-disk `tools` VALUES unchanged (the file
// itself is still re-serialized every run, so exact bytes/formatting are not the
// claim) unless the user explicitly opts into the migration, while still
// generating for claude+codex — and must do so IDEMPOTENTLY: persisting the raw
// value into `.arbiter-generated.json` (the next run's diff basis) instead of the
// sanitized one would make every future run see a permanent, spurious `tools`
// diff and rerun the tool generators forever.

function writeV2Config(dir: string, overrides: Record<string, unknown> = {}): void {
  const config = {
    version: '0.2',
    tools: ['claude', 'codex', 'cursor', 'copilot'],
    governanceLevel: 'L2',
    useGitHub: false,
    features: {
      contractTesting: false,
      mutationTesting: false,
      securityScanning: true,
      evidenceHarness: false,
      debtGates: true,
      suppressions: true,
    },
    thresholds: { ...DEFAULT_THRESHOLDS.L2 },
    ...overrides,
  }
  writeFileSync(join(dir, 'arbiter.json'), JSON.stringify(config, null, 2))
}

function readArbiterJson(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, 'arbiter.json'), 'utf-8')) as Record<string, unknown>
}

describe('runUpdate — retired tools values survive unchanged (#2661)', () => {
  let dir: string
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    dir = createTestProject('typescript')
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanupTestProject(dir)
  })

  it('never rewrites tools declaring retired values (cursor/copilot)', async () => {
    writeV2Config(dir)

    await runUpdate({ dir, json: true, github: false })

    const persisted = readArbiterJson(dir)
    expect(persisted['tools']).toEqual(['claude', 'codex', 'cursor', 'copilot'])
  })

  it('prints a migration line naming the key, the dropped values and ADR-122', async () => {
    writeV2Config(dir)
    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await runUpdate({ dir, json: true, github: false })

    const output = warnSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(output).toContain('tools')
    expect(output).toContain('cursor (retired, ADR-122)')
    expect(output).toContain('copilot (retired, ADR-122)')
  })

  // #2661 round 2: an ADR-122-retired name lost a real generator (a migration); an
  // unrecognized string or non-string entry never had one (a typo/corruption) —
  // the warning must not conflate the two under the same "retired" label.
  it('labels an unrecognized string tools value as unknown, not retired', async () => {
    writeV2Config(dir, { tools: ['claude', 'future-tool'] })
    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await runUpdate({ dir, json: true, github: false })

    const output = warnSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(output).toContain('future-tool (unknown value; accepted set: claude, codex)')
    expect(output).not.toContain('ADR-122')
    expect(readArbiterJson(dir)['tools']).toEqual(['claude', 'future-tool'])
  })

  it('labels a non-string tools entry as unknown, not retired', async () => {
    writeV2Config(dir, { tools: ['claude', 7] })
    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await runUpdate({ dir, json: true, github: false })

    const output = warnSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(output).toContain('7 (unknown value; accepted set: claude, codex)')
    expect(output).not.toContain('ADR-122')
    expect(readArbiterJson(dir)['tools']).toEqual(['claude', 7])
  })

  it('generates for claude+codex only, using only the accepted tools, despite the undropped retired values', async () => {
    writeV2Config(dir)

    const result = await runUpdate({ dir, json: true, github: false })

    // Generation must not throw/skip because of the retired tool values — the
    // in-memory coercion still applies for generation purposes. Proving "only
    // the accepted tools drove generation" means: no generator errors, AND the
    // claude/codex artifacts actually landed on disk (a generator gated on
    // `config.tools.includes('cursor'|'copilot')` would never run, since those
    // names never reach the accepted set — but an unguarded generator choking
    // on the raw values would show up here as an error or a missing artifact).
    expect(result.keysRun === null || result.keysRun.size > 0).toBe(true)
    expect(existsSync(join(dir, '.claude', 'CLAUDE.md'))).toBe(true)
    expect(existsSync(join(dir, '.agents', 'CODEX.md'))).toBe(true)
    void logSpy
  })

  it('is idempotent: the snapshot never diffs on tools across repeated runs', async () => {
    writeV2Config(dir)

    await runUpdate({ dir, json: true, github: false })
    const snapshotAfterRun1 = loadSnapshot(dir)
    await runUpdate({ dir, json: true, github: false })
    const snapshotAfterRun2 = loadSnapshot(dir)

    // Bug: persisting the RAW retired tools into `.arbiter-generated.json` makes
    // the snapshot's `tools` disagree with the next run's SANITIZED `tools` on
    // every run, so `diffConfig` sees a permanent, spurious `tools` change and
    // reruns the tool generators forever instead of converging. The snapshot
    // itself must always carry the sanitized value...
    expect(snapshotAfterRun1?.['tools']).toEqual(['claude', 'codex'])
    expect(snapshotAfterRun2?.['tools']).toEqual(['claude', 'codex'])
    // ...so two consecutive snapshots never disagree on `tools` specifically
    // (other axis fields may legitimately differ between runs; this asserts
    // only the root cause this fix addresses).
    expect(
      snapshotAfterRun1 &&
        snapshotAfterRun2 &&
        diffConfig(snapshotAfterRun1, snapshotAfterRun2).paths,
    ).not.toContain('tools')
    // The retired values must still be intact in arbiter.json after the second
    // run too — the fix must not achieve idempotence by finally sanitizing
    // arbiter.json itself.
    expect(readArbiterJson(dir)['tools']).toEqual(['claude', 'codex', 'cursor', 'copilot'])
  })
})
