// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '../..')
const raw = (path: string): string => readFileSync(join(root, path), 'utf-8')
const flat = (path: string): string => raw(path).replace(/\s+/g, ' ')
const SHIP_TWINS = [
  '.claude/commands/ship.md',
  'src/templates/claude/commands/ship.md.ejs',
] as const

describe('capability train contract', () => {
  it.each(SHIP_TWINS)('%s admits only explicit, complete affinity', (path) => {
    const body = flat(path)
    expect(body).toContain('## Capability train')
    for (const marker of [
      '--chain-add',
      '--affinity',
      'sameOutcome',
      'dependencyRelated',
      'sharedAcceptanceBoundary',
      'sharedRollbackBoundary',
      'hardConflicts',
      'JOIN',
      'SEAL(reason)',
    ]) {
      expect(body).toContain(marker)
    }
    expect(body).toContain('Each joined issue still needs its own namespaced acceptance criteria')
  })

  it.each(SHIP_TWINS)('%s performs one certification and one gate per train', (path) => {
    const body = flat(path)
    expect(body).toContain('one clean-HEAD full gate')
    expect(body).toContain('one plan, one branch, one candidate, one final gate, and one PR')
  })
})

describe('bounded review and landing truth', () => {
  it.each(SHIP_TWINS)('%s blocks material findings after the two-round budget', (path) => {
    const body = flat(path)
    expect(body).toContain('Round two reviews only the delta')
    expect(body).toContain('normal cap is two rounds')
    expect(body.toLowerCase()).toContain('only low findings may be parked')
    expect(body).toContain('MED/HIGH/CRITICAL findings block')
  })

  it.each(SHIP_TWINS)('%s refuses completion before merge and green CI', (path) => {
    const body = flat(path)
    expect(body).toContain('merge and green CI are observed')
    expect(body).toContain('live proof when applicable')
  })
})

describe('legacy drain delegates train policy', () => {
  it.each(['.claude/commands/drain.md', 'src/templates/claude/commands/drain.md.ejs'])(
    '%s points to ship train policy',
    (path) => {
      expect(flat(path)).toContain('Ship affinity contract')
    },
  )
})
