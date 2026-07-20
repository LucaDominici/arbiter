// SPDX-License-Identifier: Apache-2.0
// #2040: `arbiter diff --governance` audits whether high-authority governance sections
// (Iron Laws in AGENTS.md, the permission deny list in .claude/settings.json) are stale
// relative to the CURRENT template — section-scoped, not a whole-file diff (a whole-file
// compare would false-positive on any unrelated customization; the issue's own test case
// asks for "elenco delle sezioni mancanti", a list of missing SECTIONS).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { checkGovernanceSections, runDiff } from '../../src/commands/diff.js'
import { generateAgentsMd } from '../../src/generators/agents-md.js'
import { generateClaude } from '../../src/generators/claude.js'
import { runInit } from '../../src/commands/init.js'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'

describe('checkGovernanceSections (#2040)', () => {
  let dir: string

  afterEach(() => {
    if (dir) cleanupTestProject(dir)
  })

  function freshFixture(): string {
    dir = createTestProject('typescript')
    const config = makeConfig(dir)
    generateAgentsMd(config)
    generateClaude(config)
    return dir
  }

  it('reports nothing stale on a freshly generated project', () => {
    const d = freshFixture()
    const config = makeConfig(d)
    const results = checkGovernanceSections(config, d)
    expect(results.every((r) => !r.stale)).toBe(true)
  })

  it('reports AGENTS.md Iron Laws stale when the section is stripped', () => {
    const d = freshFixture()
    const config = makeConfig(d)
    const agentsPath = join(d, 'AGENTS.md')
    const content = readFileSync(agentsPath, 'utf-8')
    const stripped = content.replace(/## Iron Laws[\s\S]*?(?=\n## )/, '')
    writeFileSync(agentsPath, stripped)
    const results = checkGovernanceSections(config, d)
    const agentsResult = results.find((r) => r.file === 'AGENTS.md')
    expect(agentsResult?.stale).toBe(true)
  })

  it('does NOT report AGENTS.md stale when unrelated prose is added but Iron Laws intact', () => {
    const d = freshFixture()
    const config = makeConfig(d)
    const agentsPath = join(d, 'AGENTS.md')
    const content = readFileSync(agentsPath, 'utf-8')
    writeFileSync(agentsPath, `${content}\n\n## Project Notes\n\nSome custom project note.\n`)
    const results = checkGovernanceSections(config, d)
    const agentsResult = results.find((r) => r.file === 'AGENTS.md')
    expect(agentsResult?.stale).toBe(false)
  })

  // Red-team (edge-case pass): the extraction previously used an unanchored substring
  // search (content.indexOf('## Iron Laws')) which matches a `### Iron Laws` h3, or any
  // prose that quotes the heading name, BEFORE the real heading — defeating the whole
  // point of section-scoping. Prose mentioning the section name must never shadow it.
  it('does NOT report stale when prose quoting "## Iron Laws" appears BEFORE the real heading', () => {
    const d = freshFixture()
    const config = makeConfig(d)
    const agentsPath = join(d, 'AGENTS.md')
    const content = readFileSync(agentsPath, 'utf-8')
    const withPrefixNote =
      '## Project Notes\n\n' +
      'This repo audits the `## Iron Laws` section for staleness.\n\n' +
      content
    writeFileSync(agentsPath, withPrefixNote)
    const results = checkGovernanceSections(config, d)
    const agentsResult = results.find((r) => r.file === 'AGENTS.md')
    expect(agentsResult?.stale).toBe(false)
  })

  it('does NOT report stale when an h3 "### Iron Laws" sub-heading precedes the real h2 heading', () => {
    const d = freshFixture()
    const config = makeConfig(d)
    const agentsPath = join(d, 'AGENTS.md')
    const content = readFileSync(agentsPath, 'utf-8')
    const withH3 = '### Iron Laws (draft notes, ignore)\n\nWIP.\n\n' + content
    writeFileSync(agentsPath, withH3)
    const results = checkGovernanceSections(config, d)
    const agentsResult = results.find((r) => r.file === 'AGENTS.md')
    expect(agentsResult?.stale).toBe(false)
  })

  it('reports settings.json deny list stale when an ARBITER_* entry is removed', () => {
    const d = freshFixture()
    const config = makeConfig(d)
    const settingsPath = join(d, '.claude', 'settings.json')
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    parsed.permissions.deny = parsed.permissions.deny.filter(
      (e: string) => !e.includes('ARBITER_GATE_BYPASS'),
    )
    writeFileSync(settingsPath, JSON.stringify(parsed, null, 2))
    const results = checkGovernanceSections(config, d)
    const settingsResult = results.find((r) => r.file === '.claude/settings.json')
    expect(settingsResult?.stale).toBe(true)
    expect(settingsResult?.detail).toContain('ARBITER_GATE_BYPASS')
  })

  it('does NOT report settings.json stale when extra unrelated permissions were added', () => {
    const d = freshFixture()
    const config = makeConfig(d)
    const settingsPath = join(d, '.claude', 'settings.json')
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    parsed.permissions.deny.push('Bash(some-project-specific-thing)')
    writeFileSync(settingsPath, JSON.stringify(parsed, null, 2))
    const results = checkGovernanceSections(config, d)
    const settingsResult = results.find((r) => r.file === '.claude/settings.json')
    expect(settingsResult?.stale).toBe(false)
  })

  // Red-team (triple-corroborated): an uncaught JSON.parse/shape-mismatch on a hand-edited
  // or merge-conflicted settings.json must never crash checkGovernanceSections — it must
  // degrade to a reported stale/malformed result, matching every other malformed-input
  // path this branch establishes (arbiter.json, constraint-map.json).
  it('reports settings.json stale (not a crash) when the file is invalid JSON', () => {
    const d = freshFixture()
    const config = makeConfig(d)
    const settingsPath = join(d, '.claude', 'settings.json')
    writeFileSync(settingsPath, '<<<<<<< HEAD\n{ broken\n=======\n>>>>>>> branch\n')
    expect(() => checkGovernanceSections(config, d)).not.toThrow()
    const results = checkGovernanceSections(config, d)
    const settingsResult = results.find((r) => r.file === '.claude/settings.json')
    expect(settingsResult?.stale).toBe(true)
  })

  // Red-team (self-review pass): the malformed-settings catch must surface the actual
  // parse/shape error to stderr, not just collapse it to a generic "malformed" detail —
  // otherwise a real EACCES/EISDIR bug is indistinguishable from "please regenerate".
  it('surfaces the actual parse error to stderr when settings.json is malformed', () => {
    const d = freshFixture()
    const config = makeConfig(d)
    const settingsPath = join(d, '.claude', 'settings.json')
    writeFileSync(settingsPath, '{ broken')
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      checkGovernanceSections(config, d)
      expect(stderrSpy).toHaveBeenCalled()
      const surfaced = stderrSpy.mock.calls.map((c) => String(c[0])).join('')
      expect(surfaced).toMatch(/settings\.json/i)
    } finally {
      stderrSpy.mockRestore()
    }
  })

  it('reports settings.json stale (not a crash) when permissions.deny is not an array', () => {
    const d = freshFixture()
    const config = makeConfig(d)
    const settingsPath = join(d, '.claude', 'settings.json')
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    parsed.permissions.deny = 42
    writeFileSync(settingsPath, JSON.stringify(parsed, null, 2))
    expect(() => checkGovernanceSections(config, d)).not.toThrow()
    const results = checkGovernanceSections(config, d)
    const settingsResult = results.find((r) => r.file === '.claude/settings.json')
    expect(settingsResult?.stale).toBe(true)
  })

  it('reports settings.json stale (not a crash) when the whole file is the JSON literal null', () => {
    const d = freshFixture()
    const config = makeConfig(d)
    const settingsPath = join(d, '.claude', 'settings.json')
    writeFileSync(settingsPath, 'null')
    expect(() => checkGovernanceSections(config, d)).not.toThrow()
    const results = checkGovernanceSections(config, d)
    const settingsResult = results.find((r) => r.file === '.claude/settings.json')
    expect(settingsResult?.stale).toBe(true)
  })

  it('reports both files stale (file missing) when neither has been scaffolded yet', () => {
    dir = createTestProject('typescript')
    const config = makeConfig(dir)
    mkdirSync(join(dir, '.claude'), { recursive: true })
    const results = checkGovernanceSections(config, dir)
    expect(results.find((r) => r.file === 'AGENTS.md')?.stale).toBe(true)
    expect(results.find((r) => r.file === '.claude/settings.json')?.stale).toBe(true)
  })
})

describe('arbiter diff --governance (CLI wiring, #2040)', () => {
  let dir: string

  afterEach(() => {
    if (dir) cleanupTestProject(dir)
  })

  it('exits 0 on a freshly `arbiter init`-ed project (real init, no mocks)', async () => {
    dir = createTestProject('typescript')
    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L1',
      dir,
      dryRun: false,
      brownfield: false,
      noVerify: true,
      language: 'typescript',
      archetype: 'library',
    })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    runDiff({ dir, governance: true, json: true })
    expect(exitSpy).not.toHaveBeenCalled()
    exitSpy.mockRestore()
  })

  it('exits 1 when the initialized project is then stripped of Iron Laws', async () => {
    dir = createTestProject('typescript')
    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L1',
      dir,
      dryRun: false,
      brownfield: false,
      noVerify: true,
      language: 'typescript',
      archetype: 'library',
    })
    const agentsPath = join(dir, 'AGENTS.md')
    const content = readFileSync(agentsPath, 'utf-8')
    writeFileSync(agentsPath, content.replace(/## Iron Laws[\s\S]*?(?=\n## )/, ''))
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    runDiff({ dir, governance: true, json: true })
    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })
})
