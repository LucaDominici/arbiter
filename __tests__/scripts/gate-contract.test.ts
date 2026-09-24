// SPDX-License-Identifier: Apache-2.0
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectGateContract, unresolvedContractReasons } from '../../scripts/lib/gate-contract.mjs'
import { deriveGatesForFiles } from '../../scripts/lib/gate-derivation.mjs'

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

  it('stores each debt ratchet with its static baseline and tolerance only (#2863 AC-3)', () => {
    const contract = inspectGateContract(process.cwd())
    const debt = contract.gates.find((gate: { name?: string }) => gate.name === 'debt ratchet')
    const threshold = (name: string) =>
      debt.thresholds.find((entry: { name: string }) => entry.name === name)

    expect(threshold('coverageBranch')).toEqual({
      name: 'coverageBranch',
      value: 90.42,
      source: 'scripts/debt-baseline.json#metrics.coverageBranch.value',
      direction: 'higher-is-better',
      tolerance: 0.4,
    })
    expect(threshold('publicApiSurface')).toEqual({
      name: 'publicApiSurface',
      value: 1174,
      source: 'scripts/debt-baseline.json#metrics.publicApiSurface.value',
      direction: 'lower-is-better',
      tolerance: 0,
    })
  })

  it('keeps the contract across a current-value change and invalidates it on a baseline change (#2863 AC-3)', () => {
    const root = mkdtempSync(join(tmpdir(), 'arbiter-gate-contract-ac3-'))
    roots.push(root)
    for (const path of [
      'scripts',
      '.github/workflows',
      'vitest.config.ts',
      '.coverage-baseline.json',
      'arbiter.json',
      'package.json',
      '.prettierrc.json',
      '.prettierignore',
      '.template-tests-baseline.txt',
      '.dogfood-divergences.json',
    ]) {
      cpSync(join(process.cwd(), path), join(root, path), { recursive: true })
    }
    symlinkSync(join(process.cwd(), 'node_modules'), join(root, 'node_modules'))
    const before = inspectGateContract(root)
    expect(unresolvedContractReasons(before)).toEqual([])

    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src', 'added.ts'), 'export const added = 1\n')
    expect(inspectGateContract(root)).toEqual(before)

    const baselinePath = join(root, 'scripts', 'debt-baseline.json')
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf-8'))
    baseline.metrics.publicApiSurface.value += 1
    writeFileSync(baselinePath, JSON.stringify(baseline, null, 2))
    expect(inspectGateContract(root)).not.toEqual(before)
  }, 30_000)

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

// #2850 D8: a plan that promises the exact-SHA route must not report "fully resolved" while
// pr-merge-watch would refuse it at close. Admission resolves it with the same authority.
describe('gate contract landing route (#2850 D8)', () => {
  function rootWith(config: string | undefined): string {
    const root = mkdtempSync(join(tmpdir(), 'arbiter-gate-landing-'))
    roots.push(root)
    mkdirSync(join(root, 'scripts'))
    writeFileSync(
      join(root, 'scripts', 'check-all.mjs'),
      [
        '// @arbiter-gate-contract arbiter-gate-contract-v1',
        "import { createHash } from 'node:crypto'",
        "import { readFileSync } from 'node:fs'",
        "import { fileURLToPath } from 'node:url'",
        "const sha256 = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex')",
        "console.log(JSON.stringify({ schema: 'arbiter-gate-contract-v1', authority: [{ path: 'scripts/check-all.mjs', sha256 }], gates: [], external: [], unresolved: [] }))",
        '',
      ].join('\n'),
    )
    if (config !== undefined) writeFileSync(join(root, 'arbiter.json'), config)
    return root
  }

  const landing = (entry: { name?: string }) => entry.name === 'landing route'

  it.each([
    ['an absent mode', JSON.stringify({ version: '0.2' }), /collaborationMode is absent/],
    ['a malformed config', '{', /did not resolve to an object/],
    ['a missing config', undefined, /did not resolve to an object/],
    [
      'trunk-solo without pr-ff',
      JSON.stringify({ collaborationMode: 'trunk-solo', solo: { mergeMode: 'squash' } }),
      /only with solo\.mergeMode "pr-ff"/,
    ],
  ])('blocks admission when the landing route for %s is refused', (_label, config, reason) => {
    const contract = inspectGateContract(rootWith(config))

    expect(contract.unresolved.filter(landing)).toEqual([
      { name: 'landing route', source: 'arbiter.json', reason: expect.stringMatching(reason) },
    ])
    expect(unresolvedContractReasons(contract)).toContainEqual(expect.stringMatching(reason))
    expect(deriveGatesForFiles([], undefined, contract).filter(landing)).toEqual([
      expect.objectContaining({ kind: 'constraint', status: 'unresolved' }),
    ])
  })

  it('admits trunk-solo + pr-ff and surfaces the canonical route in the derived gates', () => {
    const contract = inspectGateContract(
      rootWith(JSON.stringify({ collaborationMode: 'trunk-solo', solo: { mergeMode: 'pr-ff' } })),
    )

    expect(unresolvedContractReasons(contract)).toEqual([])
    expect(deriveGatesForFiles([], undefined, contract).filter(landing)).toEqual([
      expect.objectContaining({
        kind: 'constraint',
        source: 'arbiter.json',
        condition: expect.stringMatching(/^trunk-solo \+ solo\.mergeMode pr-ff: .*updateRefs CAS/),
      }),
    ])
  })

  // Reviewed-PR profiles land through a normal GitHub PR merge in task-ship; the exact-SHA
  // resolver governs only the pr-merge-watch route, so it must not refuse them here.
  it.each(['peer-review', 'gated-review'])(
    'admits %s on its reviewed GitHub PR merge route without the exact-SHA resolver',
    (mode) => {
      const contract = inspectGateContract(rootWith(JSON.stringify({ collaborationMode: mode })))

      expect(unresolvedContractReasons(contract)).toEqual([])
      expect(deriveGatesForFiles([], undefined, contract).filter(landing)).toEqual([
        expect.objectContaining({
          kind: 'constraint',
          source: 'arbiter.json',
          condition: expect.stringMatching(new RegExp(`^${mode}: GitHub PR merge`)),
        }),
      ])
    },
  )

  it('admits trunk-solo + direct, which lands without a PR', () => {
    const contract = inspectGateContract(
      rootWith(JSON.stringify({ collaborationMode: 'trunk-solo', solo: { mergeMode: 'direct' } })),
    )

    expect(unresolvedContractReasons(contract)).toEqual([])
    expect(contract.landing).toMatchObject({
      name: 'landing route',
      condition: expect.stringMatching(/direct/),
    })
  })
})
