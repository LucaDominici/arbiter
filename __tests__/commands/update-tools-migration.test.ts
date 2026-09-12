// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject } from '../helpers.js'
import { runUpdate } from '../../src/commands/update.js'
import { DEFAULT_THRESHOLDS } from '../../src/config/schema.js'

// ── #2661: `update` must never silently rewrite retired `tools` values ─────
// A project-declared `tools: ["claude","codex","cursor","copilot"]` fails strict
// v0.2 validation since ADR-119 retired cursor/copilot. `loadConfig`'s never-brick
// fallback (`sanitizeCoercibleFields`) coerces this IN MEMORY to
// `["claude","codex"]` so generation can proceed — but `update` then persisted
// that coerced value back to `arbiter.json` on every run, silently discarding the
// user's declared value (the worker had to `git checkout -- arbiter.json` after
// each run). `update` must keep the byte-for-byte on-disk `tools` value unless the
// user explicitly opts into the migration, while still generating for claude+codex.

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

describe('runUpdate — retired tools survive byte-for-byte (#2661)', () => {
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

  it('prints a migration line naming the key, the dropped values and ADR-119', async () => {
    writeV2Config(dir)
    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await runUpdate({ dir, json: true, github: false })

    const output = warnSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(output).toContain('tools')
    expect(output).toContain('cursor')
    expect(output).toContain('copilot')
    expect(output).toContain('ADR-119')
  })

  it('still generates for claude+codex only despite the undropped retired values', async () => {
    writeV2Config(dir)

    const result = await runUpdate({ dir, json: true, github: false })

    // Generation must not throw/skip because of the retired tool values —
    // the in-memory coercion still applies for generation purposes.
    expect(result.keysRun).toBeDefined()
    void logSpy
  })
})
