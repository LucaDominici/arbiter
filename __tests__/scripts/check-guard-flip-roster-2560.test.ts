// SPDX-License-Identifier: Apache-2.0
// #2560 — membership is a declared property, not a name match. Before this fix, a gate that
// asserts absence but whose name/script matched none of `^check-no-`/`ratchet|no-regress`/
// `parity` returned `null` from the old regex classifier and sat outside the family forever,
// never asked for a flip proof (`check-todo-max-age.mjs` is the proof case named in the issue).
//
// Kept in its own file, separate from check-guard-flip.test.ts: every case here drives the
// harness exclusively through --gate/--registry/--roster fixtures and never touches the real
// scripts/check-all.mjs or the kernel-plugin-parity flip fixture (which needs dist/ built). This
// file is fully dist-independent, so it can be re-executed in a fresh detached worktree with only
// node_modules linked (the TDD-evidence re-executor's environment) without a spurious failure.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const HARNESS = resolve('scripts/check-guard-flip.mjs')

function withTmp<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'guard-flip-roster-test-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('#2560 — absence-family membership is declared, not name-matched', () => {
  // A gate whose name/basename match NONE of the old three regexes (no `check-no-` prefix, no
  // "ratchet", no "parity") — under the OLD code this returned category `null` and was silently
  // excluded. It DOES assert an absence ("no widget older than N days") and IS declared in the
  // roster here, so it must be admitted to the family.
  const OBSCURE_GATE =
    "runCheck('widget freshness audit', 'node', ['scripts/check-widget-freshness.mjs'])\n"
  const OBSCURE_ROSTER = {
    family: {
      'widget freshness audit': {
        script: 'scripts/check-widget-freshness.mjs',
        category: 'no',
      },
    },
    exempt: {},
  }

  it('a declared gate outside the old name patterns is admitted to the family', () => {
    withTmp((dir) => {
      const gate = join(dir, 'check-all.mjs')
      writeFileSync(gate, OBSCURE_GATE)
      const roster = join(dir, 'roster.json')
      writeFileSync(roster, JSON.stringify(OBSCURE_ROSTER))
      const reg = join(dir, 'registry.json')
      writeFileSync(reg, JSON.stringify({ ceiling: 0, deferred: [] }))
      // No flip proof registered for it either — so it is admitted (not silently excluded) AND
      // reported UNCOVERED, proving both halves: membership by declaration, and the requirement
      // to prove it once a member.
      const r = spawnSync(
        'node',
        [
          HARNESS,
          `--gate=${gate}`,
          `--registry=${reg}`,
          `--roster=${roster}`,
          '--min-family=1',
          '--max-deferred=0',
        ],
        { encoding: 'utf-8' },
      )
      expect(r.status).toBe(1)
      expect(`${r.stdout}${r.stderr}`).toMatch(/widget freshness audit/)
    })
  })

  it('the same gate, wired but UNDECLARED (no roster, no exemption), is a loud ERROR — never null', () => {
    withTmp((dir) => {
      const gate = join(dir, 'check-all.mjs')
      writeFileSync(gate, OBSCURE_GATE)
      const reg = join(dir, 'registry.json')
      writeFileSync(reg, JSON.stringify({ ceiling: 0, deferred: [] }))
      // An empty roster: the candidate signal (drift/regress/snapshot/no/never/absence/
      // ratchet/parity) is deliberately wider than the family it protects — swap in a name the
      // signal DOES catch to prove the loud path fires.
      const signalled =
        "runCheck('widget no-regress audit', 'node', ['scripts/check-widget.mjs'])\n"
      writeFileSync(gate, signalled)
      const emptyRoster = join(dir, 'roster.json')
      writeFileSync(emptyRoster, JSON.stringify({ family: {}, exempt: {} }))
      const r = spawnSync(
        'node',
        [HARNESS, `--gate=${gate}`, `--registry=${reg}`, `--roster=${emptyRoster}`],
        { encoding: 'utf-8' },
      )
      expect(r.status).toBe(2)
      expect(`${r.stdout}${r.stderr}`).toMatch(/undeclared candidate absence-asserting gate/)
      expect(`${r.stdout}${r.stderr}`).toMatch(/widget no-regress audit/)
    })
  })
})
