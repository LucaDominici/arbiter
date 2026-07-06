// SPDX-License-Identifier: Apache-2.0
//
// #1267 — agent-dispatch-verify gate. The gate replays the ACTUAL derivation
// (matrix tier->verticals vs src/commands/task-ship.ts::verticalsForTier mirror,
// plus structural validation) and asserts the declared oracle matches. A planted
// mismatch MUST make it exit non-zero (AC4 — catch a dispatch mismatch).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  cpSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const REPO_ROOT = resolve(process.cwd())
const SCRIPT = join(REPO_ROOT, 'scripts/check-agent-dispatch.mjs')
const MATRIX = join(REPO_ROOT, '.claude/agent-dispatch-matrix.json')

function run(cwd: string) {
  return spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf-8',
    cwd,
    env: { ...process.env, NO_COLOR: '1' },
  })
}

describe('check-agent-dispatch — passes on the real matrix', () => {
  it('exits 0 against the committed matrix (declared == actual)', () => {
    const r = run(REPO_ROOT)
    expect(r.status).toBe(0)
  })
})

describe('check-agent-dispatch — catches a planted mismatch (AC4)', () => {
  let tmp: string

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'agent-dispatch-gate-'))
    // Mirror the minimal repo layout the gate needs: the script reads the matrix
    // JSON from <root>/.claude/ and the sizing mirror from the built dist or src.
    mkdirSync(join(tmp, '.claude'), { recursive: true })
    cpSync(MATRIX, join(tmp, '.claude/agent-dispatch-matrix.json'))
    cpSync(
      join(REPO_ROOT, '.claude/agent-dispatch-matrix.schema.json'),
      join(tmp, '.claude/agent-dispatch-matrix.schema.json'),
    )
  })

  afterAll(() => {
    if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true })
  })

  it('exits non-zero when the matrix tier->verticals is mutated to disagree with the task-ship mirror', () => {
    // Plant a mismatch: drop 'security' from the Standard tier floor so the matrix
    // disagrees with src/commands/task-ship.ts::verticalsForTier('Standard').
    const m = JSON.parse(readFileSync(join(tmp, '.claude/agent-dispatch-matrix.json'), 'utf-8'))
    m.tier_verticals.Standard = m.tier_verticals.Standard.filter((v: string) => v !== 'security')
    writeFileSync(join(tmp, '.claude/agent-dispatch-matrix.json'), JSON.stringify(m, null, 2))

    const r = spawnSync(process.execPath, [SCRIPT, '--matrix-root', tmp], {
      encoding: 'utf-8',
      cwd: REPO_ROOT,
      env: { ...process.env, NO_COLOR: '1' },
    })
    expect(r.status).not.toBe(0)
    expect(`${r.stdout}${r.stderr}`).toMatch(/mismatch|drift|security|Standard/i)
  })

  it('exits non-zero (fail-loud) when the matrix file is absent', () => {
    const empty = mkdtempSync(join(tmpdir(), 'agent-dispatch-empty-'))
    const r = spawnSync(process.execPath, [SCRIPT, '--matrix-root', empty], {
      encoding: 'utf-8',
      cwd: REPO_ROOT,
      env: { ...process.env, NO_COLOR: '1' },
    })
    rmSync(empty, { recursive: true })
    expect(r.status).not.toBe(0)
  })
})
