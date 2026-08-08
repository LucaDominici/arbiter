// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runExplain } from '../../src/commands/explain.js'

describe('runExplain', () => {
  describe('E_ error codes', () => {
    it('returns entry for known error code', () => {
      const result = runExplain('E_CONFIG_NOT_FOUND', {})
      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('E_CONFIG_NOT_FOUND')
      expect(result.output).toContain('No arbiter.json found')
    })

    it('lookup is case-insensitive', () => {
      const result = runExplain('e_config_not_found', {})
      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('E_CONFIG_NOT_FOUND')
    })

    it('returns JSON when --format json', () => {
      const result = runExplain('E_CONFIG_NOT_FOUND', { format: 'json' })
      expect(result.exitCode).toBe(0)
      const parsed = JSON.parse(result.output) as Record<string, unknown>
      expect(parsed.code).toBe('E_CONFIG_NOT_FOUND')
      expect(parsed.category).toBe('ERROR')
      expect(typeof parsed.summary).toBe('string')
      expect(typeof parsed.detail).toBe('string')
      expect(typeof parsed.recovery).toBe('string')
    })
  })

  // #1735 (CANON-17): every FS_ERROR_KEYS errno translated by src/utils/fs.ts
  // must resolve via `arbiter explain <errno>` — otherwise the ArbiterError
  // footer's "Run `arbiter explain <code>`..." hint is a dead end.
  describe('FS errno codes (#1735)', () => {
    const fsErrnoCodes = [
      'ENOSPC',
      'EACCES',
      'EROFS',
      'EDQUOT',
      'EPERM',
      'ENOTDIR',
      'EISDIR',
      'ENOENT',
      'EBUSY',
      'EMFILE',
    ]

    it.each(fsErrnoCodes)('returns entry for %s', (code) => {
      const result = runExplain(code, {})
      expect(result.exitCode).toBe(0)
      expect(result.output).toContain(code)
    })

    it('lookup is case-insensitive', () => {
      const result = runExplain('enoent', {})
      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('ENOENT')
    })
  })

  describe('INV-NN invariant codes', () => {
    it('returns entry for known invariant', () => {
      const result = runExplain('INV-04', {})
      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('INV-04')
    })

    it('lookup is case-insensitive', () => {
      const result = runExplain('inv-04', {})
      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('INV-04')
    })

    it('returns JSON when --format json for INV', () => {
      const result = runExplain('INV-04', { format: 'json' })
      expect(result.exitCode).toBe(0)
      const parsed = JSON.parse(result.output) as Record<string, unknown>
      expect(parsed.category).toBe('INV')
      expect(typeof parsed.code).toBe('string')
      expect(typeof parsed.summary).toBe('string')
    })

    it('returns nonzero for unknown INV code', () => {
      const result = runExplain('INV-9999', {})
      expect(result.exitCode).toBe(1)
      expect(result.error).toContain('INV-9999')
    })
  })

  describe('CANON-NN rules', () => {
    it('returns entry for CANON-01', () => {
      const result = runExplain('CANON-01', {})
      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('CANON-01')
      expect(result.output).toContain('Dual-sided')
    })

    it('returns entry for CANON-14', () => {
      const result = runExplain('CANON-14', {})
      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('CANON-14')
    })

    it('returns JSON for CANON code', () => {
      const result = runExplain('CANON-01', { format: 'json' })
      expect(result.exitCode).toBe(0)
      const parsed = JSON.parse(result.output) as Record<string, unknown>
      expect(parsed.category).toBe('CANON')
      expect(typeof parsed.rule).toBe('string')
      expect(typeof parsed.why).toBe('string')
    })

    it('returns nonzero for unknown CANON code', () => {
      const result = runExplain('CANON-9999', {})
      expect(result.exitCode).toBe(1)
    })
  })

  describe('PROJ-NN project invariants (#2035)', () => {
    const originalCwd = process.cwd()

    afterEach(() => {
      process.chdir(originalCwd)
    })

    it('resolves a declared PROJ invariant from the project arbiter.json (TC-1)', () => {
      const dir = mkdtempSync(join(tmpdir(), 'explain-proj-'))
      writeFileSync(
        join(dir, 'arbiter.json'),
        JSON.stringify({
          version: '1.0.0',
          tools: ['claude'],
          governanceLevel: 'L2',
          useGitHub: false,
          features: {
            contractTesting: false,
            mutationTesting: false,
            securityScanning: false,
            evidenceHarness: false,
            debtGates: false,
            suppressions: false,
          },
          thresholds: {},
          governance: {
            projectInvariants: [
              {
                id: 'PROJ-01',
                tier: 'governance',
                title: 'Tenancy isolation is a product contract',
                description: 'Every tenant-scoped resource must carry owner_id.',
                alwaysActive: true,
                enforcement: 'CI (constraint scan); code review',
              },
            ],
          },
        }),
        'utf-8',
      )
      process.chdir(dir)
      const result = runExplain('PROJ-01', {})
      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('Tenancy isolation is a product contract')
      expect(result.output).toContain('Project-declared invariant')

      const json = runExplain('PROJ-01', { format: 'json' })
      expect(json.exitCode).toBe(0)
      const parsed = JSON.parse(json.output) as Record<string, unknown>
      expect(parsed.category).toBe('PROJ')

      const list = runExplain('', { list: true })
      expect(list.output).toContain('PROJ-01')
      rmSync(dir, { recursive: true, force: true })
    })

    it('reports unknown PROJ id', () => {
      const result = runExplain('PROJ-99', {})
      expect(result.exitCode).toBe(1)
      expect(result.error).toContain('Unknown invariant')
    })
  })

  describe('--list', () => {
    it('returns all codes grouped by category', () => {
      const result = runExplain('', { list: true })
      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('ERROR codes')
      expect(result.output).toContain('INV codes')
      expect(result.output).toContain('CANON rules')
      expect(result.output).toContain('E_CONFIG_NOT_FOUND')
      expect(result.output).toContain('INV-01')
      expect(result.output).toContain('CANON-01')
    })

    it('returns JSON list when --format json', () => {
      const result = runExplain('', { list: true, format: 'json' })
      expect(result.exitCode).toBe(0)
      const parsed = JSON.parse(result.output) as unknown[]
      expect(Array.isArray(parsed)).toBe(true)
      expect(parsed.length).toBeGreaterThan(0)
      const first = parsed[0] as Record<string, unknown>
      expect(typeof first.code).toBe('string')
      expect(typeof first.category).toBe('string')
    })
  })

  describe('unknown code', () => {
    it('exits nonzero and suggests --list', () => {
      const result = runExplain('GARBAGE', {})
      expect(result.exitCode).toBe(1)
      expect(result.error).toContain('--list')
    })
  })

  describe('wizard flag codes (#1315)', () => {
    it('explains hasPublicApi: lists the machinery it generates, exit 0', () => {
      const result = runExplain('hasPublicApi', {})
      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('hasPublicApi')
      expect(result.output).toMatch(/ZAP/)
      expect(result.output).toMatch(/contract/i)
      expect(result.output).toMatch(/deprecation/i)
    })

    it('explains isMultiTenant, exit 0', () => {
      const result = runExplain('isMultiTenant', {})
      expect(result.exitCode).toBe(0)
      expect(result.output).toMatch(/tenant/i)
    })

    it('explains contractType, exit 0', () => {
      const result = runExplain('contractType', {})
      expect(result.exitCode).toBe(0)
      expect(result.output).toMatch(/contract/i)
    })

    it('returns JSON for a flag code when --format json', () => {
      const result = runExplain('hasPublicApi', { format: 'json' })
      expect(result.exitCode).toBe(0)
      const parsed = JSON.parse(result.output) as Record<string, unknown>
      expect(parsed.code).toBe('hasPublicApi')
      expect(parsed.category).toBe('FLAG')
      expect(typeof parsed.summary).toBe('string')
    })

    it('unknown flag (camelCase, no known prefix) exits 1', () => {
      const result = runExplain('notARealFlag', {})
      expect(result.exitCode).toBe(1)
      expect(result.error).toContain('--list')
    })

    it('flag codes appear in --list output', () => {
      const result = runExplain('', { list: true })
      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('hasPublicApi')
    })
  })

  describe('E_GH_RECOVERABLE (RT11)', () => {
    it('exits 0 and renders summary for E_GH_RECOVERABLE', () => {
      const result = runExplain('E_GH_RECOVERABLE', {})
      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('E_GH_RECOVERABLE')
      expect(result.output).toContain('recoverable')
    })

    it('returns JSON with correct fields for E_GH_RECOVERABLE', () => {
      const result = runExplain('E_GH_RECOVERABLE', { format: 'json' })
      expect(result.exitCode).toBe(0)
      const parsed = JSON.parse(result.output) as Record<string, unknown>
      expect(parsed.code).toBe('E_GH_RECOVERABLE')
      expect(parsed.category).toBe('ERROR')
      expect(typeof parsed.summary).toBe('string')
      expect(typeof parsed.recovery).toBe('string')
    })

    it('is present in --list output', () => {
      const result = runExplain('', { list: true })
      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('E_GH_RECOVERABLE')
    })
  })
})
