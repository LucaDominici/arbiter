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
    expect(buildAdoptPredicate({ adopt: true })('scripts/project-specific-check.mjs', false)).toBe(
      true,
    )
  })

  it('adopts safety hooks by default EVEN without provenance, unless --no-adopt-safety freezes them', () => {
    const safetyHook = '.claude/hooks/stop-dangerous.mjs'
    // #2220 regression: the safety class must adopt by default regardless of
    // provenance (the Consumer Reliability Bar caught update silently stopping
    // to refresh hooks on manifest-less consumers).
    expect(buildAdoptPredicate({})(safetyHook, false)).toBe(true)
    expect(buildAdoptPredicate({})(safetyHook, true)).toBe(true)
    expect(buildAdoptPredicate({ noAdoptSafety: true })(safetyHook, false)).toBe(false)
    expect(buildAdoptPredicate({ noAdoptSafety: true })(safetyHook, true)).toBe(false)
  })

  it('adopts the gate spine only under --adopt-gate-spine AND with provenance', () => {
    const gateSpine = 'scripts/check-all.mjs'
    expect(buildAdoptPredicate({})(gateSpine, true)).toBe(false)
    expect(buildAdoptPredicate({ adoptGateSpine: true })(gateSpine, false)).toBe(false)
    expect(buildAdoptPredicate({ adoptGateSpine: true })(gateSpine, true)).toBe(true)
  })

  it('adopts governance-class files only under --adopt-governance AND with provenance', () => {
    expect(buildAdoptPredicate({ noAdoptSafety: true })('AGENTS.md', true)).toBe(false)
    expect(buildAdoptPredicate({ noAdoptSafety: true })('.claude/settings.json', true)).toBe(false)
    expect(buildAdoptPredicate({ adoptGovernance: true })('AGENTS.md', false)).toBe(false)
    expect(buildAdoptPredicate({ adoptGovernance: true })('AGENTS.md', true)).toBe(true)
    expect(buildAdoptPredicate({ adoptGovernance: true })('.claude/settings.json', true)).toBe(true)
  })

  it('adopts derived-track files only when --refresh-derived is selected AND with provenance', () => {
    const derivedFile = '.codex/codex-adapter.mjs'
    expect(buildAdoptPredicate({})(derivedFile, true)).toBe(false)
    expect(buildAdoptPredicate({ refreshDerived: true })(derivedFile, false)).toBe(false)
    expect(buildAdoptPredicate({ refreshDerived: true })(derivedFile, true)).toBe(true)
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
