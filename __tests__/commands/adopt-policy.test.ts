// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildAdoptPredicate, recordLocalOverride } from '../../src/commands/adopt-policy.js'

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

describe('buildAdoptPredicate', () => {
  it('adopts every withheld file under --adopt', () => {
    expect(buildAdoptPredicate({ adopt: true })('scripts/project-specific-check.mjs')).toBe(true)
  })

  it('adopts safety hooks by default, unless --no-adopt-safety freezes them', () => {
    const safetyHook = '.claude/hooks/stop-dangerous.mjs'
    expect(buildAdoptPredicate({})(safetyHook)).toBe(true)
    expect(buildAdoptPredicate({ noAdoptSafety: true })(safetyHook)).toBe(false)
  })

  it('adopts the gate spine only under --adopt-gate-spine', () => {
    const gateSpine = 'scripts/check-all.mjs'
    expect(buildAdoptPredicate({})(gateSpine)).toBe(false)
    expect(buildAdoptPredicate({ adoptGateSpine: true })(gateSpine)).toBe(true)
  })

  it('always adopts governance-class files, even when safety adoption is disabled', () => {
    expect(buildAdoptPredicate({ noAdoptSafety: true })('AGENTS.md')).toBe(true)
    expect(buildAdoptPredicate({ noAdoptSafety: true })('.claude/settings.json')).toBe(true)
  })

  it('adopts derived-track files only when --refresh-derived is selected', () => {
    const derivedFile = '.codex/codex-adapter.mjs'
    expect(buildAdoptPredicate({})(derivedFile)).toBe(false)
    expect(buildAdoptPredicate({ refreshDerived: true })(derivedFile)).toBe(true)
  })
})

describe('recordLocalOverride', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-adopt-policy-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes a reversible, timestamped envelope for a nested path', () => {
    const key = 'nested/path/generated-file.mjs'
    const priorContent = '// local fix\n'
    const newContent = '// shipped fix\n'
    const adoptedAt = new Date('2026-08-03T10:15:30.000Z')

    const file = recordLocalOverride(dir, { key, priorContent, newContent }, () => adoptedAt)

    expect(file).toBe(
      join(dir, '.arbiter', 'evidence', 'local-overrides', 'nested__path__generated-file.mjs.json'),
    )
    expect(existsSync(file)).toBe(true)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      path: key,
      adoptedAt: adoptedAt.toISOString(),
      reason: expect.stringContaining('update --adopt'),
      priorContent,
      priorContentSha256: sha256(priorContent),
      newContent,
      newContentSha256: sha256(newContent),
    })
  })
})
