// SPDX-License-Identifier: Apache-2.0
// A6 guard-flip self-test (#1497): a guard that always passes (vacuous) is itself a fake-green.
// The guard-flip harness proves every anti-fake-green guard DISCRIMINATES — it rejects a planted
// BAD fixture (exit 1) and accepts a CLEAN one (exit 0) — and fails CI when a roster guard has no
// such proof. This test exercises (a) the live harness on the real roster (must be green), (b)
// completeness of the registry over the GUARDS SSOT, and (c) the harness's own discrimination:
// a synthetic VACUOUS guard (always exit 0) must be reported, a synthetic discriminating guard
// must not.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { flipGuard } from '../../scripts/check-guard-flip.mjs'
import { GUARDS, CONTEXT_ROT_GATES } from '../../scripts/lib/anti-fake-green-guards.mjs'
import { FLIP_REGISTRY } from '../../scripts/lib/guard-flip-registry.mjs'
import {
  deriveAbsenceFamily,
  auditInversionRegistry,
  loadInversionRegistry,
  flipProofFor,
} from '../../scripts/lib/gate-roster.mjs'

const HARNESS = resolve('scripts/check-guard-flip.mjs')

function withTmp<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'guard-flip-test-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('check-guard-flip — live harness on the real roster', () => {
  it('every anti-fake-green guard discriminates → exit 0', () => {
    const r = spawnSync('node', [HARNESS], { encoding: 'utf-8' })
    expect(r.stdout).toMatch(/proven=\d+ vacuous=0 uncovered=0/)
    expect(r.status).toBe(0)
  })

  it('--help exits 0', () => {
    const r = spawnSync('node', [HARNESS, '--help'], { encoding: 'utf-8' })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('Usage')
  })
})

describe('check-guard-flip — completeness over the GUARDS SSOT', () => {
  it('every guard in the roster has a flip-proof registered (no vacuous gap)', () => {
    const missing = GUARDS.filter((g) => !FLIP_REGISTRY[g.name]).map((g) => g.name)
    expect(missing).toEqual([])
  })
})

describe('check-guard-flip — flip coverage for the anti-context-rot gates (M11, #1943)', () => {
  it('the flip roster enumerates the five E1-E7 gate scripts', () => {
    expect(CONTEXT_ROT_GATES.map((g: { script: string }) => g.script).sort()).toEqual([
      'scripts/check-agent-return.mjs',
      'scripts/check-audit-dry-pass.mjs',
      'scripts/check-handoff-doc.mjs',
      'scripts/check-refutation-verdicts.mjs',
      'scripts/check-touched-vs-manifest.mjs',
    ])
  })

  it('every anti-context-rot gate has a flip-proof registered (no vacuous gap)', () => {
    const missing = CONTEXT_ROT_GATES.filter((g: { name: string }) => !FLIP_REGISTRY[g.name]).map(
      (g: { name: string }) => g.name,
    )
    expect(missing).toEqual([])
  })

  it('each anti-context-rot flip-proof discriminates (bad → red, clean → green)', () => {
    for (const gate of CONTEXT_ROT_GATES) {
      const entry = FLIP_REGISTRY[gate.name]
      expect(entry, `${gate.name} has no registry entry`).toBeDefined()
      expect(flipGuard(gate, entry), `${gate.name} does not discriminate`).toEqual([])
    }
  })
})

describe('check-guard-flip — the harness itself discriminates', () => {
  // A file-scan "guard" that ALWAYS exits 0 — the vacuous fake-green the harness must catch.
  const VACUOUS = 'process.exit(0)\n'
  // A real guard: exits 1 when a sentinel file is present (bad), 0 otherwise (clean).
  const REAL =
    "import { existsSync } from 'node:fs'\n" +
    "import { resolve } from 'node:path'\n" +
    "const i = process.argv.indexOf('--dir')\n" +
    'const dir = i >= 0 ? process.argv[i + 1] : process.cwd()\n' +
    "process.exit(existsSync(resolve(dir, 'BAD')) ? 1 : 0)\n"

  const entry = {
    kind: 'file-scan' as const,
    inject: 'dir' as const,
    plantBad: (d: string) => writeFileSync(join(d, 'BAD'), 'x'),
    plantClean: () => {},
  }

  it('flags a vacuous (always-exit-0) guard as VACUOUS', () => {
    withTmp((dir) => {
      const script = join(dir, 'vacuous.mjs')
      writeFileSync(script, VACUOUS)
      const failures = flipGuard({ name: 'vacuous', script }, entry)
      expect(failures.length).toBeGreaterThan(0)
      expect(failures.join(' ')).toMatch(/accepted a planted BAD fixture/)
    })
  })

  it('passes a guard that genuinely discriminates', () => {
    withTmp((dir) => {
      const script = join(dir, 'real.mjs')
      writeFileSync(script, REAL)
      const failures = flipGuard({ name: 'real', script }, entry)
      expect(failures).toEqual([])
    })
  })

  it('flags an over-eager guard that rejects even a clean fixture', () => {
    withTmp((dir) => {
      // A guard that ALWAYS exits 1 — it "detects" everything, including the clean fixture.
      const script = join(dir, 'overeager.mjs')
      writeFileSync(script, 'process.exit(1)\n')
      const failures = flipGuard({ name: 'overeager', script }, entry)
      expect(failures.join(' ')).toMatch(/rejected a CLEAN fixture/)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// CANON-24 / #2301 — inversion-proof completeness over the absence-asserting gate family.
// The class this guards: a gate that has stopped checking anything still reports green, so the
// symptom of the defect IS the green. The mechanism: every gate in check-all.mjs that asserts the
// ABSENCE of something (check-no-*, ratchets, parity) must either carry a flip proof here or be a
// row in the deferral ledger — and the ledger is banked at a fixed cardinality, so a NEW such gate
// has only one way in: a proof that it goes red when the condition it protects is inverted.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const CHECK_ALL = readFileSync(resolve('scripts/check-all.mjs'), 'utf-8')

// The cardinality of the deferral ledger, pinned as a literal. Raising it requires editing BOTH
// scripts/data/inversion-proof-registry.json and this line — a ratchet that cannot be widened by
// a one-file diff. Lowering it is mandatory when a row is proven and removed (unbanked
// improvement is a failure in this repo, AGENTS.md §template-tests baseline).
const DEFERRED_CEILING = 16

describe('CANON-24 — the absence-asserting gate family is derived, not hand-listed (#2301)', () => {
  it('derives every check-no-*, ratchet and parity gate wired in check-all.mjs', () => {
    const family = deriveAbsenceFamily(CHECK_ALL)
    expect(family.length).toBeGreaterThanOrEqual(25)
    const byName = new Map(family.map((f: { name: string }) => [f.name, f]))
    // one representative of each category — a rename in check-all.mjs must surface here
    expect(byName.get('no work refs')?.category).toBe('no')
    expect(byName.get('bloat ratchet')?.category).toBe('ratchet')
    expect(byName.get('catalog parity')?.category).toBe('parity')
    for (const entry of family) {
      expect(['no', 'ratchet', 'parity']).toContain(entry.category)
      expect(entry.script).toMatch(/^scripts\/.+\.mjs$/)
    }
  })

  it('every family gate is either flip-proven or a row in the deferral ledger', () => {
    const family = deriveAbsenceFamily(CHECK_ALL)
    const registry = loadInversionRegistry(resolve('.'))
    const deferred = new Set(registry.deferred.map((d: { gate: string }) => d.gate))
    const orphans = family
      .filter((f: { name: string }) => !deferred.has(f.name) && !flipProofFor(f, FLIP_REGISTRY))
      .map((f: { name: string }) => f.name)
    expect(orphans, `absence-asserting gates with neither proof nor ledger row: ${orphans}`).toEqual(
      [],
    )
  })

  it('the deferral ledger is banked at its ceiling (non-increasing, no unbanked slack)', () => {
    const registry = loadInversionRegistry(resolve('.'))
    expect(registry.ceiling).toBe(DEFERRED_CEILING)
    expect(registry.deferred.length).toBe(DEFERRED_CEILING)
  })
})

describe('CANON-24 — the ledger auditor discriminates (#2301)', () => {
  const family = [
    { name: 'no work refs', script: 'scripts/check-no-work-refs.mjs', category: 'no' },
    { name: 'bloat ratchet', script: 'scripts/check-bloat-ratchet.mjs', category: 'ratchet' },
  ]
  const row = (over: Record<string, unknown> = {}) => ({
    gate: 'no work refs',
    script: 'scripts/check-no-work-refs.mjs',
    category: 'no',
    reason:
      'the gate reads tracked files through the script’s own repo root, so a fixture cannot be injected',
    issue: 2301,
    expires: '2099-01-01',
    ...over,
  })
  const now = new Date('2026-09-04T00:00:00Z')
  const audit = (registry: unknown) => auditInversionRegistry({ family, registry, now })

  it('accepts a well-formed ledger', () => {
    expect(audit({ ceiling: 1, deferred: [row()] })).toEqual([])
  })

  it('rejects a ledger larger than its ceiling (the ratchet)', () => {
    const problems = audit({
      ceiling: 1,
      deferred: [row(), row({ gate: 'bloat ratchet', script: 'scripts/check-bloat-ratchet.mjs' })],
    })
    expect(problems.join(' ')).toMatch(/ceiling/i)
  })

  it('rejects a ceiling above the ledger (unbanked improvement)', () => {
    expect(audit({ ceiling: 5, deferred: [row()] }).join(' ')).toMatch(/unbanked|ceiling/i)
  })

  it('rejects a row naming a gate that is not in the derived family (a fabricated row)', () => {
    const problems = audit({
      ceiling: 1,
      deferred: [row({ gate: 'a gate that does not exist', script: 'scripts/check-nope.mjs' })],
    })
    expect(problems.join(' ')).toMatch(/not in the absence-asserting family/i)
  })

  it('rejects a row whose script disagrees with the wired gate', () => {
    expect(audit({ ceiling: 1, deferred: [row({ script: 'scripts/check-other.mjs' })] }).join(' ')).toMatch(
      /script/i,
    )
  })

  it('rejects a row whose deferral has expired', () => {
    expect(audit({ ceiling: 1, deferred: [row({ expires: '2026-01-01' })] }).join(' ')).toMatch(
      /expired/i,
    )
  })

  it('rejects a row with no reason (a reasonless row is a blanket exemption)', () => {
    expect(audit({ ceiling: 1, deferred: [row({ reason: '   ' })] }).join(' ')).toMatch(/reason/i)
  })

  it('rejects a duplicated gate row', () => {
    expect(audit({ ceiling: 2, deferred: [row(), row()] }).join(' ')).toMatch(/duplicate/i)
  })

  it('rejects a row with no positive-integer issue reference', () => {
    expect(audit({ ceiling: 1, deferred: [row({ issue: 'PENDING #9999' })] }).join(' ')).toMatch(
      /issue/i,
    )
  })

  it('rejects a malformed ledger shape outright (fail-closed)', () => {
    expect(audit({ deferred: 'nope' }).length).toBeGreaterThan(0)
    expect(audit(null).length).toBeGreaterThan(0)
  })
})

describe('CANON-24 — the harness itself goes red when its own enforcement is inverted (#2301)', () => {
  // A synthetic check-all.mjs declaring an absence-asserting gate that exists in NEITHER the
  // flip registry nor the ledger. This is the exact change that must turn the harness red — if
  // the completeness check were deleted, this case would pass and the harness would be ceremony.
  const FAKE_GATE = "runCheck('no fabricated thing', 'node', ['scripts/check-no-fabricated.mjs'])\n"

  it('an unproven, unledgered absence gate makes the harness exit 1 (UNCOVERED)', () => {
    withTmp((dir) => {
      const gate = join(dir, 'check-all.mjs')
      writeFileSync(gate, FAKE_GATE)
      const reg = join(dir, 'registry.json')
      writeFileSync(reg, JSON.stringify({ ceiling: 0, deferred: [] }))
      const r = spawnSync('node', [HARNESS, `--gate=${gate}`, `--registry=${reg}`], {
        encoding: 'utf-8',
      })
      expect(r.status).toBe(1)
      expect(`${r.stdout}${r.stderr}`).toMatch(/no fabricated thing/)
    })
  })

  it('the same gate passes once a ledger row covers it — and only while the ceiling allows', () => {
    withTmp((dir) => {
      const gate = join(dir, 'check-all.mjs')
      writeFileSync(gate, FAKE_GATE)
      const covered = join(dir, 'covered.json')
      writeFileSync(
        covered,
        JSON.stringify({
          ceiling: 1,
          deferred: [
            {
              gate: 'no fabricated thing',
              script: 'scripts/check-no-fabricated.mjs',
              category: 'no',
              reason: 'synthetic fixture row used to prove the harness accepts a well-formed ledger',
              issue: 2301,
              expires: '2099-01-01',
            },
          ],
        }),
      )
      const ok = spawnSync('node', [HARNESS, `--gate=${gate}`, `--registry=${covered}`], {
        encoding: 'utf-8',
      })
      expect(ok.status).toBe(0)

      // …and the ratchet still binds: the same row over a zero ceiling is red.
      const overflow = join(dir, 'overflow.json')
      const parsed = JSON.parse(readFileSync(covered, 'utf-8'))
      writeFileSync(overflow, JSON.stringify({ ...parsed, ceiling: 0 }))
      const bad = spawnSync('node', [HARNESS, `--gate=${gate}`, `--registry=${overflow}`], {
        encoding: 'utf-8',
      })
      expect(bad.status).toBe(1)
    })
  })
})

describe('CANON-24 — each newly-registered absence-gate flip proof discriminates (#2301)', () => {
  it('every family gate with a proof rejects its planted bad fixture and accepts the clean one', () => {
    const family = deriveAbsenceFamily(CHECK_ALL)
    for (const gate of family) {
      const entry = flipProofFor(gate, FLIP_REGISTRY)
      if (!entry) continue
      expect(flipGuard(gate, entry), `${gate.name} does not discriminate`).toEqual([])
    }
  })
})
