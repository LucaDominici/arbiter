// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeAgentFileGenerator } from '../../src/generators/agent-file.js'
import { makeConfig } from '../helpers.js'

describe('makeAgentFileGenerator', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-agent-file-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns a generator that writes one file to a single-segment outPath', () => {
    const gen = makeAgentFileGenerator({
      outPath: ['.aider.conf.yml'],
      templatePath: 'aider/.aider.conf.yml.ejs',
    })
    const result = gen(makeConfig(dir))
    expect(result.files).toHaveLength(1)
    expect(result.files[0].path).toBe(join(dir, '.aider.conf.yml'))
    expect(result.files[0].action).toBe('created')
    expect(existsSync(join(dir, '.aider.conf.yml'))).toBe(true)
  })

  it('honors a multi-segment outPath (nested directories)', () => {
    const gen = makeAgentFileGenerator({
      outPath: ['.gemini', 'GEMINI.md'],
      templatePath: 'gemini/GEMINI.md.ejs',
    })
    const result = gen(makeConfig(dir))
    expect(result.files[0].path).toBe(join(dir, '.gemini', 'GEMINI.md'))
    expect(readFileSync(join(dir, '.gemini', 'GEMINI.md'), 'utf-8')).toContain('AGENTS.md')
  })

  it('honors dryRun: no file is written and action is dry-run', () => {
    const gen = makeAgentFileGenerator({
      outPath: ['.aider.conf.yml'],
      templatePath: 'aider/.aider.conf.yml.ejs',
    })
    const result = gen(makeConfig(dir), { dryRun: true })
    expect(result.files[0].action).toBe('dry-run')
    expect(existsSync(join(dir, '.aider.conf.yml'))).toBe(false)
  })

  it('renders the template with the provided config', () => {
    const gen = makeAgentFileGenerator({
      outPath: ['.aider.conf.yml'],
      templatePath: 'aider/.aider.conf.yml.ejs',
    })
    gen(makeConfig(dir, { projectName: 'factory-proj' }))
    expect(readFileSync(join(dir, '.aider.conf.yml'), 'utf-8')).toContain('factory-proj')
  })

  it('backs up an existing file and returns backed-up-and-replaced', () => {
    const gen = makeAgentFileGenerator({
      outPath: ['.aider.conf.yml'],
      templatePath: 'aider/.aider.conf.yml.ejs',
    })
    gen(makeConfig(dir)) // first write — creates the file
    const backupPath = join(dir, '.aider.conf.yml.arbiter-backup')
    expect(existsSync(backupPath)).toBe(false)

    const result = gen(makeConfig(dir)) // second write — must back up
    expect(result.files[0].action).toBe('backed-up-and-replaced')
    expect(existsSync(backupPath)).toBe(true)
  })
})
