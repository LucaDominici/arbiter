// SPDX-License-Identifier: Apache-2.0
// #2300 — no workflow may push commits back to a branch it was triggered on.
//
// A workflow that holds `contents: write` and runs `git push` launders an unreviewed
// commit onto a branch whose review and gate ran against a different tree. The concrete
// regression: dependabot-actions-sync.yml pushed a `src/templates/**` commit onto every
// action-bump branch, which made each bump owe TDD evidence (#2217 floor) it had no
// honest way to supply.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-workflow-hardening.mjs')

/** A hardened workflow that only reads — the shape every workflow should have. */
const READ_ONLY = `
name: Read Only
on:
  pull_request:
permissions:
  contents: read
concurrency:
  group: \${{ github.workflow }}-\${{ github.ref_name }}
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11
      - run: echo hi
`

/** The banned shape: job-level contents: write plus a git push back to the branch. */
const WRITEBACK = `
name: Writeback
on:
  pull_request:
permissions:
  contents: read
concurrency:
  group: \${{ github.workflow }}-\${{ github.ref_name }}
  cancel-in-progress: true
jobs:
  sync:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11
        with:
          ref: \${{ github.head_ref }}
      - run: |
          git commit -m "auto"
          git push
`

function runOn(files: Record<string, string>): {
  status: number
  stdout: string
  metrics: Record<string, number>
} {
  const dir = mkdtempSync(join(tmpdir(), 'wf-writeback-'))
  try {
    const wf = join(dir, '.github', 'workflows')
    mkdirSync(wf, { recursive: true })
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(join(wf, name), body.trim() + '\n')
    }
    const out = join(dir, 'report.json')
    const r = spawnSync('node', [SCRIPT, '--dir', dir, '--out', out], { encoding: 'utf-8' })
    return {
      status: r.status ?? 1,
      stdout: (r.stdout ?? '') + (r.stderr ?? ''),
      metrics: JSON.parse(readFileSync(out, 'utf-8')),
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('workflow branch writeback (#2300)', () => {
  it('flags a workflow that holds contents: write and runs git push', () => {
    const r = runOn({ 'sync.yml': WRITEBACK })
    expect(r.metrics.branchWritebackWorkflows).toBe(1)
    expect(r.status).toBe(1)
    expect(r.stdout).toMatch(/sync\.yml/)
  })

  it('does not flag a read-only workflow', () => {
    const r = runOn({ '01-pr.yml': READ_ONLY })
    expect(r.metrics.branchWritebackWorkflows).toBe(0)
    expect(r.status).toBe(0)
  })

  it("arbiter's own workflows contain no branch writeback", () => {
    const out = join(mkdtempSync(join(tmpdir(), 'wf-writeback-self-')), 'report.json')
    const r = spawnSync('node', [SCRIPT, '--dir', resolve('.'), '--out', out], {
      encoding: 'utf-8',
    })
    expect(JSON.parse(readFileSync(out, 'utf-8')).branchWritebackWorkflows).toBe(0)
    expect(r.status).toBe(0)
  })
})
