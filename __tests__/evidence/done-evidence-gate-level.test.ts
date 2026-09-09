// SPDX-License-Identifier: Apache-2.0
/**
 * #2615 — `done-evidence` is the PRODUCER of the gate-pass marker that every
 * `gate-evidence` consumer validates. It stamped `gate_level: 'L4'`, a
 * *governance* level (ADR-050, INV-112), into a field read against the
 * *gate-evidence ladder*, which tops out at L3. Every consumer therefore
 * rejected a freshly captured marker with `not a known gate level`, blocking
 * native task closure on main 3d729d73.
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

/** The level literal written into the marker's `gate_level` field. */
function stampedLevel(source: string): string {
  const m = source.match(/gate_level:\s*'([^']+)'/)
  if (m === null) throw new Error('no gate_level literal found in producer')
  return m[1]
}

describe.each(PRODUCERS)('#2615 done-evidence gate level (%s)', (_label, relPath) => {
  const source = readFileSync(join(ROOT, relPath), 'utf-8')

  it('stamps a level the gate-evidence ladder admits', () => {
    // AC-1: the consumer rank map is the contract; L4 is absent from it by design.
    expect(Object.keys(GATE_EVIDENCE_LEVEL_RANK)).toContain(stampedLevel(source))
  })

  it('runs the level it stamps', () => {
    // AC-3: a marker claiming a level the gate did not run is the same defect
    // wearing the opposite sign.
    expect(gateInvocationLevel(source)).toBe(stampedLevel(source))
  })

  it('still resolves to the full gate lane, not the fast check lane', () => {
    // AC-2: no coverage traded for the relabel.
    const parsed = parseCheckArgs([gateInvocationLevel(source)])
    expect(parsed.subcommand).toBe('gate')
    expect(effectiveGateLevel(parsed)).toBe(stampedLevel(source))
  })
})
