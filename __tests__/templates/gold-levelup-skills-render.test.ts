// SPDX-License-Identifier: Apache-2.0
// CANON-04 / INV-48: render tests for the #1420 / #1422 gold level-up skill + command templates,
// so check-template-tests.mjs recognises each EJS file as tested:
//   claude/skills/gold-audit/SKILL.md.ejs
//   claude/commands/gold-audit.md.ejs
//   claude/skills/close-gold-gap/SKILL.md.ejs
//   claude/commands/close-gold-gap.md.ejs
// These render byte-equal to their materialized .claude/ twins (dogfood parity, INV-45 covers byte-equality);
// this render test is the CANON-04 contract that each template renders non-empty with its skill/command name.
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

const config = makeConfig('/tmp/test', { language: 'typescript', governanceLevel: 'L2' })

describe('gold level-up skill + command templates (#1420/#1422)', () => {
  it('renders claude/skills/gold-audit/SKILL.md.ejs', () => {
    const out = renderTemplate('claude/skills/gold-audit/SKILL.md.ejs', config)
    expect(out).toContain('gold-audit')
    expect(out.length).toBeGreaterThan(50)
  })

  it('renders claude/commands/gold-audit.md.ejs', () => {
    const out = renderTemplate('claude/commands/gold-audit.md.ejs', config)
    expect(out).toContain('gold-audit')
    expect(out.length).toBeGreaterThan(20)
  })

  it('renders claude/skills/close-gold-gap/SKILL.md.ejs', () => {
    const out = renderTemplate('claude/skills/close-gold-gap/SKILL.md.ejs', config)
    expect(out).toContain('close-gold-gap')
    expect(out.length).toBeGreaterThan(50)
  })

  it('renders claude/commands/close-gold-gap.md.ejs', () => {
    const out = renderTemplate('claude/commands/close-gold-gap.md.ejs', config)
    expect(out).toContain('close-gold-gap')
    expect(out.length).toBeGreaterThan(20)
  })
})
