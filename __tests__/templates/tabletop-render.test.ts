// SPDX-License-Identifier: Apache-2.0
// CANON-04 / INV-48: render tests for the #2429 tabletop skill + command + gate templates,
// so check-template-tests.mjs recognises each EJS file as tested:
//   claude/skills/tabletop/SKILL.md.ejs
//   claude/commands/tabletop.md.ejs
//   scripts/check-tabletop-evidence.mjs.ejs
//   schemas/tabletop-evidence.schema.json.ejs
// CANON-06 (command contract): the `/tabletop` command is a .claude/commands markdown, not a
// src/commands/*.ts entry, so its contract is asserted here rather than in __tests__/commands.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderTemplate } from '../../src/utils/render.js'
import { CLAUDE_COMMANDS } from '../../src/generators/claude.js'
import { SKILL_NAMES } from '../../src/generators/skills.js'
import { makeConfig } from '../helpers.js'

const config = makeConfig('/tmp/test', { language: 'typescript', governanceLevel: 'L2' })

describe('tabletop skill + command templates (#2429)', () => {
  it('renders claude/skills/tabletop/SKILL.md.ejs with the tabletop contract', () => {
    const out = renderTemplate('claude/skills/tabletop/SKILL.md.ejs', config)
    expect(out).toContain('name: tabletop')
    expect(out).toContain('.arbiter/evidence/tabletop/')
    // The findings-table contract: seven named columns.
    for (const col of [
      'step',
      'doc claim',
      'observed',
      'severity',
      'class',
      'proposed permanent check',
      'owner',
    ]) {
      expect(out).toContain(col)
    }
    // Hard rules the skill must state.
    expect(out).toContain('never modify the repo')
    expect(out.length).toBeGreaterThan(50)
  })

  it('keeps claude/skills/tabletop/SKILL.md.ejs at or under 120 lines', () => {
    const out = renderTemplate('claude/skills/tabletop/SKILL.md.ejs', config)
    expect(out.trimEnd().split('\n').length).toBeLessThanOrEqual(120)
  })

  it('renders claude/commands/tabletop.md.ejs', () => {
    const out = renderTemplate('claude/commands/tabletop.md.ejs', config)
    expect(out).toContain('/tabletop')
    expect(out).toContain('skill:tabletop')
    expect(out.length).toBeGreaterThan(20)
  })

  it('renders scripts/check-tabletop-evidence.mjs.ejs', () => {
    const out = renderTemplate('scripts/check-tabletop-evidence.mjs.ejs', config)
    expect(out).toContain('.arbiter/evidence/tabletop')
    expect(out).toContain('tabletop-evidence.schema.json')
  })

  it('renders schemas/tabletop-evidence.schema.json.ejs as valid JSON schema', () => {
    const out = renderTemplate('schemas/tabletop-evidence.schema.json.ejs', config)
    const schema = JSON.parse(out) as { required?: string[] }
    expect(schema.required).toEqual(
      expect.arrayContaining(['scenario', 'sha', 'date', 'persona', 'steps', 'findings']),
    )
  })

  it('registers tabletop in the skill and command SSOTs', () => {
    expect(SKILL_NAMES).toContain('tabletop')
    expect(CLAUDE_COMMANDS).toContain('tabletop.md')
  })

  it('offers /tabletop as an optional pre-release step in ship.md and its twin', () => {
    const rendered = renderTemplate('claude/commands/ship.md.ejs', config)
    const materialized = readFileSync('.claude/commands/ship.md', 'utf-8')
    for (const text of [rendered, materialized]) {
      expect(text).toContain('/tabletop')
      expect(text).toContain('blockers are hard stops')
    }
  })
})
