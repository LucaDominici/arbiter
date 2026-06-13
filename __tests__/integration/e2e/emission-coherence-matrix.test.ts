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
import { mkdtempSync, rmSync } from 'node:fs'
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

function cellName(c: Cell): string {
  return `${c.language}/${c.archetype}/${c.level}/${c.mode}`
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
      runGenerators(
        makeConfig(dir, {
          language: cell.language,
          archetype: cell.archetype,
          governanceLevel: cell.level,
          collaborationMode: cell.mode,
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
