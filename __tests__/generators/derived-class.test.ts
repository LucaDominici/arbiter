// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { isDerivedTrackKey, DERIVED_TRACK_KEYS } from '../../src/generators/derived-class.js'
import { CODEX_DERIVED_RULES } from '../../src/generators/codex-known-limitations.js'
import { SHARED_GUARD_HOOKS } from '../../src/generators/codex-hooks.js'

describe('isDerivedTrackKey / DERIVED_TRACK_KEYS (#1983 refresh-derived manifest)', () => {
  it('is derived from CODEX_DERIVED_RULES — every rule file is covered, single source of truth', () => {
    for (const rule of CODEX_DERIVED_RULES) {
      expect(DERIVED_TRACK_KEYS).toContain(`.agents/rules/${rule.file}`)
      expect(isDerivedTrackKey(`.agents/rules/${rule.file}`)).toBe(true)
    }
  })

  it('is derived from SHARED_GUARD_HOOKS — every shared guard hook is covered', () => {
    for (const hook of SHARED_GUARD_HOOKS) {
      expect(DERIVED_TRACK_KEYS).toContain(`.claude/hooks/${hook}`)
      expect(isDerivedTrackKey(`.claude/hooks/${hook}`)).toBe(true)
    }
  })

  it('covers the codex hook plumbing + adapter emissions', () => {
    expect(isDerivedTrackKey('.claude/hooks/lib.mjs')).toBe(true)
    expect(isDerivedTrackKey('.claude/hooks/check-no-skipped-tests.mjs')).toBe(true)
    expect(isDerivedTrackKey('.codex/codex-adapter.mjs')).toBe(true)
  })

  it('excludes the plan scaffold README (not derived-from-Claude-template content)', () => {
    expect(isDerivedTrackKey('.agents/plan/README.md')).toBe(false)
  })

  it('excludes unrelated skipIfExists files', () => {
    expect(isDerivedTrackKey('scripts/check-collab-mode-wired.mjs')).toBe(false)
    expect(isDerivedTrackKey('arbiter.json')).toBe(false)
    expect(isDerivedTrackKey('.agents/CODEX.md')).toBe(false)
  })
})
