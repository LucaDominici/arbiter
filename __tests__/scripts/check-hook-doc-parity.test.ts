// SPDX-License-Identifier: Apache-2.0
// CANON-10 (docs/internal/SYSTEM/CANON.md): every hook in .claude/settings.json
// must be documented in the .claude/CLAUDE.md hooks table, and vice versa.
// Enforcement was previously prose-only ("checked at PR review") — this test
// suite proves the wired gate actually catches the drift that review misses.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
  parseSettingsHooks,
  parseClaudeMdTable,
  diffHookParity,
} from '../../scripts/check-hook-doc-parity.mjs'

const SCRIPT = resolve('scripts/check-hook-doc-parity.mjs')

// ─── parseSettingsHooks ───────────────────────────────────────────────────────

describe('parseSettingsHooks', () => {
  it('extracts event, matcher and filename from a settings.json hooks object', () => {
    const settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'node .claude/hooks/stop-dangerous.mjs' }],
          },
        ],
      },
    }
    expect(parseSettingsHooks(settings)).toEqual([
      { event: 'PreToolUse', matcher: 'Bash', filename: 'stop-dangerous.mjs' },
    ])
  })

  it('defaults matcher to * when the group omits it (e.g. PreCompact)', () => {
    const settings = {
      hooks: {
        PreCompact: [
          { hooks: [{ type: 'command', command: 'node .claude/hooks/pre-compact.mjs' }] },
        ],
      },
    }
    expect(parseSettingsHooks(settings)).toEqual([
      { event: 'PreCompact', matcher: '*', filename: 'pre-compact.mjs' },
    ])
  })

  it('extracts multiple hooks from the same group', () => {
    const settings = {
      hooks: {
        PostToolUse: [
          {
            matcher: 'Edit|Write',
            hooks: [
              { type: 'command', command: 'node .claude/hooks/check-no-any.mjs' },
              { type: 'command', command: 'node .claude/hooks/check-circular-deps.mjs' },
            ],
          },
        ],
      },
    }
    expect(parseSettingsHooks(settings)).toEqual([
      { event: 'PostToolUse', matcher: 'Edit|Write', filename: 'check-no-any.mjs' },
      { event: 'PostToolUse', matcher: 'Edit|Write', filename: 'check-circular-deps.mjs' },
    ])
  })

  it('returns an empty array when hooks is absent', () => {
    expect(parseSettingsHooks({})).toEqual([])
  })
})

// ─── parseClaudeMdTable ───────────────────────────────────────────────────────

describe('parseClaudeMdTable', () => {
  it('parses a simple row with an unescaped matcher', () => {
    const md = '| `PreToolUse` → Bash | `stop-dangerous.mjs` | Block dangerous commands |\n'
    expect(parseClaudeMdTable(md)).toEqual([
      { event: 'PreToolUse', matcher: 'Bash', filename: 'stop-dangerous.mjs' },
    ])
  })

  it('unescapes a markdown-escaped pipe in the matcher cell (Edit\\|Write)', () => {
    const md = '| `PostToolUse` → Edit\\|Write | `check-no-any.mjs` | Block any types |\n'
    expect(parseClaudeMdTable(md)).toEqual([
      { event: 'PostToolUse', matcher: 'Edit|Write', filename: 'check-no-any.mjs' },
    ])
  })

  it('unescapes a markdown-escaped wildcard matcher (\\*)', () => {
    const md = '| `Stop` → \\* | `stop-evidence-guard.mjs` | Block completion claims |\n'
    expect(parseClaudeMdTable(md)).toEqual([
      { event: 'Stop', matcher: '*', filename: 'stop-evidence-guard.mjs' },
    ])
  })

  it('ignores the header and separator rows (no backtick-wrapped event)', () => {
    const md = '| Event | Hook | Purpose |\n| --- | --- | --- |\n'
    expect(parseClaudeMdTable(md)).toEqual([])
  })

  it('returns an empty array for markdown with no hooks table', () => {
    expect(parseClaudeMdTable('# Just a heading\n\nSome prose.\n')).toEqual([])
  })
})

// ─── diffHookParity (drift detection) ─────────────────────────────────────────

describe('diffHookParity', () => {
  it('returns empty diffs when settings and doc match exactly', () => {
    const hooks = [{ event: 'PreToolUse', matcher: 'Bash', filename: 'stop-dangerous.mjs' }]
    expect(diffHookParity(hooks, hooks)).toEqual({ missingFromDoc: [], staleInDoc: [] })
  })

  it('DETECTS a hook added to settings.json but never documented (CANON-10 violation)', () => {
    const settingsHooks = [
      { event: 'PreToolUse', matcher: 'Bash', filename: 'stop-dangerous.mjs' },
      { event: 'PostToolUse', matcher: 'Edit|Write', filename: 'new-undocumented-hook.mjs' },
    ]
    const docRows = [{ event: 'PreToolUse', matcher: 'Bash', filename: 'stop-dangerous.mjs' }]
    const { missingFromDoc, staleInDoc } = diffHookParity(settingsHooks, docRows)
    expect(missingFromDoc).toEqual([
      { event: 'PostToolUse', matcher: 'Edit|Write', filename: 'new-undocumented-hook.mjs' },
    ])
    expect(staleInDoc).toEqual([])
  })

  it('DETECTS a stale doc row left behind after a hook was removed from settings.json', () => {
    const settingsHooks = [{ event: 'PreToolUse', matcher: 'Bash', filename: 'stop-dangerous.mjs' }]
    const docRows = [
      { event: 'PreToolUse', matcher: 'Bash', filename: 'stop-dangerous.mjs' },
      { event: 'PreToolUse', matcher: 'Bash', filename: 'removed-hook.mjs' },
    ]
    const { missingFromDoc, staleInDoc } = diffHookParity(settingsHooks, docRows)
    expect(missingFromDoc).toEqual([])
    expect(staleInDoc).toEqual([
      { event: 'PreToolUse', matcher: 'Bash', filename: 'removed-hook.mjs' },
    ])
  })

  it('treats the same filename under a different event/matcher as distinct (no cross-matching)', () => {
    const settingsHooks = [{ event: 'PreToolUse', matcher: 'Bash', filename: 'shared.mjs' }]
    const docRows = [{ event: 'PostToolUse', matcher: 'Bash', filename: 'shared.mjs' }]
    const { missingFromDoc, staleInDoc } = diffHookParity(settingsHooks, docRows)
    expect(missingFromDoc).toHaveLength(1)
    expect(staleInDoc).toHaveLength(1)
  })
})

// ─── end-to-end: real repo must be in parity ──────────────────────────────────

describe('check-hook-doc-parity.mjs — real repo (CANON-10)', () => {
  it("exits 0 against arbiter's own .claude/settings.json + .claude/CLAUDE.md", () => {
    const r = spawnSync('node', [SCRIPT], { encoding: 'utf-8', cwd: resolve('.') })
    expect(r.stdout + r.stderr).not.toContain('MISSING')
    expect(r.status).toBe(0)
  })
})

// ─── end-to-end: synthetic drift must fail the gate (non-vacuity proof) ──────

describe('check-hook-doc-parity.mjs — synthetic drift fails closed', () => {
  it('exits 1 when settings.json has a hook the doc table never mentions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hook-doc-parity-'))
    try {
      const settingsPath = join(dir, 'settings.json')
      const docPath = join(dir, 'CLAUDE.md')
      writeFileSync(
        settingsPath,
        JSON.stringify({
          hooks: {
            PreToolUse: [
              {
                matcher: 'Bash',
                hooks: [{ type: 'command', command: 'node .claude/hooks/stop-dangerous.mjs' }],
              },
            ],
            Stop: [
              {
                matcher: '*',
                hooks: [{ type: 'command', command: 'node .claude/hooks/undocumented-drift.mjs' }],
              },
            ],
          },
        }),
      )
      writeFileSync(
        docPath,
        '| Event | Hook | Purpose |\n| --- | --- | --- |\n' +
          '| `PreToolUse` → Bash | `stop-dangerous.mjs` | Block dangerous commands |\n',
      )
      const r = spawnSync('node', [SCRIPT, `--settings=${settingsPath}`, `--doc=${docPath}`], {
        encoding: 'utf-8',
      })
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('undocumented-drift.mjs')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
