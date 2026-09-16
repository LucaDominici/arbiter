// SPDX-License-Identifier: Apache-2.0
// #2683: `check evidence` must verify the directory selected with --dir,
// wherever --dir sits on the command line — spawned against the BUILT entrypoint (dist/cli.js).
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { computeSummarySha } from '../../src/risk/sha-check.js'

const CLI = resolve(import.meta.dirname, '../../dist/cli.js')
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

type Kind = 'valid' | 'malformed' | 'missing'

function project(root: string, name: string, kind: Kind): string {
  const dir = join(root, name)
  mkdirSync(dir)
  if (kind === 'missing') return dir
  mkdirSync(join(dir, '.evidence'))
  let content = '{ not json'
  if (kind === 'valid') {
    const body: Record<string, unknown> = {
      stack: 'typescript',
      files: ['docs/intro.md'],
      timestamp: new Date().toISOString(),
      head_sha: 'abc123def456abc123def456abc123def456abc1',
      head_sha_short: 'abc123d',
      obs_gate: 'PASS',
      tests: { passed: 1, failed: 0, total: 1 },
      coverage: { line: 90, branch: 85 },
      mutation: { score: 82 },
      security: { critical: 0, high: 0 },
    }
    content = JSON.stringify({ ...body, sha: computeSummarySha(body) }, null, 2)
  }
  writeFileSync(join(dir, '.evidence', 'SUMMARY.json'), content)
  return dir
}

function fixture(a: Kind, b: Kind): { a: string; b: string; c: string } {
  const root = mkdtempSync(join(tmpdir(), 'arbiter-2683-'))
  roots.push(root)
  return { a: project(root, 'A', a), b: project(root, 'B', b), c: project(root, 'C', 'missing') }
}

function run(args: string[], cwd: string) {
  const env = { ...process.env }
  delete env.E2E_RISK_SKIP
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env,
    encoding: 'utf-8',
    timeout: 30_000,
  })
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

const placements = (dir: string): string[][] => [['check', 'evidence', '--dir', dir]]

describe('check evidence honors the selected --dir (#2683)', () => {
  it('reports malformed target B from valid cwd A, both names and positions (AC-1, AC-5)', () => {
    const { a } = fixture('valid', 'malformed')
    for (const args of placements('../B')) {
      const r = run(args, a)
      expect(r.status, args.join(' ')).toBe(1)
      expect(r.stdout, args.join(' ')).toMatch(/^check evidence: ERROR — invalid JSON/)
    }
  }, 60_000)

  it('accepts valid target B from missing or malformed cwd A (AC-2, AC-5)', () => {
    for (const aKind of ['missing', 'malformed'] as const) {
      const { a } = fixture(aKind, 'valid')
      for (const args of placements('../B')) {
        const r = run(args, a)
        expect(r.status, `${aKind} A: ${args.join(' ')}`).toBe(0)
        expect(r.stdout).toMatch(/^check evidence: OK/)
      }
    }
  }, 60_000)

  it('selects the subject by absolute or relative path independently of cwd (AC-2)', () => {
    const { b, c } = fixture('malformed', 'valid')
    for (const dir of [b, '../B']) {
      for (const args of placements(dir)) {
        const r = run(args, c)
        expect(r.status, args.join(' ')).toBe(0)
        expect(r.stdout).toMatch(/^check evidence: OK/)
      }
    }
  }, 60_000)

  it('keeps cwd verification unchanged without --dir (AC-3)', () => {
    const { a, b } = fixture('valid', 'malformed')
    for (const name of ['check']) {
      const ok = run([name, 'evidence'], a)
      expect(ok.status).toBe(0)
      expect(ok.stdout).toMatch(/^check evidence: OK/)
      const bad = run([name, 'evidence'], b)
      expect(bad.status).toBe(1)
      expect(bad.stdout).toMatch(/^check evidence: ERROR — invalid JSON/)
    }
  }, 60_000)

  it('emits exactly one JSON result for the selected target, agreeing with human mode (AC-4)', () => {
    const cases = [
      { a: 'valid', b: 'malformed', exit: 1, status: 'error', label: /^check evidence: ERROR/ },
      { a: 'malformed', b: 'valid', exit: 0, status: 'ok', label: /^check evidence: OK/ },
    ] as const
    for (const c of cases) {
      const { a } = fixture(c.a, c.b)
      for (const args of placements('../B')) {
        const human = run(args, a)
        expect(human.status, args.join(' ')).toBe(c.exit)
        expect(human.stdout).toMatch(c.label)
        for (const jsonArgs of [[...args, '--json']]) {
          const r = run(jsonArgs, a)
          const lines = r.stdout.trim().split('\n')
          expect(lines, jsonArgs.join(' ')).toHaveLength(1)
          const out = JSON.parse(lines[0]) as {
            command: string
            status: string
            data: { exitCode: number }
          }
          expect(out.command).toBe('check evidence')
          expect(out.status, jsonArgs.join(' ')).toBe(c.status)
          expect(out.data.exitCode).toBe(c.exit)
          expect(r.status, jsonArgs.join(' ')).toBe(c.exit)
        }
      }
    }
  }, 120_000)
})
