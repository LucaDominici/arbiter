// SPDX-License-Identifier: Apache-2.0
// #2036 — decision registry (D-NN). RED tests: init scaffolds the registry and
// the gold-doc-set manifest tracks it; a gate fails orphan D-NN decisions
// (no enforcement, no "documentale" exemption); adoption of a pre-existing
// COSTITUZIONE-style file (arbiter:preserve) never clobbers; AGENTS.md points
// at the registry.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateGoldKit } from '../../src/generators/gold-kit.js'
import { generateDocSetSkeletons } from '../../src/generators/doc-set.js'
import { generateAgentsMd } from '../../src/generators/agents-md.js'
import { renderTemplate } from '../../src/utils/render.js'

let dir: string

beforeEach(() => {
  dir = createTestProject('typescript')
  generateGoldKit(makeConfig(dir))
})

afterEach(() => {
  cleanupTestProject(dir)
})

const FIVE_COLUMN_HEADER = '| D-NN | decisione | razionale | decisore | data |'

function renderGateScript(): string {
  return renderTemplate(
    'scripts/check-decision-registry.mjs.ejs',
    makeConfig('/tmp/render', {
      projectName: 'test-project',
    }) as unknown as Record<string, unknown>,
  )
}

/** Execute the rendered gate in a fixture repo dir; returns status/stdout/stderr. */
function runGate(fixtureDir: string): { status: number; stdout: string; stderr: string } {
  const scriptDir = mkdtempSync(join(tmpdir(), 'decision-gate-'))
  try {
    writeFileSync(join(scriptDir, 'check-decision-registry.mjs'), renderGateScript(), 'utf-8')
    const r = spawnSync('node', [join(scriptDir, 'check-decision-registry.mjs')], {
      cwd: fixtureDir,
      encoding: 'utf-8',
    })
    return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  } finally {
    rmSync(scriptDir, { recursive: true, force: true })
  }
}

function writeRegistry(registryBody: string): string {
  const fixture = mkdtempSync(join(tmpdir(), 'decision-reg-'))
  writeFileSync(join(fixture, 'DECISION_REGISTRY.md'), registryBody, 'utf-8')
  return fixture
}

describe('decision registry (#2036)', () => {
  it('TC-1: gold-doc-set manifest tracks DECISION_REGISTRY.md and GLOBAL_INVARIANTS.md', () => {
    const manifest = readFileSync(join(dir, 'standards', 'gold-doc-set.yml'), 'utf-8')
    expect(manifest).toContain('DECISION_REGISTRY.md')
    expect(manifest).toContain('GLOBAL_INVARIANTS.md')
  })

  it('TC-1: init scaffolds DECISION_REGISTRY.md with the 5-column table + changelog', () => {
    generateDocSetSkeletons(makeConfig(dir))
    const path = join(dir, 'DECISION_REGISTRY.md')
    expect(existsSync(path)).toBe(true)
    const content = readFileSync(path, 'utf-8')
    // #2257: doc-set.ts now formatContent()s skeleton output, and prettier column-aligns
    // markdown tables — match cell headers with a whitespace-tolerant regex rather than
    // the single-space raw-render literal (FIVE_COLUMN_HEADER stays exact for the
    // hand-crafted TC-2 gate fixtures below, which bypass the generator entirely).
    expect(content).toMatch(
      /\|\s*D-NN\s*\|\s*decisione\s*\|\s*razionale\s*\|\s*decisore\s*\|\s*data\s*\|/,
    )
    expect(content).toMatch(/Changelog/i)
  })

  it('TC-1: the scaffold documents the D-NN -> PROJ-NN promotion path', () => {
    generateDocSetSkeletons(makeConfig(dir))
    const content = readFileSync(join(dir, 'DECISION_REGISTRY.md'), 'utf-8')
    expect(content).toMatch(/PROJ-NN/i)
    expect(content).toMatch(/un solo registro|one registry/i)
  })

  it('TC-2: orphan D-NN (no enforcement, no exemption) fails the gate naming the id', () => {
    const fixture = writeRegistry(
      [
        FIVE_COLUMN_HEADER,
        '| --- | --- | --- | --- | --- |',
        '| D-03 | solo net/http | niente WebSocket/GraphQL | owner | 2026-08-01 |',
        '',
        '## Changelog',
        '',
        '### v0.1.0 — 2026-08-01',
        '- Registro iniziale.',
        '',
      ].join('\n'),
    )
    try {
      const result = runGate(fixture)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('D-03')
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })

  it('TC-2: documentale exemption passes with a note', () => {
    const fixture = writeRegistry(
      [
        FIVE_COLUMN_HEADER,
        '| --- | --- | --- | --- | --- |',
        '| D-03 | solo net/http | niente WebSocket/GraphQL | owner | 2026-08-01 |',
        'Enforcement: documentale',
        '',
        '## Changelog',
        '',
      ].join('\n'),
    )
    try {
      const result = runGate(fixture)
      expect(result.status).toBe(0)
      expect(result.stdout).toMatch(/documentale/i)
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })

  it('TC-2: absent registry is a SKIP, not a fail', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'decision-no-reg-'))
    try {
      const result = runGate(fixture)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('[SKIP]')
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })

  it('TC-3: adoption — a pre-existing COSTITUZIONE.md with arbiter:preserve is never touched', () => {
    const adoptionBody = [
      '<!-- arbiter:preserve — user-owned decision record, adopted as DECISION_REGISTRY.md -->',
      '# Costituzione',
      '',
      '## Leggi',
      '',
      '1. Una legge non cambia mai senza un D-NN.',
      '',
      '## Decisioni',
      '',
      '| D-01 | decisione | razionale | decisore | data |',
      '| --- | --- | --- | --- | --- |',
      '| D-01 | solo net/http | niente WebSocket | owner | 2026-08-01 |',
      '',
    ].join('\n')
    writeFileSync(join(dir, 'COSTITUZIONE.md'), adoptionBody, 'utf-8')
    generateDocSetSkeletons(makeConfig(dir))
    expect(readFileSync(join(dir, 'COSTITUZIONE.md'), 'utf-8')).toBe(adoptionBody)
    expect(existsSync(join(dir, 'DECISION_REGISTRY.md'))).toBe(false)
    // The gate must not false-fail a user-owned format — SKIP with a note.
    const result = runGate(dir)
    expect(result.status).toBe(0)
  })

  it('TC-4: AGENTS.md points at the decision registry at L2+', () => {
    generateAgentsMd(makeConfig(dir, { governanceLevel: 'L2' }))
    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
    expect(content).toMatch(/DECISION_REGISTRY\.md/)
  })
})
