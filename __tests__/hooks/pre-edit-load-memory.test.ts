// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const REPO_ROOT = resolve(process.cwd())
const HOOK = join(REPO_ROOT, '.claude/hooks/pre-edit-load-memory.mjs')

// Use an existing file that won't trigger CANON-16 or read-only guard
const EXISTING_TS_FILE = join(REPO_ROOT, 'src/cli.ts')

let tmpDir: string

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'pre-edit-load-memory-test-'))
})

afterAll(() => {
  if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

function runHook(opts: { editPath: string; memoryContent?: string; memoryGlobs?: string[] }) {
  const repoRoot = join(tmpDir, 'repo')
  const claudeDir = join(repoRoot, '.claude')
  mkdirSync(claudeDir, { recursive: true })

  // Write memory-impl.md
  const globs = opts.memoryGlobs ?? ['src/**/*.ts', 'src/**/*.tsx']
  const memoryBody =
    opts.memoryContent ?? '# Arbiter gotchas\n- No any types\n- No direct child_process in src/'
  const memoryFile = `---
globs:
${globs.map((g) => `  - "${g}"`).join('\n')}
last-reviewed: "${new Date().toISOString().slice(0, 10)}"
---

${memoryBody}`
  writeFileSync(join(claudeDir, 'memory-impl.md'), memoryFile)

  const result = spawnSync('node', [HOOK], {
    encoding: 'utf-8',
    cwd: repoRoot,
    env: {
      ...process.env,
      CLAUDE_TOOL_INPUT_PATH: opts.editPath,
      NO_COLOR: '1',
    },
  })

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

describe('pre-edit-load-memory — glob match fires memory', () => {
  it('editing src/generators/x.ts (matches src/**/*.ts) prints memory body', () => {
    const r = runHook({ editPath: join(REPO_ROOT, 'src/generators/x.ts') })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('Arbiter gotchas')
  })

  it('editing src/commands/worktree.ts prints memory body', () => {
    const r = runHook({ editPath: EXISTING_TS_FILE })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('Arbiter gotchas')
  })
})

describe('pre-edit-load-memory — glob miss → no output', () => {
  it('editing docs/x.md (no glob match) exits 0 with no stdout', () => {
    const r = runHook({ editPath: join(REPO_ROOT, 'docs/README.md') })
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('')
  })

  it('editing package.json (not in globs) exits 0 silently', () => {
    const r = runHook({ editPath: join(REPO_ROOT, 'package.json') })
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('')
  })
})

describe('pre-edit-load-memory — missing or malformed memory file', () => {
  it('missing memory-impl.md exits 0 silently', () => {
    // Run hook with an empty repo dir (no memory-impl.md)
    const repoRoot = join(tmpDir, 'empty-repo')
    mkdirSync(join(repoRoot, '.claude'), { recursive: true })
    const result = spawnSync('node', [HOOK], {
      encoding: 'utf-8',
      cwd: repoRoot,
      env: {
        ...process.env,
        CLAUDE_TOOL_INPUT_PATH: join(REPO_ROOT, 'src/cli.ts'),
        NO_COLOR: '1',
      },
    })
    expect(result.status ?? 1).toBe(0)
    expect(result.stdout.trim()).toBe('')
  })

  it('malformed YAML frontmatter exits 0 with warning on stderr', () => {
    const repoRoot = join(tmpDir, 'bad-yaml-repo')
    const claudeDir = join(repoRoot, '.claude')
    mkdirSync(claudeDir, { recursive: true })
    writeFileSync(join(claudeDir, 'memory-impl.md'), `---\nglobs: [unclosed\n---\n# body\n`)
    const result = spawnSync('node', [HOOK], {
      encoding: 'utf-8',
      cwd: repoRoot,
      env: {
        ...process.env,
        CLAUDE_TOOL_INPUT_PATH: join(REPO_ROOT, 'src/cli.ts'),
        NO_COLOR: '1',
      },
    })
    expect(result.status ?? 1).toBe(0)
    // Must not crash, must emit a warning
    expect(result.stderr + result.stdout).toMatch(/warn|skip|parse/i)
  })
})

describe('pre-edit-load-memory — 4KB body cap', () => {
  it('body > 4096 bytes is truncated with marker', () => {
    const longBody = 'x'.repeat(5000)
    const r = runHook({
      editPath: EXISTING_TS_FILE,
      memoryContent: longBody,
    })
    expect(r.status).toBe(0)
    // Must emit truncation marker when body exceeds 4KB
    expect(r.stdout.length).toBeLessThan(5000)
    expect(r.stdout).toMatch(/truncated/i)
  })

  it('body <= 4096 bytes is not truncated', () => {
    const shortBody = '# Gotchas\n- Rule 1\n'
    const r = runHook({
      editPath: EXISTING_TS_FILE,
      memoryContent: shortBody,
    })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('Rule 1')
    expect(r.stdout).not.toMatch(/truncated/i)
  })
})

describe('pre-edit-load-memory — no file path → exits 0 silently', () => {
  it('CLAUDE_TOOL_INPUT_PATH unset exits 0 with no output', () => {
    const repoRoot = join(tmpDir, 'no-path-repo')
    mkdirSync(join(repoRoot, '.claude'), { recursive: true })
    writeFileSync(
      join(repoRoot, '.claude', 'memory-impl.md'),
      `---\nglobs:\n  - "src/**/*.ts"\nlast-reviewed: "2026-05-17"\n---\n# body\n`,
    )
    const result = spawnSync('node', [HOOK], {
      encoding: 'utf-8',
      cwd: repoRoot,
      env: { ...process.env, NO_COLOR: '1' },
    })
    expect(result.status ?? 1).toBe(0)
    expect(result.stdout.trim()).toBe('')
  })
})
