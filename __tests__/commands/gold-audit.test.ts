// SPDX-License-Identifier: Apache-2.0
// #1414 — `arbiter gold-audit` is a THIN wrapper over the SSOT engine (scripts/gold-audit.mjs).
// It reuses the engine's deterministic verdicts and ADDS the level-band + gap-render presentation.
// Parity test: the command's core verdicts MUST equal `node scripts/gold-audit.mjs --json` for the
// same registry + repo — there is exactly one engine, never a second one.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runGoldAudit } from '../../src/commands/gold-audit.js'

const REGISTRY = `version: '1.0.0'
profile: tooling
dimensions:
  - id: D-DOCS
    title: Documentation
checks:
  - id: GA-01
    dimension: D-DOCS
    title: README present
    type: file_exists
    args: { path: README.md }
    weight: 1
    risk: SAFE
  - id: GA-02
    dimension: D-DOCS
    title: README mentions install
    type: file_contains
    args: { path: README.md, pattern: 'install' }
    weight: 1
    risk: SAFE
`

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gold-audit-cmd-'))
  mkdirSync(join(dir, 'standards'), { recursive: true })
  writeFileSync(join(dir, 'standards', 'gold-registry.yml'), REGISTRY)
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function engineJson(args: string[] = []): Record<string, unknown> {
  const SCRIPT = resolve('scripts/gold-audit.mjs')
  const r = spawnSync('node', [SCRIPT, '--json', ...args], { encoding: 'utf-8', cwd: dir })
  return JSON.parse(r.stdout)
}

describe('runGoldAudit (#1414 thin wrapper)', () => {
  it('returns the engine score + a level band + gaps', async () => {
    writeFileSync(join(dir, 'README.md'), '# r\nrun npm install\n')
    const res = await runGoldAudit({ repo: dir, json: true })
    expect(res.exitCode).toBe(0)
    expect(res.payload).toBeTruthy()
    expect(typeof res.payload!.score).toBe('number')
    expect(res.payload!.level).toBeTruthy()
    expect(['L0', 'L1', 'L2', 'L3']).toContain(res.payload!.level.level)
    expect(Array.isArray(res.payload!.gaps)).toBe(true)
  })

  it('PARITY: core verdicts equal `gold-audit.mjs --json` (one engine, not two)', async () => {
    writeFileSync(join(dir, 'README.md'), '# r\n')
    // README present but no "install" → GA-01 Y, GA-02 N.
    const cli = await runGoldAudit({ repo: dir, json: true, class: 'gold' })
    const engine = engineJson(['--class', 'gold'])
    const cliVerdicts = cli.payload!.checks.map((c) => ({ id: c.id, verdict: c.verdict }))
    const engVerdicts = (engine.checks as Array<{ id: string; verdict: string }>).map((c) => ({
      id: c.id,
      verdict: c.verdict,
    }))
    expect(cliVerdicts).toEqual(engVerdicts)
    expect(cli.payload!.score).toBe(engine.score)
    expect(cli.payload!.yCount).toBe(engine.yCount)
  })

  it('--class overrides the level-band class', async () => {
    writeFileSync(join(dir, 'README.md'), '# r\nrun npm install\n')
    const res = await runGoldAudit({ repo: dir, json: true, class: 'heavy' })
    expect(res.payload!.level.brownfieldClass).toBe('heavy')
  })

  it('the "what is missing" gaps list only N/P checks with evidence', async () => {
    // README missing → GA-01 N, GA-02 N.
    const res = await runGoldAudit({ repo: dir, json: true })
    const docs = res.payload!.gaps.find((g) => g.dimension === 'D-DOCS')
    expect(docs).toBeTruthy()
    expect(docs!.checks.every((c) => c.verdict === 'N' || c.verdict === 'P')).toBe(true)
    expect(docs!.checks[0]!.evidence).toBeTruthy()
  })

  it('no registry → SKIP (exit 0), never a manufactured fail', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'gold-audit-cmd-empty-'))
    try {
      const res = await runGoldAudit({ repo: empty, json: true })
      expect(res.exitCode).toBe(0)
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })
})
