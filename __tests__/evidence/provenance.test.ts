// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for src/evidence/provenance.ts (#2164).
 *
 * Existing Code Survey (CANON-16):
 *   - grep for redTestPath/greenTestPath/gateResult/provenance: zero existing writers.
 *   - Decision: new module — buildProvenance()/validateProvenance()/formatProvenance()
 *     shared by the bundle schema path (JSON Schema is enforced source of truth) and the
 *     SUMMARY.json path (src/evidence/summary.ts, TS-side mirror).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  validateProvenance,
  buildProvenance,
  formatProvenance,
  type Provenance,
} from '../../src/evidence/provenance.js'

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

// ─── validateProvenance ─────────────────────────────────────────────────────

describe('validateProvenance', () => {
  it('accepts an empty object', () => {
    expect(validateProvenance({})).toEqual([])
  })

  it('accepts all five flat string fields populated', () => {
    const errors = validateProvenance({
      model_id: 'claude-sonnet-5',
      agent_harness: 'claude-code',
      harness_version: '2.1.220',
      gate_manifest_hash: 'a'.repeat(64),
      session_id: 'sess-123',
    })
    expect(errors).toEqual([])
  })

  it('accepts a fully populated config_hashes block', () => {
    const errors = validateProvenance({
      config_hashes: {
        agents_md: 'a'.repeat(64),
        claude_md: 'b'.repeat(64),
        skills: ['c'.repeat(64), 'd'.repeat(64)],
      },
    })
    expect(errors).toEqual([])
  })

  it('rejects a non-object value', () => {
    const errors = validateProvenance('not-an-object')
    expect(errors.length).toBeGreaterThan(0)
  })

  it('rejects an array value', () => {
    const errors = validateProvenance([])
    expect(errors.length).toBeGreaterThan(0)
  })

  it('rejects an unknown top-level property', () => {
    const errors = validateProvenance({ unexpected_field: 'x' })
    expect(errors.some((e) => e.includes('unexpected_field'))).toBe(true)
  })

  it.each(['model_id', 'agent_harness', 'harness_version', 'gate_manifest_hash', 'session_id'])(
    'rejects wrong type for flat field: %s',
    (field) => {
      const errors = validateProvenance({ [field]: 42 })
      expect(errors.some((e) => e.includes(field))).toBe(true)
    },
  )

  it('rejects config_hashes that is not an object', () => {
    const errors = validateProvenance({ config_hashes: 'nope' })
    expect(errors.some((e) => e.includes('config_hashes'))).toBe(true)
  })

  it('rejects config_hashes that is an array', () => {
    const errors = validateProvenance({ config_hashes: [] })
    expect(errors.some((e) => e.includes('config_hashes'))).toBe(true)
  })

  it('rejects an unknown property inside config_hashes', () => {
    const errors = validateProvenance({ config_hashes: { bogus: 'x' } })
    expect(errors.some((e) => e.includes('bogus'))).toBe(true)
  })

  it.each(['agents_md', 'claude_md'])('rejects wrong type for config_hashes.%s', (field) => {
    const errors = validateProvenance({ config_hashes: { [field]: 123 } })
    expect(errors.some((e) => e.includes(field))).toBe(true)
  })

  it('rejects config_hashes.skills that is not an array', () => {
    const errors = validateProvenance({ config_hashes: { skills: 'not-array' } })
    expect(errors.some((e) => e.includes('skills'))).toBe(true)
  })

  it('rejects config_hashes.skills with a non-string element', () => {
    const errors = validateProvenance({ config_hashes: { skills: ['ok', 42] } })
    expect(errors.some((e) => e.includes('skills'))).toBe(true)
  })
})

// ─── buildProvenance ────────────────────────────────────────────────────────

describe('buildProvenance', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'provenance-build-test-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('returns undefined when nothing is derivable', () => {
    const result = buildProvenance(root, {})
    expect(result).toBeUndefined()
  })

  it('sets agent_harness=claude-code when CLAUDECODE is truthy', () => {
    const result = buildProvenance(root, { CLAUDECODE: '1' })
    expect(result?.agent_harness).toBe('claude-code')
  })

  it.each(['0', 'false', ''])('omits agent_harness when CLAUDECODE=%s (falsy)', (val) => {
    const result = buildProvenance(root, { CLAUDECODE: val })
    expect(result?.agent_harness).toBeUndefined()
  })

  it('omits agent_harness when CLAUDECODE is unset', () => {
    const result = buildProvenance(root, {})
    expect(result?.agent_harness).toBeUndefined()
  })

  it('derives harness_version from the /versions/<x>/ segment of CLAUDE_CODE_EXECPATH', () => {
    const result = buildProvenance(root, {
      CLAUDE_CODE_EXECPATH: '/home/user/.claude/versions/2.1.220/claude',
    })
    expect(result?.harness_version).toBe('2.1.220')
  })

  it('omits harness_version when CLAUDE_CODE_EXECPATH has no versions segment', () => {
    const result = buildProvenance(root, { CLAUDE_CODE_EXECPATH: '/opt/claude/bin/claude' })
    expect(result?.harness_version).toBeUndefined()
  })

  it('omits harness_version when CLAUDE_CODE_EXECPATH is absent', () => {
    const result = buildProvenance(root, {})
    expect(result?.harness_version).toBeUndefined()
  })

  it('derives session_id from CLAUDE_CODE_SESSION_ID when present', () => {
    const result = buildProvenance(root, { CLAUDE_CODE_SESSION_ID: 'sess-abc-123' })
    expect(result?.session_id).toBe('sess-abc-123')
  })

  it('omits session_id when CLAUDE_CODE_SESSION_ID is absent', () => {
    const result = buildProvenance(root, {})
    expect(result?.session_id).toBeUndefined()
  })

  it('hashes AGENTS.md when present', () => {
    const content = '# AGENTS.md fixture content'
    writeFileSync(join(root, 'AGENTS.md'), content)
    const result = buildProvenance(root, {})
    expect(result?.config_hashes?.agents_md).toBe(sha256(content))
  })

  it('omits config_hashes.agents_md when AGENTS.md is absent', () => {
    const result = buildProvenance(root, {})
    expect(result?.config_hashes?.agents_md).toBeUndefined()
  })

  it('hashes .claude/CLAUDE.md when present', () => {
    mkdirSync(join(root, '.claude'), { recursive: true })
    const content = '# CLAUDE.md fixture content'
    writeFileSync(join(root, '.claude', 'CLAUDE.md'), content)
    const result = buildProvenance(root, {})
    expect(result?.config_hashes?.claude_md).toBe(sha256(content))
  })

  it('omits config_hashes.claude_md when .claude/CLAUDE.md is absent', () => {
    const result = buildProvenance(root, {})
    expect(result?.config_hashes?.claude_md).toBeUndefined()
  })

  it('hashes every SKILL.md under .claude/skills when present', () => {
    const skillA = '# skill A'
    const skillB = '# skill B'
    mkdirSync(join(root, '.claude', 'skills', 'alpha'), { recursive: true })
    mkdirSync(join(root, '.claude', 'skills', 'beta'), { recursive: true })
    writeFileSync(join(root, '.claude', 'skills', 'alpha', 'SKILL.md'), skillA)
    writeFileSync(join(root, '.claude', 'skills', 'beta', 'SKILL.md'), skillB)
    const result = buildProvenance(root, {})
    expect(result?.config_hashes?.skills).toEqual(
      expect.arrayContaining([sha256(skillA), sha256(skillB)]),
    )
    expect(result?.config_hashes?.skills).toHaveLength(2)
  })

  it('omits config_hashes.skills when .claude/skills is absent', () => {
    const result = buildProvenance(root, {})
    expect(result?.config_hashes?.skills).toBeUndefined()
  })

  it('omits config_hashes.skills when .claude/skills exists but is empty', () => {
    mkdirSync(join(root, '.claude', 'skills'), { recursive: true })
    const result = buildProvenance(root, {})
    expect(result?.config_hashes?.skills).toBeUndefined()
  })

  it('omits config_hashes entirely when none of its sources exist', () => {
    const result = buildProvenance(root, {})
    expect(result?.config_hashes).toBeUndefined()
  })

  it('hashes scripts/check-all.mjs into gate_manifest_hash when present', () => {
    const content = '// gate manifest fixture'
    mkdirSync(join(root, 'scripts'), { recursive: true })
    writeFileSync(join(root, 'scripts', 'check-all.mjs'), content)
    const result = buildProvenance(root, {})
    expect(result?.gate_manifest_hash).toBe(sha256(content))
  })

  it('omits gate_manifest_hash when scripts/check-all.mjs is absent', () => {
    const result = buildProvenance(root, {})
    expect(result?.gate_manifest_hash).toBeUndefined()
  })

  it('never invents model_id — always omitted regardless of env', () => {
    const result = buildProvenance(root, {
      CLAUDECODE: '1',
      CLAUDE_CODE_EXECPATH: '/x/versions/9.9.9/claude',
      CLAUDE_CODE_SESSION_ID: 'sess-1',
    })
    expect(result?.model_id).toBeUndefined()
  })

  it('combines every derivable field when everything is present (no PII leak)', () => {
    mkdirSync(join(root, '.claude', 'skills', 'gamma'), { recursive: true })
    mkdirSync(join(root, 'scripts'), { recursive: true })
    const agentsContent = 'SECRET AGENTS CONTENT — should never appear verbatim'
    const claudeContent = 'SECRET CLAUDE CONTENT — should never appear verbatim'
    const skillContent = 'SECRET SKILL CONTENT — should never appear verbatim'
    const gateContent = 'SECRET GATE CONTENT — should never appear verbatim'
    writeFileSync(join(root, 'AGENTS.md'), agentsContent)
    writeFileSync(join(root, '.claude', 'CLAUDE.md'), claudeContent)
    writeFileSync(join(root, '.claude', 'skills', 'gamma', 'SKILL.md'), skillContent)
    writeFileSync(join(root, 'scripts', 'check-all.mjs'), gateContent)

    const env = {
      CLAUDECODE: '1',
      CLAUDE_CODE_EXECPATH: '/home/user/.claude/versions/2.1.220/claude',
      CLAUDE_CODE_SESSION_ID: 'sess-xyz',
    }
    const result = buildProvenance(root, env)
    expect(result).toBeDefined()
    const serialised = JSON.stringify(result)

    // No-PII assertion (AC-4): only hex digests / opaque ids, never raw file content.
    expect(serialised).not.toContain('SECRET')
    expect(serialised).not.toContain(agentsContent)
    expect(serialised).not.toContain(claudeContent)
    expect(serialised).not.toContain(skillContent)
    expect(serialised).not.toContain(gateContent)

    expect(result?.agent_harness).toBe('claude-code')
    expect(result?.harness_version).toBe('2.1.220')
    expect(result?.session_id).toBe('sess-xyz')
    expect(result?.model_id).toBeUndefined()
    expect(result?.config_hashes?.agents_md).toBe(sha256(agentsContent))
    expect(result?.config_hashes?.claude_md).toBe(sha256(claudeContent))
    expect(result?.gate_manifest_hash).toBe(sha256(gateContent))
    expect(result?.config_hashes?.agents_md).toMatch(/^[0-9a-f]{64}$/)
  })
})

// ─── formatProvenance ───────────────────────────────────────────────────────

describe('formatProvenance', () => {
  it('renders every populated field as one line each', () => {
    const p: Provenance = {
      model_id: 'claude-sonnet-5',
      agent_harness: 'claude-code',
      harness_version: '2.1.220',
      session_id: 'sess-1',
      gate_manifest_hash: 'a'.repeat(64),
      config_hashes: {
        agents_md: 'b'.repeat(64),
        claude_md: 'c'.repeat(64),
        skills: ['d'.repeat(64)],
      },
    }
    const lines = formatProvenance(p)
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.some((l) => l.includes('claude-code'))).toBe(true)
    expect(lines.some((l) => l.includes('2.1.220'))).toBe(true)
    expect(lines.some((l) => l.includes('sess-1'))).toBe(true)
  })

  it('returns an empty array for an empty provenance object', () => {
    expect(formatProvenance({})).toEqual([])
  })
})
