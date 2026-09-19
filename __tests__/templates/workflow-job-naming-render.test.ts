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
    const expectations: Array<{ ejs: string; jobIds: string[]; mode?: string }> = [
      { ejs: 'github/workflows/_label-sync.yml.ejs', jobIds: ['sync'] },
      { ejs: 'github/workflows/_notify.yml.ejs', jobIds: ['notify'] },
      { ejs: 'github/workflows/_post-merge-notify.yml.ejs', jobIds: ['notify-codeowners'] },
      // #2736: trunk-solo renders the standing-approval no-op; the label jobs belong to non-solo modes.
      { ejs: 'github/workflows/03-human-approval.yml.ejs', jobIds: ['standing-owner-approval'] },
      {
        ejs: 'github/workflows/03-human-approval.yml.ejs',
        jobIds: ['apply-approval-label', 'revoke-approval-label'],
        mode: 'peer-review',
      },
    ]
    for (const { ejs, jobIds, mode } of expectations) {
      const data = mode === undefined ? config : { ...config, collaborationMode: mode }
      const lines = renderTemplate(ejs, data).split('\n')
      for (const jobId of jobIds) {
        const idx = lines.findIndex((l) => l === `  ${jobId}:`)
        expect(idx, `${ejs}: job id ${jobId} not found`).toBeGreaterThanOrEqual(0)
        expect(lines[idx + 1], `${ejs}: ${jobId} first key must be name:`).toMatch(/^ {4}name:/)
      }
    }
  })
})
