// SPDX-License-Identifier: Apache-2.0
// CANON-11 — brownfield: generateShipDriver must be skipIfExists-safe on a repo
// that already carries a ship driver or a custom /ship command.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateShipDriver } from '../../src/generators/ship-driver.js'
import { makeConfig } from '../helpers.js'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ship-driver-brownfield-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('generateShipDriver — brownfield (CANON-11)', () => {
  it('preserves a pre-existing supervisor.sh and TICK_PROMPT.md byte-identically', () => {
    mkdirSync(join(dir, '.arbiter/ship'), { recursive: true })
    writeFileSync(join(dir, '.arbiter/ship/supervisor.sh'), '#!/bin/sh\n# mine\n', 'utf-8')
    writeFileSync(join(dir, '.arbiter/ship/TICK_PROMPT.md'), '# my prompt\n', 'utf-8')
    const r = generateShipDriver(makeConfig(dir))
    expect(readFileSync(join(dir, '.arbiter/ship/supervisor.sh'), 'utf-8')).toBe(
      '#!/bin/sh\n# mine\n',
    )
    expect(readFileSync(join(dir, '.arbiter/ship/TICK_PROMPT.md'), 'utf-8')).toBe('# my prompt\n')
    expect(r.files.every((f) => f.action === 'skipped')).toBe(true)
  })

  it('preserves a pre-existing custom .claude/commands/ship.md', () => {
    mkdirSync(join(dir, '.claude/commands'), { recursive: true })
    writeFileSync(join(dir, '.claude/commands/ship.md'), '# custom\n', 'utf-8')
    generateShipDriver(makeConfig(dir))
    expect(readFileSync(join(dir, '.claude/commands/ship.md'), 'utf-8')).toBe('# custom\n')
  })
})
