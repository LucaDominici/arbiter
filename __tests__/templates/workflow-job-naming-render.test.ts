// SPDX-License-Identifier: Apache-2.0
// #1319.6 — every job in the notification/approval workflow templates must carry
// a `name:` as the FIRST key under its job id. This render-assert validates the
// generated templates directly (regex over the rendered YAML) so a downstream
// project never ships an unnamed job. (#1459: the self-repo
// scripts/check-workflow-job-naming.mjs binary was retired as an un-wired
// advisory orphan — the guarantee is now asserted purely from the rendered text.)
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('workflow templates — job naming (#1319.6, INV-89)', () => {
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
