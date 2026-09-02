// SPDX-License-Identifier: Apache-2.0
// __tests__/scripts/self-only-surfaces.test.ts
// #2417 AC-1: one machine-readable manifest of arbiter-self-only surfaces
// (commands, skills, agents, hooks that exist in arbiter's .claude/ but are
// never emitted to generated target projects). This test asserts the
// checked-in scripts/data/self-only-surfaces.json equals the value derived
// from the existing SSOTs (skill-names.json, the command/agent template
// corpus, canon01-self-only.json) — never hand-listed.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { deriveSelfOnlySurfaces } from '../../scripts/lib/self-only-surfaces.mjs'

const ROOT = resolve('.')
const MANIFEST_PATH = resolve('scripts/data/self-only-surfaces.json')

describe('deriveSelfOnlySurfaces()', () => {
  it('finds the self-only slash commands (in .claude/commands/, no template twin)', () => {
    const derived = deriveSelfOnlySurfaces(ROOT)
    expect(derived.commands).toEqual(['gap', 'replay', 'review-code', 'status'])
  })

  it('finds the self-only skills (in .claude/skills/, absent from skill-names.json)', () => {
    const derived = deriveSelfOnlySurfaces(ROOT)
    expect(derived.skills).toEqual([
      'context-rot-management',
      'refutation',
      'senior-survey',
      'ssot-navigation',
      'visual-verification',
    ])
  })

  it('finds the self-only agents (in .claude/agents/, no template twin)', () => {
    const derived = deriveSelfOnlySurfaces(ROOT)
    expect(derived.agents).toEqual(['ai-pr-gate'])
  })

  it('finds the self-only hooks (.claude/hooks/ entries in canon01-self-only.json)', () => {
    const derived = deriveSelfOnlySurfaces(ROOT)
    expect(derived.hooks).toEqual([
      '.claude/hooks/check-no-any.mjs',
      '.claude/hooks/check-no-direct-spawn.mjs',
      '.claude/hooks/pre-edit-load-memory.mjs',
    ])
  })
})

describe('idempotency guard (repo-root artifact)', () => {
  it('scripts/data/self-only-surfaces.json equals the derived set', () => {
    const derived = deriveSelfOnlySurfaces(ROOT)
    const committed = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'))
    expect(committed).toEqual(derived)
  })
})

describe('reverse sanity backstop (emitted surfaces resolve locally)', () => {
  it('every skill-names.json entry has a local .claude/skills/<name>/ directory', () => {
    const skillNames: string[] = JSON.parse(
      readFileSync(join(ROOT, 'src/generators/skill-names.json'), 'utf-8'),
    )
    const localSkillDirs = new Set(
      readdirSync(join(ROOT, '.claude/skills'), { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name),
    )
    for (const name of skillNames) {
      expect(localSkillDirs.has(name)).toBe(true)
    }
  })

  it('every emitted command template has a local .claude/commands/<name>.md', () => {
    const templateNames = readdirSync(join(ROOT, 'src/templates/claude/commands'))
      .filter((f) => f.endsWith('.md.ejs'))
      .map((f) => f.replace(/\.md\.ejs$/, ''))
    const localCommands = new Set(
      readdirSync(join(ROOT, '.claude/commands'))
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.replace(/\.md$/, '')),
    )
    for (const name of templateNames) {
      expect(localCommands.has(name)).toBe(true)
    }
  })

  it('every emitted agent template has a local .claude/agents/<name>.md', () => {
    const templateNames = readdirSync(join(ROOT, 'src/templates/claude/agents'))
      .filter((f) => f.endsWith('.md.ejs'))
      .map((f) => f.replace(/\.md\.ejs$/, ''))
    const localAgents = new Set(
      readdirSync(join(ROOT, '.claude/agents'))
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.replace(/\.md$/, '')),
    )
    for (const name of templateNames) {
      expect(localAgents.has(name)).toBe(true)
    }
  })
})
