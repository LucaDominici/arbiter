// SPDX-License-Identifier: Apache-2.0
/**
 * #2402 — the single reader for ship/landing policy in the TARGET repo's `arbiter.json`.
 *
 * Its two defaults are the interesting part and they point in OPPOSITE directions on purpose:
 * an unreadable config declares no BOUNDS (so the built-in ones stay in force), but it does not
 * excuse a repo from the landing check (so an unverifiable PR is still verified).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { shipConfigFor, permitsGitHubCalls } from '../../src/commands/ship-config'

describe('shipConfigFor / usesGitHub (#2402)', () => {
  let dir: string
  /** Valid enough to survive `loadConfig`, so the axis under test is the only variable. */
  const writeConfig = (over: Record<string, unknown>): void =>
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({
        version: '0.2',
        governanceLevel: 'L2',
        tools: ['claude'],
        features: {
          contractTesting: false,
          mutationTesting: false,
          securityScanning: false,
          evidenceHarness: false,
          debtGates: true,
          suppressions: true,
        },
        thresholds: {
          lineCoverage: 80,
          branchCoverage: 70,
          mutationScore: 80,
          cyclomaticComplexity: 15,
          methodLength: 65,
          maxParams: 7,
        },
        ...over,
      }),
    )

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-ship-config-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads the ship block when one is declared', () => {
    writeConfig({ ship: { train: { maxChain: 3 }, review: { maxRounds: 4 } } })
    expect(shipConfigFor(dir)).toEqual({ train: { maxChain: 3 }, review: { maxRounds: 4 } })
  })

  it('returns undefined for an absent config — the built-in bounds stay in force', () => {
    expect(shipConfigFor(dir)).toBeUndefined()
  })

  it('returns undefined for a malformed config rather than throwing mid-ship', () => {
    writeFileSync(join(dir, 'arbiter.json'), '{ not json')
    expect(shipConfigFor(dir)).toBeUndefined()
  })

  it('permits live calls only on an explicit permitGitHub:true', () => {
    writeConfig({ permitGitHub: true })
    expect(permitsGitHubCalls(dir)).toBe(true)
  })

  it('withholds permission for an absent, unreadable, or silent config', () => {
    expect(permitsGitHubCalls(dir)).toBe(false)
    writeConfig({})
    expect(permitsGitHubCalls(dir)).toBe(false)
    writeFileSync(join(dir, 'arbiter.json'), '{ not json')
    expect(permitsGitHubCalls(dir)).toBe(false)
  })

  it('reads the deprecated useGitHub through the migration that renames it', () => {
    // `loadConfig` migrates useGitHub → permitGitHub and DELETES the old key, so reading
    // `useGitHub` directly would always see undefined — this pins that the alias still works.
    writeConfig({ useGitHub: true })
    expect(permitsGitHubCalls(dir)).toBe(true)
  })
})
