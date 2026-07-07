// SPDX-License-Identifier: Apache-2.0
//
// #1404 — the wave-drain DONE-report finding shape must converge on the canonical `FindingEntry`
// (the on-main `task-note.ts` SSOT). This guards against the SKILL.md drifting from that schema:
// every required FindingEntry field must be named in the DONE-report section, and the harvest
// (Phase 0.5) + manual escape hatch must be documented.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, expect } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..')
const skillPath = join(repoRoot, '.claude', 'skills', 'wave-drain', 'SKILL.md')

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

describe('wave-drain SKILL.md — canonical finding schema (#1404)', () => {
  const md = readFileSync(skillPath, 'utf-8')

  it('documents every required FindingEntry field in the DONE-report section', () => {
    for (const field of REQUIRED_FINDING_FIELDS) {
      expect(md).toContain(field)
    }
  })

  it('names the optional graphNode field', () => {
    expect(md).toContain('graphNode')
  })

  it('cites task-note.ts FindingEntry as the SSOT for the shape', () => {
    expect(md).toMatch(/FindingEntry/)
    expect(md).toMatch(/task-note/)
  })

  it('adds a Phase 0.5 — Harvest step before Phase 1 noting findings promote/list was removed', () => {
    expect(md).toMatch(/Phase 0\.5/)
    expect(md).toMatch(/was removed in the B-prune/)
  })

  it('documents the manual escape hatch (inspect the spool directly)', () => {
    expect(md).toMatch(/cat \.arbiter\/findings/)
  })

  it('the DONE-report finding shape is valid JSON carrying the FindingEntry keys', () => {
    // Extract the first ```json fenced block in the DONE-report area and parse it.
    const fence = md.match(/```json\s*([\s\S]*?)```/)
    expect(fence).not.toBeNull()
    const parsed = JSON.parse(fence![1]) as Record<string, unknown>
    for (const field of REQUIRED_FINDING_FIELDS) {
      expect(Object.keys(parsed)).toContain(field)
    }
  })
})
