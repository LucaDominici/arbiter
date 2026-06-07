import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-claude-md-lint.mjs')

function run(dir: string, args: string[] = []): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', cwd: dir })
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function makeDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'claude-md-lint-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** A canonical shared layer (root AGENTS.md) with no @import, no abs paths. */
const SHARED_LAYER = `# Project Governance

## Invariants

- INV-01: do the right thing
- INV-02: never bypass the gate
- INV-03: tests before code
- INV-04: no any types
`

describe('check-claude-md-lint (#1266)', () => {
  it('--help exits 0 and prints usage', () => {
    const { dir, cleanup } = makeDir()
    try {
      const r = run(dir, ['--help'])
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('Usage')
    } finally {
      cleanup()
    }
  })

  it('SKIPs (exit 0) when no context files exist', () => {
    const { dir, cleanup } = makeDir()
    try {
      const r = run(dir)
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/SKIP/)
    } finally {
      cleanup()
    }
  })

  it('passes (exit 0) a clean delegating .claude/CLAUDE.md that @imports the shared layer', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'AGENTS.md'), SHARED_LAYER)
      mkdirSync(join(dir, '.claude'), { recursive: true })
      writeFileSync(
        join(dir, '.claude', 'CLAUDE.md'),
        `# Project — Claude Config\n\n@AGENTS.md\n\nClaude-specific notes only.\n`,
      )
      const r = run(dir)
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exempts the root canonical layer from the required-@import rule', () => {
    const { dir, cleanup } = makeDir()
    try {
      // Root AGENTS.md is the canonical layer — it has nothing to import.
      writeFileSync(join(dir, 'AGENTS.md'), SHARED_LAYER)
      const r = run(dir)
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('FAILS (exit 1) on a hardcoded absolute path', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(
        join(dir, 'AGENTS.md'),
        `${SHARED_LAYER}\nRun the tool at /home/alice/project/run.sh\n`,
      )
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stdout + r.stderr).toMatch(/hardcoded|absolute path/i)
    } finally {
      cleanup()
    }
  })

  it('FAILS (exit 1) on a Windows drive-letter absolute path', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'AGENTS.md'), `${SHARED_LAYER}\nSee C:\\\\Users\\\\bob\\\\notes.\n`)
      const r = run(dir)
      expect(r.status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('does NOT false-positive on relative paths, URLs, or command refs', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(
        join(dir, 'AGENTS.md'),
        `${SHARED_LAYER}\nSee ../AGENTS.md and https://example.com/home/x.\nRun \`node scripts/check-all.mjs\`.\n`,
      )
      const r = run(dir)
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('FAILS (exit 1) when a delegating CLAUDE.md does not @import a shared layer', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'AGENTS.md'), SHARED_LAYER)
      mkdirSync(join(dir, '.claude'), { recursive: true })
      writeFileSync(
        join(dir, '.claude', 'CLAUDE.md'),
        `# Project — Claude Config\n\nNo import here, just prose.\n`,
      )
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stdout + r.stderr).toMatch(/import/i)
    } finally {
      cleanup()
    }
  })

  it('FAILS (exit 1) when a delegating file copies a verbatim block from the shared layer', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'AGENTS.md'), SHARED_LAYER)
      mkdirSync(join(dir, '.claude'), { recursive: true })
      // Imports the layer AND copies its invariants verbatim (>=12 non-trivial lines).
      const dupBlock = Array.from(
        { length: 14 },
        (_, i) => `- RULE-${i}: shared rule number ${i} here`,
      ).join('\n')
      writeFileSync(
        join(dir, '.claude', 'CLAUDE.md'),
        `# Project — Claude Config\n\n@AGENTS.md\n\n${dupBlock}\n`,
      )
      writeFileSync(join(dir, 'AGENTS.md'), `${SHARED_LAYER}\n\n## Shared Rules\n\n${dupBlock}\n`)
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stdout + r.stderr).toMatch(/duplicat/i)
    } finally {
      cleanup()
    }
  })

  it('warns (exit 0) on line-budget overflow without failing the gate', () => {
    const { dir, cleanup } = makeDir()
    try {
      const big = `${SHARED_LAYER}\n${Array.from({ length: 700 }, (_, i) => `line ${i}`).join('\n')}\n`
      writeFileSync(join(dir, 'AGENTS.md'), big)
      const r = run(dir)
      expect(r.status).toBe(0)
      expect(r.stdout + r.stderr).toMatch(/budget|line/i)
    } finally {
      cleanup()
    }
  })
})
