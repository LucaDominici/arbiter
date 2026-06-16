// SPDX-License-Identifier: Apache-2.0
//
// #1406 — Probe downstream generation. The wave-drain SKILL.md emitted to consumer
// projects must carry the Probe loop's Phase 0.5 — Harvest step and the canonical
// `FindingEntry` schema (CANON-04 render assertion). This is what lets a freshly
// `arbiter init`-ed project drain its incidental-finding spool via `arbiter findings
// promote` in the next wave. It also resolves the W2 `.dogfood-divergences.json`
// deferral for `skills/wave-drain/SKILL.md` — the rendered template must now match self.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateSkills } from '../../src/generators/skills.js'

/** The canonical FindingEntry keys (mirror of task-note.ts; `graphNode` is optional). */
const REQUIRED_FINDING_FIELDS = [
  'ts',
  'note',
  'kind',
  'severity',
  'foundDuring',
  'file',
  'line',
  'sha',
  'fingerprint',
] as const

describe('wave-drain downstream generation — Probe loop (#1406)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  function renderWaveDrain(): string {
    const config = makeConfig(dir, { tools: ['claude'] })
    generateSkills(config, [])
    return readFileSync(join(dir, '.claude', 'skills', 'wave-drain', 'SKILL.md'), 'utf-8')
  }

  it('renders a Phase 0.5 — Harvest step running `arbiter findings promote`', () => {
    const md = renderWaveDrain()
    expect(md).toMatch(/Phase 0\.5/)
    expect(md).toMatch(/arbiter findings promote/)
  })

  it('documents the manual escape hatch (`arbiter findings list`)', () => {
    const md = renderWaveDrain()
    expect(md).toMatch(/arbiter findings list/)
  })

  it('cites task-note.ts FindingEntry as the SSOT for the DONE-report shape', () => {
    const md = renderWaveDrain()
    expect(md).toMatch(/FindingEntry/)
    expect(md).toMatch(/task-note/)
  })

  it('documents every required FindingEntry field in the rendered skill', () => {
    const md = renderWaveDrain()
    for (const field of REQUIRED_FINDING_FIELDS) {
      expect(md).toContain(field)
    }
  })

  it('embeds a valid JSON finding shape carrying the FindingEntry keys', () => {
    const md = renderWaveDrain()
    const fence = md.match(/```json\s*([\s\S]*?)```/)
    expect(fence).not.toBeNull()
    const parsed = JSON.parse(fence![1]) as Record<string, unknown>
    for (const field of REQUIRED_FINDING_FIELDS) {
      expect(Object.keys(parsed)).toContain(field)
    }
  })
})
