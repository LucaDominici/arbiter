// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, cpSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-tool-claims.mjs')

function run(cwd: string) {
  const r = spawnSync('node', [SCRIPT], { encoding: 'utf-8', cwd })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function makeRepo(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'tool-claims-test-'))
  spawnSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' })
  spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'ignore' })
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  cpSync(SCRIPT, join(dir, 'scripts/check-tool-claims.mjs'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function write(dir: string, rel: string, content: string) {
  const abs = join(dir, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content)
  spawnSync('git', ['add', rel], { cwd: dir, stdio: 'ignore' })
}

describe('check-tool-claims.mjs (positioning-truth: --accept-beta-tools tool-claim gate)', () => {
  it('passes against the real repo (no false tool-capability claims ship)', () => {
    const result = run(resolve('.'))
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('[check-tool-claims] OK')
  })

  it('FAILS when a doc claims --accept-beta-tools enables a non-core tool (cursor)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      write(
        dir,
        'website/index.md',
        'Cursor and Copilot are experimental, behind `--accept-beta-tools`.\n',
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('[check-tool-claims] FAIL')
      expect(result.stderr).toContain('cursor')
      expect(result.stderr).toContain('E_INVALID_TOOL')
    } finally {
      cleanup()
    }
  })

  it('FAILS for each non-core tool name coupled to the flag (gemini in comparisons)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      write(
        dir,
        'website/comparisons/index.md',
        'Gemini CLI generators exist but are experimental (behind `--accept-beta-tools`).\n',
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('gemini')
    } finally {
      cleanup()
    }
  })

  it('PASSES on a truthful "experimental, not selectable via --tools" framing', () => {
    const { dir, cleanup } = makeRepo()
    try {
      write(
        dir,
        'website/index.md',
        'Cursor, Copilot, Windsurf, Aider, and Gemini CLI have experimental generators but are not yet selectable via `--tools`.\n',
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('[check-tool-claims] OK')
    } finally {
      cleanup()
    }
  })

  it('PASSES on a legitimate beta-LANGUAGE line that mentions the flag (Rust/Python, no tool name)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      // The flag's REAL purpose: gate beta language features. Naming Rust/Python with
      // the flag is correct and must never trip the gate.
      write(
        dir,
        'docs/ADR/029.md',
        '| Rust | cargo-mutants | beta | requires `--accept-beta-tools` |\n' +
          '| Python | mutmut | beta | requires `--accept-beta-tools` |\n',
      )
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('PASSES when a counter-example is marked with the tool-claim-allow sentinel', () => {
    const { dir, cleanup } = makeRepo()
    try {
      write(
        dir,
        'docs/PITFALLS.md',
        '<!-- tool-claim-allow -->\nDo NOT believe docs that say `--accept-beta-tools` enables cursor — it does not.\n',
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('[check-tool-claims] OK')
    } finally {
      cleanup()
    }
  })

  it('FAILS on the false claim inside a src/templates markdown template (.md.ejs)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      write(
        dir,
        'src/templates/claude/skills/foo/SKILL.md.ejs',
        'Enable windsurf with `--accept-beta-tools`.\n',
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('windsurf')
      expect(result.stderr).toContain('src/templates/claude/skills/foo/SKILL.md.ejs')
    } finally {
      cleanup()
    }
  })
})
