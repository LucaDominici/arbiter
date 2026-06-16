// SPDX-License-Identifier: Apache-2.0
// CANON-04 / INV-48: render tests for the #1421 /levelup orchestrator skill + command templates,
// so check-template-tests.mjs recognises each EJS file as tested:
//   claude/skills/levelup/SKILL.md.ejs
//   claude/commands/levelup.md.ejs
// These render byte-equal to their materialized .claude/ twins (dogfood parity, INV-45 covers
// byte-equality); this render test is the CANON-04 contract that each template renders non-empty
// and documents the honest, fail-closed level-up loop (anti-fake-green + no-regress).
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

const config = makeConfig('/tmp/test', { language: 'typescript', governanceLevel: 'L2' })

describe('levelup orchestrator skill + command templates (#1421)', () => {
  it('renders claude/skills/levelup/SKILL.md.ejs', () => {
    const out = renderTemplate('claude/skills/levelup/SKILL.md.ejs', config)
    expect(out).toContain('levelup')
    expect(out.length).toBeGreaterThan(50)
  })

  it('renders claude/commands/levelup.md.ejs', () => {
    const out = renderTemplate('claude/commands/levelup.md.ejs', config)
    expect(out).toContain('levelup')
    expect(out.length).toBeGreaterThan(20)
  })

  it('skill composes the existing gold-audit + close-gold-gap CLIs (no new engine)', () => {
    const out = renderTemplate('claude/skills/levelup/SKILL.md.ejs', config)
    expect(out).toContain('arbiter gold-audit')
    expect(out).toContain('close-gold-gap')
  })

  it('skill gates each wave on the no-regress + anti-fake-green guards (fail-closed)', () => {
    const out = renderTemplate('claude/skills/levelup/SKILL.md.ejs', config)
    expect(out).toContain('gold-audit --check')
    expect(out).toMatch(/anti-fake-green/i)
    expect(out).toMatch(/fail-closed/i)
  })

  it('skill routes un-closeable gaps to needs-human, never fakes a green', () => {
    const out = renderTemplate('claude/skills/levelup/SKILL.md.ejs', config)
    expect(out).toMatch(/needs-human/i)
  })
})
