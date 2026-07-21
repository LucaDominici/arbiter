// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for scripts/check-handoff-doc.mjs (E6a #1943, M1 handoff-lint).
 * Existing Code Survey (CANON-16): no handoff-lint exists; closest is check-doc-style.mjs
 * (prose style, not the task-section contract). New script justified.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const SCRIPT = new URL('../../scripts/check-handoff-doc.mjs', import.meta.url).pathname

function run(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', timeout: 10000 })
  return { exitCode: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function goodSection(n: number): string {
  return `### ${n}. Task title

- **What:** concrete paragraph.
- **Where:** src/foo.ts
- **AC:** observable criterion.
- **Verify:** \`npm test\`
- **Suggested tier:** cheap (execution)
`
}

describe('check-handoff-doc.mjs', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'handoff-lint-'))
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('vacuous pass when no handoff docs exist', () => {
    expect(run(['--root', tmpDir]).exitCode).toBe(0)
  })

  it('passes a fully-formed handoff', () => {
    const f = join(tmpDir, 'HANDOFF.md')
    writeFileSync(f, `# Handoff: thing\n\n${goodSection(1)}${goodSection(2)}`)
    expect(run(['--file', f]).exitCode).toBe(0)
  })

  it('fails when Suggested tier is missing', () => {
    const f = join(tmpDir, 'HANDOFF.md')
    writeFileSync(
      f,
      `### 1. Task\n\n- **What:** x.\n- **Where:** y.\n- **AC:** z.\n- **Verify:** \`npm test\`\n`,
    )
    const r = run(['--file', f])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toMatch(/Suggested tier/i)
  })

  it('fails when Suggested tier is a placeholder', () => {
    const f = join(tmpDir, 'HANDOFF.md')
    writeFileSync(
      f,
      `### 1. Task\n\n- **What:** x.\n- **Where:** y.\n- **AC:** z.\n- **Verify:** \`npm test\`\n- **Suggested tier:** …\n`,
    )
    expect(run(['--file', f]).exitCode).toBe(1)
  })

  it('fails when Verify has no backtick command', () => {
    const f = join(tmpDir, 'HANDOFF.md')
    writeFileSync(
      f,
      `### 1. Task\n\n- **What:** x.\n- **Where:** y.\n- **AC:** z.\n- **Verify:** run the tests\n- **Suggested tier:** cheap\n`,
    )
    const r = run(['--file', f])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toMatch(/backtick/i)
  })

  it('fails when a required row is missing (Where)', () => {
    const f = join(tmpDir, 'HANDOFF.md')
    writeFileSync(
      f,
      `### 1. Task\n\n- **What:** x.\n- **AC:** z.\n- **Verify:** \`npm test\`\n- **Suggested tier:** cheap\n`,
    )
    expect(run(['--file', f]).exitCode).toBe(1)
  })

  it('ignores docs with no numbered task sections', () => {
    const f = join(tmpDir, 'HANDOFF.md')
    writeFileSync(f, `# Handoff: thing\n\nProse with no tasks.\n`)
    expect(run(['--file', f]).exitCode).toBe(0)
  })

  it('collects **/HANDOFF*.md under root scan', () => {
    mkdirSync(join(tmpDir, 'sub'))
    writeFileSync(join(tmpDir, 'sub', 'HANDOFF-round2.md'), `# x\n\n${goodSection(1)}`)
    expect(run(['--root', tmpDir]).exitCode).toBe(0)
  })

  it('collects docs/Handoff: H1 docs under root scan', () => {
    mkdirSync(join(tmpDir, 'docs'), { recursive: true })
    writeFileSync(join(tmpDir, 'docs', 'plan.md'), `# Handoff: thing\n\n${goodSection(1)}`)
    expect(run(['--root', tmpDir]).exitCode).toBe(0)
  })

  it('exempts HANDOFF.template.md copies (e.g. greenfield-dist) — placeholders by design', () => {
    mkdirSync(join(tmpDir, 'templates'), { recursive: true })
    writeFileSync(
      join(tmpDir, 'templates', 'HANDOFF.template.md'),
      `### 1. Task\n\n- **What:** x.\n- **Where:** y.\n- **AC:** z.\n- **Verify:** \`npm test\`\n- **Suggested tier:** …\n`,
    )
    expect(run(['--root', tmpDir]).exitCode).toBe(0)
  })
})
