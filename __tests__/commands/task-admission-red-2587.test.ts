// SPDX-License-Identifier: Apache-2.0
// #2587 RED receipt: acceptance-anchor validation must happen on red admission.
import { copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { runTaskAdvance } from '../../src/commands/task.js'
import { readUnifiedState, writeUnifiedState } from '../../src/commands/task-state.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function installAcceptanceChecker(root: string): void {
  mkdirSync(join(root, 'scripts', 'lib'), { recursive: true })
  for (const file of [
    'check-acceptance.mjs',
    'lib/acceptance-criteria.mjs',
    'lib/run-helpers.mjs',
  ]) {
    copyFileSync(resolve(__dirname, '../../scripts', file), join(root, 'scripts', file))
  }
}

describe('red admission acceptance anchor (#2587)', () => {
  it('rejects malformed Markdown before entering red', () => {
    const root = mkdtempSync(join(tmpdir(), 'arbiter-red-admission-'))
    roots.push(root)
    writeUnifiedState(root, {
      taskId: '#2587',
      phase: 'red-team-review',
      plan: 'plan.md',
    })
    mkdirSync(join(root, '.arbiter', 'evidence', 'redteam'), { recursive: true })
    writeFileSync(join(root, '.arbiter', 'evidence', 'redteam', '#2587.json'), '{"findings":[]}\n')
    writeFileSync(join(root, 'arbiter.json'), '{"features":{"acceptanceAnchor":true}}\n')
    writeFileSync(join(root, 'plan.md'), '# Plan\nmissing acceptance anchor\n')
    installAcceptanceChecker(root)

    expect(() => runTaskAdvance({ to: 'red', dir: root })).toThrow(/acceptance/i)
    expect(readUnifiedState(root)?.phase).toBe('red-team-review')
  })
})
