// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'

// #2917: the three doc gates read scripts/data/doc-gate-allowlist.json and go red the day
// after an entry expires. Run each gate against the real tree and require exit 0.
describe('#2917 doc-gate allowlist entries are current', () => {
  for (const gate of ['doc-links', 'doc-style', 'phantom-command-scan']) {
    it(`check-${gate} passes`, () => {
      const r = spawnSync('node', [`scripts/check-${gate}.mjs`], { encoding: 'utf-8' })
      expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0)
    }, 120_000)
  }
})
