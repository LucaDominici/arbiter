// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject } from '../helpers.js'
import { runUpdate } from '../../src/commands/update.js'
import { DEFAULT_THRESHOLDS } from '../../src/config/schema.js'

// ── #1317 BLOCKER: `arbiter update` must persist the DERIVED databaseEngine ────
// A legacy `{ hasDatabase: true }` config (engine absent) derives
// `databaseEngine: 'postgresql'` via axis.ts deriveDatabase. Before the fix,
// update.ts rebuilt nextConfig from `...stored` + the other axis fields but
// OMITTED databaseEngine, so saveConfigAndSnapshot wrote back a config WITHOUT
// the engine — the derived value was lost every update, and the diff.ts
// engine-change detection was inert (snapshot and nextConfig both carried the
// same stale `...stored`).

function writeV2Config(dir: string, overrides: Record<string, unknown> = {}): void {
  const config = {
    version: '0.2',
    tools: ['claude'],
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

describe('runUpdate — derived databaseEngine persistence (#1317)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanupTestProject(dir)
  })

  it('persists derived databaseEngine=postgresql for a legacy hasDatabase:true config', async () => {
    // Legacy config: hasDatabase true, NO databaseEngine field.
    writeV2Config(dir, { hasDatabase: true })

    await runUpdate({ dir, json: true, github: false })

    const persisted = readArbiterJson(dir)
    // The derived engine MUST be written back so it is not lost next update.
    expect(persisted['databaseEngine']).toBe('postgresql')
    expect(persisted['hasDatabase']).toBe(true)
  })

  it('detects a none→postgresql engine change as a diff that triggers full regen', async () => {
    // First update seeds the snapshot with engine=none (no database).
    writeV2Config(dir, { hasDatabase: false })
    const first = await runUpdate({ dir, json: true, github: false })
    expect(first.keysRun).toBeNull()

    // Now flip to a database: legacy hasDatabase:true derives engine=postgresql.
    // Because the snapshot recorded engine=none and nextConfig now carries
    // postgresql, diff.ts AXIS_FIELDS engine-change detection must fire ⇒ '*'.
    writeV2Config(dir, { hasDatabase: true })
    const second = await runUpdate({ dir, json: true, github: false })
    expect(second.keysRun).not.toBeNull()
    expect(second.keysRun?.has('*')).toBe(true)
  })
})
