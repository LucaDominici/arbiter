// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
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

  it('honors dryRun: no file is written and action is the prospective action (#1077)', () => {
    // #1077: writeFile no longer emits a synthetic 'dry-run' action. In dryRun it
    // computes the *prospective* action without touching disk. For a missing file
    // that prospective action is 'created' — exactly what a real run would report.
    const gen = makeAgentFileGenerator({
      outPath: ['.aider.conf.yml'],
      templatePath: 'aider/.aider.conf.yml.ejs',
    })
    const result = gen(makeConfig(dir), { dryRun: true })
    expect(result.files[0].action).toBe('created')
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

  it('backs up an existing file when regenerated content differs', () => {
    const gen = makeAgentFileGenerator({
      outPath: ['.aider.conf.yml'],
      templatePath: 'aider/.aider.conf.yml.ejs',
    })
    gen(makeConfig(dir)) // first write — creates the file
    const backupPath = join(dir, '.aider.conf.yml.arbiter-backup')
    expect(existsSync(backupPath)).toBe(false)

    // Simulate a user edit so the regenerated content genuinely differs from
    // disk — only then does writeFile take the backup-and-replace path. (#1077:
    // a byte-identical regeneration now skips and does NOT churn a backup.)
    writeFileSync(join(dir, '.aider.conf.yml'), '# user-edited\n', 'utf-8')
    const result = gen(makeConfig(dir)) // second write — must back up
    expect(result.files[0].action).toBe('backed-up-and-replaced')
    expect(existsSync(backupPath)).toBe(true)
    expect(readFileSync(backupPath, 'utf-8')).toBe('# user-edited\n')
  })

  it('skips a byte-identical regeneration without backing up (#1077 F6 idempotence)', () => {
    const gen = makeAgentFileGenerator({
      outPath: ['.aider.conf.yml'],
      templatePath: 'aider/.aider.conf.yml.ejs',
    })
    gen(makeConfig(dir)) // first write — creates the file
    const backupPath = join(dir, '.aider.conf.yml.arbiter-backup')

    // Second run with no on-disk change → byte-identical → skipped, no churned backup.
    const result = gen(makeConfig(dir))
    expect(result.files[0].action).toBe('skipped')
    expect(existsSync(backupPath)).toBe(false)
  })
})
