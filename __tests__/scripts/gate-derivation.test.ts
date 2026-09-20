// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { GATE_AFFECTS_REGISTRY } from '../../scripts/lib/gate-affects-registry.mjs'
import {
  deriveGatesForFiles,
  parsePlanFilesManifest,
  validateDerivedGates,
} from '../../scripts/lib/gate-derivation.mjs'
import { computeRecall, extractGateFailures } from '../../scripts/backtest-gate-derivation.mjs'

describe('gate derivation (#2773)', () => {
  it('AC-1 derives template artifacts without leaking them into docs-only work', () => {
    const templates = deriveGatesForFiles(['src/templates/claude/commands/ship.md.ejs'])
    const docs = deriveGatesForFiles(['docs/internal/ADR/001-example.md'])
    const templateNames = templates.map((gate) => gate.name)
    const docsNames = docs.map((gate) => gate.name)

    expect(templateNames).toEqual(
      expect.arrayContaining([
        'examples drift (#2222)',
        'dogfood',
        'integration suite (INV-25)',
        'emitted markdown refs (#2415)',
      ]),
    )
    expect(docsNames).not.toContain('examples drift (#2222)')
    expect(docsNames).not.toContain('dogfood')
    expect(docsNames).not.toContain('integration suite (INV-25)')
    expect(docsNames).not.toContain('emitted markdown refs (#2415)')
  })

  it('AC-7 classifies every awaited gate and gives artifacts a real regen command', () => {
    const gates = deriveGatesForFiles(['src/templates/claude/commands/ship.md.ejs'])
    expect(gates.length).toBeGreaterThan(0)
    expect(gates.length).toBeLessThan(GATE_AFFECTS_REGISTRY.length)
    expect(new Set(gates.map((gate) => gate.name)).size).toBe(gates.length)
    for (const gate of gates) {
      expect(['test-first', 'artifact-regenerate', 'constraint']).toContain(gate.kind)
      if (gate.kind === 'artifact-regenerate') expect(gate.command).toMatch(/\S/)
    }
    expect(gates.find((gate) => gate.name === 'examples drift (#2222)')).toMatchObject({
      kind: 'artifact-regenerate',
      command: 'node scripts/regenerate-examples.mjs',
    })
    expect(gates.find((gate) => gate.name === 'integration suite (INV-25)')).toMatchObject({
      kind: 'artifact-regenerate',
      command: 'BAKE_UPDATE_SNAPSHOTS=1 npm run test:e2e:bake',
    })
    expect(gates.find((gate) => gate.name === 'dogfood')).toMatchObject({ kind: 'constraint' })
    expect(gates.find((gate) => gate.name === 'emitted markdown refs (#2415)')).toMatchObject({
      kind: 'constraint',
    })
  })

  it('is deterministic and fail-safe for gate machinery changes', () => {
    const files = ['src/templates/claude/commands/ship.md.ejs']
    expect(deriveGatesForFiles(files)).toEqual(deriveGatesForFiles(files))
    expect(deriveGatesForFiles(['scripts/lib/gate-affects-registry.mjs'])).toHaveLength(
      GATE_AFFECTS_REGISTRY.length,
    )
  })

  it('AC-2 rejects missing and plausible-but-wrong stored lists, then accepts recomputation', () => {
    const files = ['src/templates/claude/commands/ship.md.ejs']
    const expected = deriveGatesForFiles(files)
    expect(validateDerivedGates(files, undefined).ok).toBe(false)
    expect(
      validateDerivedGates(files, [
        { name: 'unit tests', kind: 'test-first' },
        { name: 'dogfood', kind: 'constraint' },
      ]).ok,
    ).toBe(false)
    expect(validateDerivedGates(files, expected)).toEqual({ ok: true, expected })
  })

  it('reads the existing YAML-frontmatter files manifest shape', () => {
    const plan = [
      '---',
      "title: '#2773'",
      'files:',
      '  - scripts/lib/gate-derivation.mjs',
      '  - __tests__/scripts/gate-derivation.test.ts',
      '---',
      '# Plan',
    ].join('\n')
    expect(parsePlanFilesManifest(plan)).toEqual([
      'scripts/lib/gate-derivation.mjs',
      '__tests__/scripts/gate-derivation.test.ts',
    ])
    expect(parsePlanFilesManifest('# Plan\nNo manifest')).toBeNull()
  })

  it('AC-6 counts only observed gate failures and computes recall', () => {
    expect(
      extractGateFailures(
        '[CHECK] tdd-evidence ... FAIL (exit 2, 35ms)\n' +
          'Failed checks:\n- tdd-evidence (FAIL)\ncheckout failed',
      ),
    ).toEqual(['tdd-evidence'])
    expect(
      extractGateFailures(
        JSON.stringify({
          schema: 'arbiter-gate-v1',
          gates: [
            { name: 'coverage', status: 'FAIL', pass: false },
            { name: 'unit tests', status: 'PASS', pass: true },
          ],
        }),
      ),
    ).toEqual(['coverage'])
    expect(
      computeRecall([
        { predicted: ['tdd-evidence'], observed: ['tdd-evidence'] },
        { predicted: ['unit tests'], observed: ['coverage'] },
        { predicted: [], observed: [] },
      ]),
    ).toEqual({ actualFailures: 2, predictedFailures: 1, recall: 50 })
  })
})
