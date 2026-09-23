// SPDX-License-Identifier: Apache-2.0
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectGateContract } from '../../scripts/lib/gate-contract.mjs'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('gate contract inspection', () => {
  it('reports the debt-only complexity command with its effective threshold', () => {
    const contract = inspectGateContract(process.cwd())
    const debt = contract.gates.find((gate: { name?: string }) => gate.name === 'debt ratchet')
    expect(debt.thresholds).toContainEqual(
      expect.objectContaining({
        name: 'complexityViolations',
        value: 226,
        source: 'scripts/debt-baseline.json#metrics.complexityViolations.value',
        measurement:
          'npx eslint src scripts --format json --rule "{\\"complexity\\":[\\"warn\\",10]}"',
      }),
    )
    expect(debt.bindings).toEqual(
      expect.arrayContaining([
        { source: 'scripts/debt-baseline.json', required: true },
        { source: 'scripts/lib/debt-metric-contract.mjs', required: true },
      ]),
    )
  })

  it('exposes preflight ratchets and their configuration authority', () => {
    const contract = inspectGateContract(process.cwd())
    const gate = (name: string) =>
      contract.gates.find((entry: { name?: string }) => entry.name === name)

    expect(gate('fail-closed audit (INV-96)').bindings).toContainEqual({
      source: 'scripts/data/fail-closed-baseline.json',
      required: true,
    })
    expect(gate('format')).toMatchObject({
      command: 'npx prettier --check .',
      bindings: expect.arrayContaining([
        { source: '.prettierrc.json', required: true },
        { source: '.prettierignore', required: true },
      ]),
    })
    expect(gate('template tests').thresholds).toContainEqual({
      name: 'untested EJS templates',
      value: 174,
      source: '.template-tests-baseline.txt',
    })
    expect(gate('doc style').bindings).toContainEqual({
      source: 'scripts/data/doc-gate-allowlist.json',
      required: true,
    })
    expect(gate('canon-01 declination (#1922)').thresholds).toEqual(
      expect.arrayContaining([
        { name: 'divergences', value: 79, source: 'scripts/canon01-baseline.json#divergences' },
        {
          name: 'self-only mechanisms',
          value: 89,
          source: 'scripts/canon01-baseline.json#selfOnly',
        },
      ]),
    )
    expect(contract.authority.map((entry: { path: string }) => entry.path)).toEqual(
      expect.arrayContaining([
        'scripts/data/fail-closed-baseline.json',
        '.prettierignore',
        '.template-tests-baseline.txt',
        'scripts/data/doc-gate-allowlist.json',
        'scripts/canon01-baseline.json',
        '.dogfood-divergences.json',
      ]),
    )
  })

  it('never executes an unknown custom gate authority', () => {
    const root = mkdtempSync(join(tmpdir(), 'arbiter-gate-contract-'))
    roots.push(root)
    mkdirSync(join(root, 'scripts'))
    const sentinel = join(root, 'executed')
    writeFileSync(
      join(root, 'scripts', 'check-all.mjs'),
      `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(sentinel)}, 'ran')\n`,
    )

    expect(inspectGateContract(root)).toMatchObject({
      unresolved: [{ reason: 'unsupported custom gate authority' }],
    })
    expect(existsSync(sentinel)).toBe(false)
  })
})
