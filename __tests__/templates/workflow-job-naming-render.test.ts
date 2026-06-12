// SPDX-License-Identifier: Apache-2.0
// #1319.6 — every job in the notification/approval workflow templates must carry
// a `name:` as the FIRST key under its job id. The self gate
// (scripts/check-workflow-job-naming.mjs, INV-89) enforces this on arbiter's own
// .github/workflows; this render-assert extends the same guarantee to the
// generated templates so a downstream project never ships an unnamed job.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

const CHECKER = resolve('scripts/check-workflow-job-naming.mjs')

// Templates that previously shipped at least one job without a `name:` field.
const TEMPLATES: Array<{ ejs: string; out: string }> = [
  { ejs: 'github/workflows/_label-sync.yml.ejs', out: '_label-sync.yml' },
  { ejs: 'github/workflows/_notify.yml.ejs', out: '_notify.yml' },
  { ejs: 'github/workflows/_post-merge-notify.yml.ejs', out: '_post-merge-notify.yml' },
  { ejs: 'github/workflows/03-human-approval.yml.ejs', out: '03-human-approval.yml' },
]

function renderWorkflowsTo(dir: string): void {
  const wfDir = join(dir, '.github', 'workflows')
  mkdirSync(wfDir, { recursive: true })
  const config = makeConfig('/tmp/test', {
    collaborationMode: 'trunk-solo',
    governanceLevel: 'L2',
  }) as unknown as Record<string, unknown>
  for (const { ejs, out } of TEMPLATES) {
    writeFileSync(join(wfDir, out), renderTemplate(ejs, config))
  }
}

describe('workflow templates — job naming (#1319.6, INV-89)', () => {
  it('every rendered job has a name: field (checker exits 0)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-job-naming-'))
    try {
      renderWorkflowsTo(dir)
      const r = spawnSync('node', [CHECKER, '--dir', dir], { encoding: 'utf-8' })
      expect(r.stderr).not.toContain('[FAIL]')
      expect(r.status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('name: is the FIRST key under each job id (regex /^    name:/ matches next line)', () => {
    const config = makeConfig('/tmp/test', {
      collaborationMode: 'trunk-solo',
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    // Job ids whose immediately-following non-blank line must be `    name:`.
    const expectations: Array<{ ejs: string; jobIds: string[] }> = [
      { ejs: 'github/workflows/_label-sync.yml.ejs', jobIds: ['sync'] },
      { ejs: 'github/workflows/_notify.yml.ejs', jobIds: ['notify'] },
      { ejs: 'github/workflows/_post-merge-notify.yml.ejs', jobIds: ['notify-codeowners'] },
      {
        ejs: 'github/workflows/03-human-approval.yml.ejs',
        jobIds: ['apply-approval-label', 'revoke-approval-label'],
      },
    ]
    for (const { ejs, jobIds } of expectations) {
      const lines = renderTemplate(ejs, config).split('\n')
      for (const jobId of jobIds) {
        const idx = lines.findIndex((l) => l === `  ${jobId}:`)
        expect(idx, `${ejs}: job id ${jobId} not found`).toBeGreaterThanOrEqual(0)
        expect(lines[idx + 1], `${ejs}: ${jobId} first key must be name:`).toMatch(/^ {4}name:/)
      }
    }
  })
})
