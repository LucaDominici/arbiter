// SPDX-License-Identifier: Apache-2.0
/**
 * #1542 (follow-up to #1523): the `scripts/` enforcement layer must be inside
 * knip's project scope so dead cross-file EXPORTS in the gate code are caught.
 *
 * Historically `knip.json` `project` was `src` only, so the 181 `.mjs` gate
 * scripts received zero dead-export analysis — the code that ENFORCES arbiter's
 * quality bar was exempt from the dead-code gate. This test locks the contract:
 * every standalone gate script is a knip entry (each is its own CLI executable,
 * not imported) and the scripts directory is in `project`, so knip follows each
 * script's imports of the scripts lib and flags any unused export there.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')

describe('knip scripts/ scope enforcement (#1542)', () => {
  const knip = JSON.parse(readFileSync(join(ROOT, 'knip.json'), 'utf8')) as {
    workspaces: Record<string, { entry?: string[]; project?: string[] }>
  }
  const ws = knip.workspaces['.']

  it('keeps scripts/**/*.mjs inside the knip project scope', () => {
    expect(ws.project).toContain('scripts/**/*.mjs')
  })

  it('treats every scripts/**/*.mjs as an entry (standalone CLI executables)', () => {
    expect(ws.entry).toContain('scripts/**/*.mjs')
  })
})
