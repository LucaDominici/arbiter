// SPDX-License-Identifier: Apache-2.0
// Wave C2 (#1041): bake harness — for each `bake`+`functional` tier fixture,
// stage to tmpdir, run `arbiter init`, assert generated arbiter.json validates,
// snapshot the delta of generated files. Bake tier asserts STRUCTURE only —
// no exec of the generated project (that is C3 functional tier).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runInit } from '../../../../src/commands/init.js'
import { validateConfig } from '../../../../src/config/schema.js'
import { checkEmissionCoherence } from '../../../../scripts/check-emission-coherence.mjs'
import {
  computeFileDelta,
  listFixtures,
  listProjectFiles,
  loadFixtureManifest,
  stageFixture,
} from '../helpers.js'

const SNAPSHOT_ROOT = resolve('__tests__/integration/e2e/bake/__snapshots__')
const UPDATE = process.env.BAKE_UPDATE_SNAPSHOTS === '1'

interface BakeSnapshot {
  fixture: string
  level: string
  generated: string[]
}

function snapshotPath(fixture: string): string {
  return join(SNAPSHOT_ROOT, `${fixture}.json`)
}

function loadSnapshot(fixture: string): BakeSnapshot | null {
  const p = snapshotPath(fixture)
  if (!existsSync(p)) return null
  return JSON.parse(readFileSync(p, 'utf-8')) as BakeSnapshot
}

function writeSnapshot(snap: BakeSnapshot): void {
  const p = snapshotPath(snap.fixture)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, `${JSON.stringify(snap, null, 2)}\n`)
}

// #1685 part 4: the bake name-list comparison must be ENV-INDEPENDENT. arbiter
// init emits `.arbiter/detected-integrations.json` only when host integrations are
// detected — present on a dev host with skills installed, ABSENT in CI's clean env.
// Including it made every committed snapshot (captured locally, with the file) fail
// against CI's regeneration (without it) — a ±1 name-list delta unrelated to the
// generator. listProjectFiles must exclude it so the snapshot is reproducible
// everywhere. Detection in init.ts is deliberately untouched.
describe('listProjectFiles — env-derived files excluded (#1685)', () => {
  it('excludes .arbiter/detected-integrations.json but keeps real generated files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-lpf-'))
    try {
      mkdirSync(join(dir, '.arbiter'), { recursive: true })
      writeFileSync(join(dir, '.arbiter', 'detected-integrations.json'), '{}')
      writeFileSync(join(dir, 'arbiter.json'), '{}')
      const files = listProjectFiles(dir)
      expect(files).not.toContain('.arbiter/detected-integrations.json')
      expect(files).toContain('arbiter.json')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

const fixtures = listFixtures('bake', 'functional').sort()

describe.each(fixtures)('bake — %s', (fixture) => {
  const manifest = loadFixtureManifest(fixture)
  // Use the lowest declared level to keep bake fast; functional harness exercises L2+.
  const level = manifest.levels[0] ?? 'L1'
  let dir: string

  beforeEach(() => {
    dir = stageFixture(fixture)
  })

  afterEach(() => {
    if (dir != null) rmSync(dir, { recursive: true, force: true })
  })

  it('arbiter init produces valid arbiter.json + matches generated-file snapshot', async () => {
    const before = listProjectFiles(dir)
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
    expect(existsSync(join(dir, 'arbiter.json'))).toBe(true)
    const raw = JSON.parse(readFileSync(join(dir, 'arbiter.json'), 'utf-8'))
    const validate = validateConfig(raw)
    expect(
      validate.ok,
      validate.ok ? '' : `arbiter.json invalid: ${JSON.stringify(validate)}`,
    ).toBe(true)

    // #1885: on the codex-only cell, every .codex/config.toml hook-path reference
    // must resolve to an emitted file — this is the exact ghost that crashed every
    // bash/apply_patch call before generateCodexHooks became self-sufficient.
    // Scoped to this one cell (not the whole matrix): the broader emission-coherence
    // gate surfaces pre-existing, unrelated dead-emission findings on other fixtures
    // (out of scope here — see #1887-B/#1887-F for the check-all wiring gaps).
    if (fixture === 'ts-codex-only') {
      const { problems } = checkEmissionCoherence(dir)
      const codexProblems = problems.filter((p) => p.includes('.codex/config.toml'))
      expect(
        codexProblems,
        `emission-coherence .codex/config.toml problems for ${fixture}:\n${codexProblems.join('\n')}`,
      ).toEqual([])
    }

    const after = listProjectFiles(dir)
    const generated = computeFileDelta(before, after).sort()

    if (UPDATE) {
      writeSnapshot({ fixture, level, generated })
      return
    }
    const snap = loadSnapshot(fixture)
    expect(
      snap,
      `no snapshot for ${fixture} — run with BAKE_UPDATE_SNAPSHOTS=1 to seed`,
    ).not.toBeNull()
    if (snap == null) return
    expect(snap.level).toBe(level)
    expect(generated).toEqual(snap.generated)
  })
})
