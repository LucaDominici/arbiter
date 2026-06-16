// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach, vi } from 'vitest'

vi.mock('../../src/utils/run-cli.js', () => ({
  runCli: vi.fn(),
  CliError: class CliError extends Error {
    exitCode: number
    stdout: string
    stderr: string
    timedOut: boolean
    notFound: boolean
    constructor(details: {
      exitCode: number
      stdout: string
      stderr: string
      timedOut: boolean
      notFound: boolean
    }) {
      super('CliError')
      this.exitCode = details.exitCode
      this.stdout = details.stdout
      this.stderr = details.stderr
      this.timedOut = details.timedOut
      this.notFound = details.notFound
    }
  },
}))

import { runCli, CliError } from '../../src/utils/run-cli.js'
import { createGhIssue, appendTechDebtIssue } from '../../src/utils/github-issue-helper.js'

const mockedRunCli = vi.mocked(runCli)
const MockedCliError = CliError as unknown as new (details: {
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
  notFound: boolean
}) => CliError

describe('github-issue-helper', () => {
  const dirs: string[] = []

  afterEach(() => {
    while (dirs.length > 0) {
      const d = dirs.pop()
      if (d) rmSync(d, { recursive: true, force: true })
    }
    vi.clearAllMocks()
  })

  function tmp(): string {
    const d = mkdtempSync(join(tmpdir(), 'gh-issue-helper-'))
    dirs.push(d)
    return d
  }

  describe('createGhIssue()', () => {
    it('passes caller-supplied title, body, AND labels[] verbatim to gh (label pinning)', () => {
      const dir = tmp()
      mockedRunCli.mockReturnValueOnce({
        stdout: 'https://github.com/owner/repo/issues/77\n',
        stderr: '',
        exitCode: 0,
        durationMs: 100,
      })

      const result = createGhIssue(dir, {
        title: 'my title',
        body: 'my body',
        labels: ['finding', 'tech-debt', 'priority/P1'],
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.issueNumber).toBe(77)

      // The exact argv must carry the caller labels, NOT a hardcoded set.
      const argv = mockedRunCli.mock.calls[0]?.[1] as string[]
      expect(argv).toContain('--title')
      expect(argv).toContain('my title')
      expect(argv).toContain('--body')
      expect(argv).toContain('my body')
      // each label as its own --label flag
      const labelFlagCount = argv.filter((a) => a === '--label').length
      expect(labelFlagCount).toBe(3)
      expect(argv).toContain('finding')
      expect(argv).toContain('priority/P1')
    })

    it('different callers pin different labels (no hardcoding)', () => {
      const dir = tmp()
      mockedRunCli.mockReturnValue({
        stdout: 'https://github.com/owner/repo/issues/5\n',
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      })
      createGhIssue(dir, { title: 't', body: 'b', labels: ['tech-debt', 'follow-up'] })
      const argv = mockedRunCli.mock.calls[0]?.[1] as string[]
      expect(argv).toContain('follow-up')
      expect(argv).not.toContain('finding')
    })

    it('gh not installed → ok:false soft-fail', () => {
      const dir = tmp()
      mockedRunCli.mockImplementationOnce(() => {
        throw new MockedCliError({
          exitCode: -1,
          stdout: '',
          stderr: '',
          timedOut: false,
          notFound: true,
        })
      })
      const result = createGhIssue(dir, { title: 't', body: 'b', labels: ['x'] })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.reason).toMatch(/not installed|gh/i)
    })

    it('gh returns no parseable issue number → ok:false', () => {
      const dir = tmp()
      mockedRunCli.mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 10 })
      const result = createGhIssue(dir, { title: 't', body: 'b', labels: ['x'] })
      expect(result.ok).toBe(false)
    })
  })

  describe('appendTechDebtIssue()', () => {
    it('appends issue numbers, preserving prior entries', () => {
      const dir = tmp()
      const ev = join(dir, '.arbiter', 'evidence', '_702')
      mkdirSync(ev, { recursive: true })
      appendTechDebtIssue(ev, 10)
      appendTechDebtIssue(ev, 20)
      const td = JSON.parse(readFileSync(join(ev, 'tech-debt.json'), 'utf-8')) as {
        issues: number[]
      }
      expect(td.issues).toEqual([10, 20])
    })

    it('tolerates a corrupt tech-debt.json (resets to the new entry)', () => {
      const dir = tmp()
      const ev = join(dir, '.arbiter', 'evidence', '_703')
      mkdirSync(ev, { recursive: true })
      // pre-seed a corrupt file
      writeFileSync(join(ev, 'tech-debt.json'), '{ not json', 'utf-8')
      appendTechDebtIssue(ev, 99)
      const td = JSON.parse(readFileSync(join(ev, 'tech-debt.json'), 'utf-8')) as {
        issues: number[]
      }
      expect(td.issues).toEqual([99])
    })

    it('records to a path gen-gap.mjs can read (.arbiter/evidence/<task>/tech-debt.json)', () => {
      const dir = tmp()
      const ev = join(dir, '.arbiter', 'evidence', 'findings-promote')
      mkdirSync(ev, { recursive: true })
      appendTechDebtIssue(ev, 1234)
      expect(existsSync(join(ev, 'tech-debt.json'))).toBe(true)
    })
  })
})
