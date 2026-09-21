// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// #2789: the emitted contract-postman workflow pinned action-junit-report to a commit that does
// not exist upstream, so every regenerated target got a red Newman job. v5.2.0 resolves to
// 62516aa379bff6370c95fd5894d5a27fb6619d9b (git ref tags/v5.2.0, 2026-09-21).
describe('contract-postman workflow pin (#2789)', () => {
  it('pins mikepenz/action-junit-report v5.2.0 to its real commit', () => {
    const tpl = readFileSync(
      resolve('src/templates/github/workflows/_contract-postman.yml.ejs'),
      'utf-8',
    )
    expect(tpl).toContain(
      'mikepenz/action-junit-report@62516aa379bff6370c95fd5894d5a27fb6619d9b # v5.2.0',
    )
  })
})
