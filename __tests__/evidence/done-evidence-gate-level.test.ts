// SPDX-License-Identifier: Apache-2.0
/**
 * #2615 — `done-evidence` invoked `check-all.mjs L4`. That positional argument
 * becomes the gate-pass marker's `level` field by a path worth naming exactly,
 * because the field the defect travels through is NOT the one it looks like:
 *
 *   done-evidence.mjs  ->  check-all.mjs L4
 *   parseCheckArgs(['L4'])          -> { subcommand: 'gate', level: 'L4' }
 *   check-all.mjs:78 effectiveGateLevel(parsed)  -> 'L4'
 *   check-all.mjs:741 buildGateEvidence({ level }) -> .arbiter/gate-pass.json
 *   gate-evidence.mjs:340 GATE_EVIDENCE_LEVEL_RANK['L4'] === undefined
 *   -> `gate-pass marker level "L4" is not a known gate level`
 *
 * L4 is a *governance* level (ADR-050, INV-112); the gate-evidence ladder tops
 * out at L3. So the INVOCATION argument is the defect, and it is what these
 * tests pin. `done-evidence`'s own `gate_level` field lives in a different file
 * (`.claude/.last-done-evidence.json`) and no gate-evidence consumer ranks it —
 * keeping it equal to the level actually run is bookkeeping honesty, not the fix.
 * Reproduced on main 3d729d73 at 2026-09-09T04:19:45Z, blocking native closure.
 *
 * The ladder is authoritative here and is NOT widened: in `check-all.mjs` the
 * level is only a label — the executed check set comes from the subcommand, and
 * the L2/L3/L4 positional aliases all resolve to `gate`. Admitting L4 would let
 * the L2 check set satisfy `--min-level L4` (INV-33, no green-by-assertion).
 * So the producer must emit a level the ladder admits, and both twins must.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GATE_EVIDENCE_LEVEL_RANK } from '../../scripts/lib/gate-evidence.mjs'
import { parseCheckArgs, effectiveGateLevel } from '../../scripts/lib/parse-check-args.mjs'

const ROOT = join(__dirname, '..', '..')

const PRODUCERS = [
  ['self', 'scripts/done-evidence.mjs'],
  ['generated twin', 'src/templates/scripts/done-evidence.mjs.ejs'],
] as const

/** The positional level `done-evidence` hands to `check-all.mjs`. */
function gateInvocationLevel(source: string): string {
  const m = source.match(/spawnSync\(\s*'node',\s*\['scripts\/check-all\.mjs',\s*'([^']+)'\]/)
  if (m === null) throw new Error('no check-all invocation found in producer')
  return m[1]
}

/** The level literal `done-evidence` records in the v2 completion receipt. */
function stampedLevel(source: string): string {
  const m = source.match(/gate_level:\s*'([^']+)'/)
  if (m === null) throw new Error('no gate_level literal found in producer')
  return m[1]
}

describe.each(PRODUCERS)('#2615 done-evidence gate level (%s)', (_label, relPath) => {
  const source = readFileSync(join(ROOT, relPath), 'utf-8')

  it('AC-1: invokes the gate at a level the gate-evidence ladder admits', () => {
    // AC-1: this is the value that becomes the marker's `level` (see header), so
    // it is the one the ladder must admit. L4 is absent from the ladder by design.
    expect(Object.keys(GATE_EVIDENCE_LEVEL_RANK)).toContain(
      effectiveGateLevel(parseCheckArgs([gateInvocationLevel(source)])),
    )
  })

  it('AC-3: records in the receipt the level it actually ran', () => {
    // AC-3: no consumer ranks `gate_level`, so this cannot reject a marker — but a
    // record claiming a level the gate did not run is the same defect wearing the
    // opposite sign, and it is the field a human reads when auditing a closure.
    expect(stampedLevel(source)).toBe(gateInvocationLevel(source))
  })

  it('AC-2: still resolves to the full gate lane, not the fast check lane', () => {
    // AC-2: no coverage traded for the relabel.
    const parsed = parseCheckArgs([gateInvocationLevel(source)])
    expect(parsed.subcommand).toBe('gate')
    expect(effectiveGateLevel(parsed)).toBe(stampedLevel(source))
  })
})
