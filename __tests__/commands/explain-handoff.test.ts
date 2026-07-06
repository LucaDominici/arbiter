// SPDX-License-Identifier: Apache-2.0
// #1817 (A7): `arbiter explain --handoff <topic>` scaffolds an executable-handoff
// doc from src/templates/HANDOFF.template.md — the cheapest durable cross-session/
// cross-model memory (see HANDOFF-VIAFERA-PATTERNS-2026-07.md, pattern A7).
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { runExplain } from '../../src/commands/explain.js'

describe('runExplain --handoff (A7 scaffold)', () => {
  const dirs: string[] = []
  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-handoff-'))
    dirs.push(dir)
    return dir
  }

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('scaffolds a HANDOFF-<TOPIC>.md file from the template into --out', () => {
    const out = tempDir()
    const result = runExplain('', { handoff: 'Gold Rebaseline', out })

    expect(result.exitCode).toBe(0)
    const path = join(out, 'HANDOFF-GOLD-REBASELINE.md')
    expect(existsSync(path)).toBe(true)
    expect(result.output).toContain(path)

    const content = readFileSync(path, 'utf-8')
    expect(content).toContain('# Handoff: Gold Rebaseline')
    expect(content).toMatch(/\*\*Date:\*\* \d{4}-\d{2}-\d{2}/)
    expect(content).toContain('Tasks (execute in strict order')
    expect(content).toContain('Suggested tier:')
    expect(content).toContain('Model-pyramid note')
  })

  it('sanitizes topic into an uppercase, hyphenated filename slug', () => {
    const out = tempDir()
    runExplain('', { handoff: 'weird / topic!! name', out })
    expect(existsSync(join(out, 'HANDOFF-WEIRD-TOPIC-NAME.md'))).toBe(true)
  })

  it('does not overwrite an existing handoff file on re-run', () => {
    const out = tempDir()
    runExplain('', { handoff: 'dup', out })
    const path = join(out, 'HANDOFF-DUP.md')
    const before = readFileSync(path, 'utf-8')

    const second = runExplain('', { handoff: 'dup', out })

    expect(second.exitCode).toBe(0)
    expect(readFileSync(path, 'utf-8')).toBe(before)
    expect(second.output).toContain('already exists')
  })

  it('rejects an empty --handoff topic', () => {
    const out = tempDir()
    const result = runExplain('', { handoff: '', out })
    expect(result.exitCode).toBe(1)
    expect(result.error).toContain('--handoff')
  })

  it('defaults --out to the current working directory when omitted', () => {
    const out = tempDir()
    const cwd = process.cwd()
    try {
      process.chdir(out)
      const result = runExplain('', { handoff: 'cwd-default' })
      expect(result.exitCode).toBe(0)
      expect(existsSync(join(out, 'HANDOFF-CWD-DEFAULT.md'))).toBe(true)
    } finally {
      process.chdir(cwd)
    }
  })
})
