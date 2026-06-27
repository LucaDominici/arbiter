// SPDX-License-Identifier: Apache-2.0
// #1553 — the emitted check-no-pii PostToolUse hook must honor the escape hatch it advertises.
// Before the fix the hook imported only resolveToolInputPath and hard-blocked on the first
// PII-shaped match, yet printed "add an allowlist entry" advice it never read — leaving a
// developer permanently blocked. These render+execute tests stage the rendered hook ALONGSIDE the
// rendered lib so `import './lib.mjs'` resolves, then drive the real hook against staged files:
//  - still BLOCKS unsuppressed PII (anti-vacuous — the guard is not disarmed),
//  - PASSES when a valid inline `// arbiter-suppress(INV-12, …)` directive covers the line,
//  - SKIPS Markdown (.md added to SKIP_EXTENSIONS — a README sample no longer hard-blocks).
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function render(tpl: string): string {
  const data = makeConfig('/tmp/test', {
    projectName: 'pii-test',
    language: 'typescript',
    governanceLevel: 'L2',
  }) as unknown as Record<string, unknown>
  return renderTemplate(tpl, data)
}

/** Stage the rendered hook + its lib into an isolated .claude/hooks dir. */
function stageHookDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pii-hook-'))
  const hooks = join(dir, '.claude', 'hooks')
  mkdirSync(hooks, { recursive: true })
  writeFileSync(join(hooks, 'lib.mjs'), render('claude/hooks/lib.mjs.ejs'))
  writeFileSync(join(hooks, 'check-no-pii.mjs'), render('claude/hooks/check-no-pii.mjs.ejs'))
  return dir
}

/** Run the hook against `targetFile` (resolved via the Codex env path). */
function runHook(dir: string, targetFile: string): number {
  return (
    spawnSync('node', [join(dir, '.claude', 'hooks', 'check-no-pii.mjs')], {
      cwd: dir,
      input: '',
      encoding: 'utf-8',
      env: { ...process.env, CLAUDE_TOOL_INPUT_PATH: targetFile },
    }).status ?? 1
  )
}

describe('#1553 emitted check-no-pii hook honors the advertised escape hatch', () => {
  it('still BLOCKS an unsuppressed PII match (guard not disarmed)', () => {
    const dir = stageHookDir()
    try {
      const f = join(dir, 'leak.ts')
      writeFileSync(f, 'export const contact = "alice@example.com"\n')
      expect(runHook(dir, f)).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('PASSES when a valid inline arbiter-suppress(INV-12) directive covers the line', () => {
    const dir = stageHookDir()
    try {
      const f = join(dir, 'fixture.ts')
      writeFileSync(
        f,
        '// arbiter-suppress(INV-12, until=2999-01-01, reason="documented test fixture", owner=team)\n' +
          'export const sample = "alice@example.com"\n',
      )
      // RED before the fix: lib never exported findInlineSuppression and the hook never called
      // it, so the directive was ignored and the hook exited 1.
      expect(runHook(dir, f)).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does NOT pass for an EXPIRED suppression directive (still blocks)', () => {
    const dir = stageHookDir()
    try {
      const f = join(dir, 'expired.ts')
      writeFileSync(
        f,
        '// arbiter-suppress(INV-12, until=2000-01-01, reason="documented test fixture", owner=team)\n' +
          'export const sample = "alice@example.com"\n',
      )
      expect(runHook(dir, f)).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('SKIPS Markdown files (.md in SKIP_EXTENSIONS — a README sample no longer blocks)', () => {
    const dir = stageHookDir()
    try {
      const f = join(dir, 'README.md')
      writeFileSync(f, 'Contact the demo account at alice@example.com for details.\n')
      // RED before the fix: .md was not skipped, the email regex matched, the hook exited 1.
      expect(runHook(dir, f)).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('#1553 rendered lib exposes findInlineSuppression (dependency-free)', () => {
  const lib = render('claude/hooks/lib.mjs.ejs')

  it('exports findInlineSuppression', () => {
    expect(lib).toContain('export function findInlineSuppression')
  })

  it('does NOT import a shared suppressions helper (must run with no arbiter install)', () => {
    expect(lib).not.toContain('suppressions-shared')
    expect(lib).not.toContain("from '../")
  })

  it('renders without EJS tag leaks', () => {
    expect(lib).not.toContain('<%')
    expect(lib).not.toContain('%>')
  })
})
