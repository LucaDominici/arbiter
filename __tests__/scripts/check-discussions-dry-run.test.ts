// SPDX-License-Identifier: Apache-2.0
// TDD red-phase test for #565: setup-discussions.mjs dry-run output
import { spawnSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')
const script = resolve(repoRoot, 'scripts/setup-discussions.mjs')

describe('setup-discussions.mjs --dry-run', () => {
  it('outputs dry-run prefix and all 6 category names', () => {
    const result = spawnSync('node', [script], {
      encoding: 'utf-8',
      env: { ...process.env, HOME: process.env.HOME },
    })
    const output = result.stdout + result.stderr
    expect(output).toContain('[DRY-RUN]')
    const categories = ['Announcements', 'Ideas', 'Q&A', 'Show & Tell', 'Help', 'Polls']
    for (const cat of categories) {
      expect(output).toContain(cat)
    }
    expect(output).toContain('Dry-run complete')
  })
})
