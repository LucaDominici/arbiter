// SPDX-License-Identifier: Apache-2.0
// #1331 — emission-coherence matrix lint. Complement to the #1321 virgin-init E2E
// harness: where that runs the REAL generated gate (expensive, toolchain-bound,
// nightly), this is a STATIC coherence lint of the emitted tree — `runGenerators`
// into a tmpdir (in-process, no toolchains) then assert the checker finds zero
// "referenced-but-never-emitted" ghosts + workflow hygiene, across the FULL
// (language × level × mode) matrix. Cheap enough to run per-PR (L1, not VITEST_L2).
//
// PoC origin: 3 ghosts found fleet-wide (ci-classify-changes.mjs unwired;
// iso9001/gdpr guarded-missing undeclared; exitplanmode-banner.mjs registered but
// not emitted). This matrix is the regression net that keeps them fixed.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runGenerators } from '../../../src/commands/init.js'
import { makeConfig } from '../../helpers.js'
import { checkEmissionCoherence } from '../../../scripts/check-emission-coherence.mjs'
import type { Language } from '../../../src/wizard/types.js'

type Mode = 'trunk-solo' | 'peer-review'
interface Cell {
  language: Language
  archetype: 'library' | 'cli' | 'backend-web-db' | 'frontend-spa'
  level: 'L1' | 'L2' | 'L3'
  mode: Mode
  // #1345: when the evidence harness is off, scripts/done-evidence.mjs is NOT
  // emitted; ship.md's Complete section and the Makefile evidence: target must
  // drop their references in lockstep, or the widened scanner (Makefile +
  // commands) flags an unguarded ghost.
  evidenceHarness?: boolean
  // #1835: when the self-validation harness is off, scripts/check-pipe-tee-hazard.mjs
  // must NOT be referenced by check-all.mjs (it has no other emitter) — proves the
  // crash-class ghost (MODULE_NOT_FOUND) fixed by the anti-drift fallback stays fixed.
  selfValidationHarness?: boolean
  // #1835: audit-toolchain.mjs is opt-in (config.enableAuditToolchain) — proves the
  // opt-in wiring is coherent (emitted iff referenced) when a project turns it on.
  auditToolchain?: boolean
}

// PoC's 5 languages × {L1,L2,L3} × {trunk-solo, peer-review}, plus a frontend-spa
// cell (exercises FE-overlay guarded-optional declarations) — the full per-PR matrix.
const LANGUAGES: Language[] = ['typescript', 'go', 'python', 'rust', 'java']
const LEVELS: Array<'L1' | 'L2' | 'L3'> = ['L1', 'L2', 'L3']
const MODES: Mode[] = ['trunk-solo', 'peer-review']

const CELLS: Cell[] = []
for (const language of LANGUAGES) {
  for (const level of LEVELS) {
    for (const mode of MODES) {
      CELLS.push({ language, archetype: 'library', level, mode })
    }
  }
}
// FE-overlay cell: frontend-spa emits the FE guarded-optional scripts behind
// existsSync; its presence proves the manifest covers the FE optionals at L2.
CELLS.push({ language: 'typescript', archetype: 'frontend-spa', level: 'L2', mode: 'trunk-solo' })
// Evidence-harness-off cell (#1345): the real init default at L1/L2/L3. Proves
// ship.md + Makefile drop the done-evidence reference when the script is absent.
CELLS.push({
  language: 'typescript',
  archetype: 'library',
  level: 'L2',
  mode: 'trunk-solo',
  evidenceHarness: false,
})
// #1835: self-validation-harness-off cell. check-pipe-tee-hazard.mjs is referenced
// unguarded in check-all.mjs.ejs; without an anti-drift fallback emitter it is a
// crash-class ghost (MODULE_NOT_FOUND) whenever a project disables the harness.
CELLS.push({
  language: 'typescript',
  archetype: 'library',
  level: 'L1',
  mode: 'trunk-solo',
  selfValidationHarness: false,
})
// #1835: audit-toolchain opt-in cell. Proves the explicit opt-in flag emits AND
// wires the script together (never one without the other).
CELLS.push({
  language: 'typescript',
  archetype: 'library',
  level: 'L2',
  mode: 'trunk-solo',
  auditToolchain: true,
})

function cellName(c: Cell): string {
  const ev = c.evidenceHarness === false ? '/evidence-off' : ''
  const sv = c.selfValidationHarness === false ? '/self-validation-off' : ''
  const at = c.auditToolchain === true ? '/audit-toolchain-on' : ''
  return `${c.language}/${c.archetype}/${c.level}/${c.mode}${ev}${sv}${at}`
}

describe('emission-coherence matrix — generated tree is reference-coherent (#1331)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'emission-coherence-matrix-'))
  })

  afterEach(() => {
    if (dir != null) rmSync(dir, { recursive: true, force: true })
  })

  for (const cell of CELLS) {
    it(`${cellName(cell)}: every emission reference resolves`, () => {
      // The coherence matrix normally renders into an empty directory. Seed the
      // source package.json for TypeScript cells so package-mutating generators
      // and the npm-script resolver exercise the same emission seam as a real
      // target project (#2198).
      if (cell.language === 'typescript') {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({ name: 'coherence-cell', version: '1.0.0', scripts: {} }) + '\n',
        )
      }
      runGenerators(
        makeConfig(dir, {
          language: cell.language,
          archetype: cell.archetype,
          governanceLevel: cell.level,
          collaborationMode: cell.mode,
          ...(cell.evidenceHarness === undefined
            ? {}
            : { enableEvidenceHarness: cell.evidenceHarness }),
          ...(cell.selfValidationHarness === undefined
            ? {}
            : { enableSelfValidationHarness: cell.selfValidationHarness }),
          ...(cell.auditToolchain === undefined
            ? {}
            : { enableAuditToolchain: cell.auditToolchain }),
          useGitHub: true,
          permitGitHub: true,
          githubOwner: 'acme',
          githubRepo: 'coherence-cell',
        }),
      )
      const { problems } = checkEmissionCoherence(dir)
      expect(
        problems,
        `${cellName(cell)} has emission-coherence problems:\n  - ${problems.join('\n  - ')}`,
      ).toEqual([])
    })
  }
})
