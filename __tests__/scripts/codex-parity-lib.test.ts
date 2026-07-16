// SPDX-License-Identifier: Apache-2.0
// Unit suite for scripts/lib/codex-parity-lib.mjs (ADR-106, #1966):
// normalizers (scoped — semantic whitespace preserved), classifier (each
// class + unknown + multi-class), schema validators, known-limitations
// parsing, baseline identity/anti-shrinkage. Pure-function level; the
// fixture-bake mutations live in check-codex-parity.test.ts.

import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  normalizeContent,
  scanTrackRoots,
  classifyFiles,
  validateAllowlist,
  validateExclusive,
  validateBaseline,
  parseKnownLimitationsHooks,
  checkKnownLimitations,
  checkBaseline,
  reconcileScanWithManifest,
  sha256,
  CLASS_DERIVED,
  CLASS_ALLOWLISTED,
  CLASS_EXCLUSIVE,
} from '../../scripts/lib/codex-parity-lib.mjs'
import { DATA_DIR } from './codex-parity-fixture.js'
import { readFileSync } from 'node:fs'

interface Finding {
  kind: string
  file: string
  message: string
}

// ─── normalizeContent (hardening 5: scoped, preservation, near-miss) ─────────

describe('normalizeContent', () => {
  const cases: { name: string; text: string; opts?: object; expected: string }[] = [
    {
      name: 'normalizes named front-matter fields only',
      text: '---\nagent: red-team\ntitle: keep me\n---\nbody agent: red-team\n',
      expected: '---\nagent: <normalized>\ntitle: keep me\n---\nbody agent: red-team\n',
    },
    {
      name: 'replaces exact interpolation values throughout the body',
      text: '# my-project\n\nWelcome to my-project docs.\n',
      opts: { interpolations: ['my-project'] },
      expected: '# <normalized>\n\nWelcome to <normalized> docs.\n',
    },
    {
      name: 'leaves text without front-matter untouched',
      text: 'plain markdown\nagent: not-front-matter\n',
      expected: 'plain markdown\nagent: not-front-matter\n',
    },
    {
      name: 'near-miss prose mentioning an agent name stays untouched',
      text: 'The red-team agent reviews plans.\n',
      expected: 'The red-team agent reviews plans.\n',
    },
  ]
  for (const c of cases) {
    it(c.name, () => {
      expect(normalizeContent(c.text, c.opts ?? {})).toBe(c.expected)
    })
  }

  it('preserves semantic whitespace: an indentation diff MUST stay visible (red)', () => {
    const a = normalizeContent('- item\n  - nested\n')
    const b = normalizeContent('- item\n- nested\n')
    expect(a).not.toBe(b)
  })

  it('preserves code fences and YAML structure', () => {
    const text = '```yaml\nkey:  spaced\n```\n'
    expect(normalizeContent(text)).toBe(text)
  })
})

// ─── scanTrackRoots (hardening 16: lstat semantics, exclusions) ──────────────

describe('scanTrackRoots', () => {
  it('records symlinks as entries without following them, applies exclusions, sorts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'parity-scan-unit-'))
    try {
      mkdirSync(join(dir, '.agents', 'rules'), { recursive: true })
      mkdirSync(join(dir, '.claude'), { recursive: true })
      mkdirSync(join(dir, 'outside'), { recursive: true })
      writeFileSync(join(dir, 'outside', 'target.md'), 'outside content\n')
      writeFileSync(join(dir, '.agents', 'rules', 'b.md'), 'b\n')
      writeFileSync(join(dir, '.agents', 'rules', 'a.md'), 'a\n')
      writeFileSync(join(dir, '.claude', 'noise.log'), 'noise\n')
      symlinkSync(join(dir, 'outside'), join(dir, '.agents', 'link-to-dir'))

      const scan = scanTrackRoots(dir, ['.claude/*.log'])
      expect(scan.codex).toEqual([
        '.agents/link-to-dir', // the symlink itself, target NOT walked
        '.agents/rules/a.md',
        '.agents/rules/b.md',
      ])
      expect(scan.claude).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ─── classifyFiles ───────────────────────────────────────────────────────────

describe('classifyFiles', () => {
  const scanOf = (claude: string[], codex: string[]) => ({ claude, codex })

  it('assigns each class and flags unclassified files (the #1966 bug-class)', () => {
    const scan = scanOf(
      ['.claude/rules/90-exec-protocol.md', '.claude/CLAUDE.md', '.claude/mystery.bin'],
      ['.agents/rules/90-exec-protocol.md'],
    )
    const ctx = {
      allowlist: { $schemaVersion: 1, entries: [] },
      exclusive: {
        $schemaVersion: 1,
        declarations: [
          {
            id: 'claude-md',
            track: 'claude',
            pattern: '.claude/CLAUDE.md',
            reason: 'x'.repeat(12),
          },
        ],
        knownLimitationsInfra: [],
        scanExclusions: [],
      },
    }
    const { classes, findings } = classifyFiles(scan, ctx)
    expect(classes.get('.claude/rules/90-exec-protocol.md')).toBe(CLASS_DERIVED)
    expect(classes.get('.agents/rules/90-exec-protocol.md')).toBe(CLASS_DERIVED)
    expect(classes.get('.claude/CLAUDE.md')).toBe(CLASS_EXCLUSIVE)
    const unclassified = (findings as Finding[]).filter((f) => f.kind === 'unclassified')
    expect(unclassified).toHaveLength(1)
    expect(unclassified[0].file).toBe('.claude/mystery.bin')
  })

  it('multi-class is an error, never a precedence decision (hardening 4)', () => {
    const scan = scanOf([], ['.agents/rules/90-exec-protocol.md'])
    const ctx = {
      allowlist: { $schemaVersion: 1, entries: [] },
      exclusive: {
        $schemaVersion: 1,
        declarations: [
          // wrongly-exclusive shared rule: pattern swallows a DERIVED file
          { id: 'bad', track: 'codex', pattern: '.agents/rules/**', reason: 'x'.repeat(12) },
        ],
        knownLimitationsInfra: [],
        scanExclusions: [],
      },
    }
    const { findings } = classifyFiles(scan, ctx)
    const multi = (findings as Finding[]).filter((f) => f.kind === 'multi-class')
    expect(multi).toHaveLength(1)
    expect(multi[0].file).toBe('.agents/rules/90-exec-protocol.md')
    expect(multi[0].message).toContain('DERIVED')
    expect(multi[0].message).toContain('BY-DESIGN-EXCLUSIVE')
  })

  it('classifies allowlisted paths and flags stale exclusive declarations', () => {
    const scan = scanOf(['.claude/special.md'], ['.agents/special.md'])
    const ctx = {
      allowlist: {
        $schemaVersion: 1,
        entries: [
          {
            codexPath: '.agents/special.md',
            claudePath: '.claude/special.md',
            reason: 'intentional platform divergence',
            codexHash: 'a'.repeat(64),
            claudeHash: 'b'.repeat(64),
          },
        ],
      },
      exclusive: {
        $schemaVersion: 1,
        declarations: [
          { id: 'ghost', track: 'claude', pattern: '.claude/ghost/**', reason: 'x'.repeat(12) },
        ],
        knownLimitationsInfra: [],
        scanExclusions: [],
      },
    }
    const { classes, findings } = classifyFiles(scan, ctx)
    expect(classes.get('.agents/special.md')).toBe(CLASS_ALLOWLISTED)
    expect(classes.get('.claude/special.md')).toBe(CLASS_ALLOWLISTED)
    const stale = (findings as Finding[]).filter((f) => f.kind === 'stale-exclusive')
    expect(stale).toHaveLength(1)
    expect(stale[0].message).toContain('ghost')
  })
})

// ─── schema validators (data files under scripts/data/) ─────────────────────

describe('schema validators', () => {
  it('accept the committed data files', () => {
    const read = (name: string) => JSON.parse(readFileSync(join(DATA_DIR, name), 'utf-8'))
    expect(validateAllowlist(read('codex-parity-allowlist.json'))).toEqual([])
    expect(validateExclusive(read('codex-parity-exclusive.json'))).toEqual([])
    expect(validateBaseline(read('codex-parity-baseline.json'))).toEqual([])
  })

  it('reject allowlist entries without reason or with malformed hashes', () => {
    const errors = validateAllowlist({
      $schemaVersion: 1,
      entries: [
        { codexPath: 'x', claudePath: 'y', reason: 'short', codexHash: 'zz', claudeHash: '' },
      ],
    })
    expect(errors.join('\n')).toContain('reason')
    expect(errors.join('\n')).toContain('codexHash')
    expect(errors.join('\n')).toContain('claudeHash')
  })

  it('reject exclusive files without declarations array, bad track, or missing exclusion lists', () => {
    expect(validateExclusive({ $schemaVersion: 1 }).join('\n')).toContain('declarations')
    const errors = validateExclusive({
      $schemaVersion: 1,
      declarations: [{ id: 'a', track: 'gemini', pattern: 'x', reason: 'y'.repeat(12) }],
      knownLimitationsInfra: 'not-an-array',
      scanExclusions: [],
    })
    expect(errors.join('\n')).toContain('track')
    expect(errors.join('\n')).toContain('knownLimitationsInfra')
  })

  it('reject baseline removals without file/reason/issue (hardening 14)', () => {
    const errors = validateBaseline({
      $schemaVersion: 1,
      tracks: { claude: { files: [] }, codex: { files: [] } },
      removals: [{ file: '', reason: 'short', issue: '' }],
    })
    expect(errors.join('\n')).toContain('file required')
    expect(errors.join('\n')).toContain('reason')
    expect(errors.join('\n')).toContain('issue')
  })

  it('reject wrong $schemaVersion on all three files', () => {
    expect(validateAllowlist({ $schemaVersion: 2, entries: [] })).not.toEqual([])
    expect(
      validateExclusive({
        $schemaVersion: 0,
        declarations: [],
        knownLimitationsInfra: [],
        scanExclusions: [],
      }),
    ).not.toEqual([])
    expect(
      validateBaseline({
        $schemaVersion: 'x',
        tracks: { claude: { files: [] }, codex: { files: [] } },
        removals: [],
      }),
    ).not.toEqual([])
  })
})

// ─── known-limitations parsing + comparison (hardening 8) ────────────────────

const CODEX_MD_SAMPLE = `# Fixture

## Known Limitations — Codex Governance Parity

| Claude Code Hook | What it enforces | Codex equivalent |
|-----------------|-----------------|------------------|
| \`stop-dangerous.mjs\` | Blocks dangerous commands | bridged |
| \`pre-compact.mjs\` | Snapshots state | None |

## Next Section

| \`not-a-hook.mjs\` | outside the section | ignored |
`

describe('known limitations table', () => {
  it('parses only rows inside the Known Limitations section', () => {
    expect(parseKnownLimitationsHooks(CODEX_MD_SAMPLE)).toEqual([
      'stop-dangerous.mjs',
      'pre-compact.mjs',
    ])
  })

  it('returns null (→ mandatory-section finding) when the section is absent', () => {
    expect(parseKnownLimitationsHooks('# No table here\n')).toBeNull()
    const findings = checkKnownLimitations('# No table here\n', ['a.mjs'], []) as Finding[]
    expect(findings).toHaveLength(1)
    expect(findings[0].kind).toBe('known-limitations-missing')
  })

  it('flags emitted hooks without a row (missing) and rows without a hook (stale)', () => {
    const findings = checkKnownLimitations(
      CODEX_MD_SAMPLE,
      ['stop-dangerous.mjs', 'guard-task-completion.mjs', 'hooks.mjs'],
      ['hooks.mjs'],
    ) as Finding[]
    const kinds = findings.map((f) => `${f.kind}:${f.message.match(/"([^"]+)"/)?.[1]}`)
    expect(kinds).toContain('known-limitations-missing:guard-task-completion.mjs')
    expect(kinds).toContain('known-limitations-stale:pre-compact.mjs')
    // infra hook needs no row and produces no finding
    expect(kinds.some((k) => k.includes('hooks.mjs'))).toBe(false)
  })
})

// ─── baseline: identity + anti-shrinkage + nonzero (hardening 3/14) ─────────

describe('checkBaseline', () => {
  const baseline = (claude: string[], codex: string[], removals: object[] = []) => ({
    $schemaVersion: 1,
    tracks: { claude: { files: claude }, codex: { files: codex } },
    removals,
  })

  it('empty tracks are a failure, not a vacuous pass', () => {
    const findings = checkBaseline(
      { claude: [], codex: [] },
      baseline([], []),
      'BOOTSTRAP',
    ) as Finding[]
    expect(findings.filter((f) => f.kind === 'empty-track')).toHaveLength(2)
  })

  it('identity drift vs the committed baseline is red (update requires an explicit commit)', () => {
    const findings = checkBaseline(
      { claude: ['.claude/a.md', '.claude/new.md'], codex: ['.agents/x.md'] },
      baseline(['.claude/a.md'], ['.agents/x.md']),
      'BOOTSTRAP',
    ) as Finding[]
    const drift = findings.filter((f) => f.kind === 'baseline-drift')
    expect(drift).toHaveLength(1)
    expect(drift[0].message).toContain('.claude/new.md')
  })

  it('shrinkage vs the MERGE-BASE baseline without a removal record is red — even when the committed baseline was edited in the same change (hardening 14)', () => {
    const current = { claude: ['.claude/a.md'], codex: ['.agents/x.md'] }
    // committed baseline already "self-consistently" dropped the file
    const committed = baseline(['.claude/a.md'], ['.agents/x.md'])
    const atMergeBase = baseline(['.claude/a.md', '.claude/vanished.md'], ['.agents/x.md'])
    const findings = checkBaseline(current, committed, atMergeBase) as Finding[]
    const removed = findings.filter((f) => f.kind === 'baseline-removed')
    expect(removed).toHaveLength(1)
    expect(removed[0].file).toBe('.claude/vanished.md')
  })

  it('shrinkage WITH a reviewed removal record passes', () => {
    const current = { claude: ['.claude/a.md'], codex: ['.agents/x.md'] }
    const committed = baseline(
      ['.claude/a.md'],
      ['.agents/x.md'],
      [{ file: '.claude/vanished.md', reason: 'superseded by consolidated rule', issue: '#1966' }],
    )
    const atMergeBase = baseline(['.claude/a.md', '.claude/vanished.md'], ['.agents/x.md'])
    const findings = checkBaseline(current, committed, atMergeBase) as Finding[]
    expect(findings.filter((f) => f.kind === 'baseline-removed')).toHaveLength(0)
  })
})

// ─── manifest reconciliation (hardening 2) ───────────────────────────────────

describe('reconcileScanWithManifest', () => {
  it('missing registry mapping: scanned file absent from the manifest is red', () => {
    const findings = reconcileScanWithManifest(
      { claude: ['.claude/rogue.md'], codex: [] },
      [],
      [],
    ) as Finding[]
    expect(findings).toHaveLength(1)
    expect(findings[0].kind).toBe('manifest-extra')
  })

  it('missing emitted file: manifest entry the scan cannot find is red', () => {
    const findings = reconcileScanWithManifest(
      { claude: [], codex: [] },
      ['.agents/CODEX.md', 'docs/outside-roots.md'],
      [],
    ) as Finding[]
    expect(findings).toHaveLength(1)
    expect(findings[0].kind).toBe('manifest-missing')
    expect(findings[0].file).toBe('.agents/CODEX.md')
  })

  it('sha256 helper produces stable 64-hex digests', () => {
    expect(sha256('abc')).toMatch(/^[0-9a-f]{64}$/)
    expect(sha256('abc')).toBe(sha256('abc'))
  })
})
