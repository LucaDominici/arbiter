import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const SCRIPT = resolve('scripts/check-hook-routing.mjs')
const OWNED = '#!/usr/bin/env node\n// Arbiter hook: test fixture\n'

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-hook-routing-'))
  mkdirSync(join(dir, '.claude', 'hooks'), { recursive: true })
  return dir
}

function writeDispatcher(dir: string, body: string): void {
  writeFileSync(join(dir, '.claude', 'hooks', 'hooks.mjs'), `const HANDLERS = {\n${body}\n};\n`)
}

function writeSettings(dir: string, event = 'PreToolUse', matcher = 'Bash'): void {
  writeFileSync(
    join(dir, '.claude', 'settings.json'),
    JSON.stringify({
      hooks: {
        [event]: [
          {
            matcher,
            hooks: [
              {
                type: 'command',
                command: `node .claude/hooks/hooks.mjs ${event}:${matcher}`,
              },
            ],
          },
        ],
      },
    }),
  )
}

function run(dir: string) {
  return spawnSync('node', [SCRIPT], { cwd: dir, encoding: 'utf-8' })
}

describe('check-hook-routing target gate (AC-8)', () => {
  it('passes when every Arbiter-owned hook is dispatched through a wired event', () => {
    const dir = fixture()
    try {
      writeFileSync(join(dir, '.claude', 'hooks', 'owned.mjs'), OWNED)
      writeDispatcher(dir, "  'PreToolUse:Bash': ['owned.mjs'],")
      writeSettings(dir)
      expect(run(dir).status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails when an emitted Arbiter-owned hook is absent from HANDLERS', () => {
    const dir = fixture()
    try {
      writeFileSync(join(dir, '.claude', 'hooks', 'owned.mjs'), OWNED)
      writeDispatcher(dir, "  'PreToolUse:Bash': [],")
      writeSettings(dir)
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('DEAD')
      expect(result.stderr).toContain('owned.mjs')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails when a dispatcher event is not wired by settings.json', () => {
    const dir = fixture()
    try {
      writeFileSync(join(dir, '.claude', 'hooks', 'owned.mjs'), OWNED)
      writeDispatcher(dir, "  'PreToolUse:Bash': ['owned.mjs'],")
      writeSettings(dir, 'PostToolUse', 'Bash')
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('UNROUTED')
      expect(result.stderr).toContain('PreToolUse:Bash')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails when HANDLERS references a missing hook file', () => {
    const dir = fixture()
    try {
      writeDispatcher(dir, "  'PreToolUse:Bash': ['missing.mjs'],")
      writeSettings(dir)
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('MISSING')
      expect(result.stderr).toContain('missing.mjs')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('ignores unmarked user custom hooks that Arbiter does not own', () => {
    const dir = fixture()
    try {
      writeFileSync(join(dir, '.claude', 'hooks', 'custom.mjs'), '#!/usr/bin/env node\n')
      writeDispatcher(dir, "  'PreToolUse:Bash': [],")
      writeSettings(dir)
      expect(run(dir).status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 2 on malformed settings rather than silently passing', () => {
    const dir = fixture()
    try {
      writeDispatcher(dir, "  'PreToolUse:Bash': [],")
      writeFileSync(join(dir, '.claude', 'settings.json'), '{')
      expect(run(dir).status).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
