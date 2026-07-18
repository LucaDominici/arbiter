// SPDX-License-Identifier: Apache-2.0
// Behavioral tests (#1040): arbiter verify sub-commands — spawn the real CLI
// binary and assert observable output/exit-code invariants.
import { describe, it, expect, afterEach } from 'vitest'
import { resolve, join } from 'node:path'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const CLI = resolve(import.meta.dirname, '../../dist/cli.js')
const NODE = process.execPath
const CLI_SRC = resolve(import.meta.dirname, '../../src/cli.ts')

function spawn(args: string[], cwd?: string): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(NODE, [CLI, ...args], {
    cwd,
    encoding: 'utf-8',
    timeout: 30_000,
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  }
}

const planFixtureDirs: string[] = []
afterEach(() => {
  for (const d of planFixtureDirs.splice(0)) {
    rmSync(d, { recursive: true, force: true })
  }
})

/** Write `content` to a fresh temp PLAN.json and return its path. */
function writePlanFixture(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-verify-plan-2001-'))
  planFixtureDirs.push(dir)
  const file = join(dir, 'PLAN.json')
  writeFileSync(file, content)
  return file
}

describe('arbiter verify — sub-command surface', () => {
  it('verify --help exits 0 and lists sub-commands', () => {
    const { status, stdout } = spawn(['verify', '--help'])
    expect(status).toBe(0)
    expect(stdout).toContain('evidence')
    expect(stdout).toContain('tdd')
  })

  it('verify exits 0 in a TypeScript project', () => {
    const { status, stdout, stderr } = spawn(['verify'])
    expect(status, `stdout: ${stdout}\nstderr: ${stderr}`).toBe(0)
    expect(stdout + stderr).toContain('typescript')
  })

  it('verify --json exits 0 and emits JSON', () => {
    const { status, stdout, stderr } = spawn(['verify', '--json'])
    expect(status, `stdout: ${stdout}\nstderr: ${stderr}`).toBe(0)
    const parsed = JSON.parse(stdout)
    expect(parsed).toHaveProperty('stack')
    expect(parsed).toHaveProperty('probes')
  })

  it('verify tdd --help exits 0 and mentions task-id', () => {
    const { status, stdout } = spawn(['verify', 'tdd', '--help'])
    expect(status).toBe(0)
    expect(stdout).toContain('task-id')
  })

  it('verify tdd exits non-zero for a nonexistent task ID', () => {
    const { status } = spawn(['verify', 'tdd', '#9999999'])
    expect(status).not.toBe(0)
  })

  it('verify tdd --json emits a parseable envelope with 6 check verdicts (#1992)', () => {
    // #551 evidence is real, committed fixture data in this repo (predates
    // #1957's red-execution check, so it FAILs — but all 6 checks still run;
    // see __tests__/integration/gate/tdd-evidence-l2.test.ts). --json here
    // was silently ignored: a Commander parent/child `--json` name collision
    // (verify/validate declares its own `--json`) shadowed the subcommand's
    // parsed value, so the CLI always printed the human-readable line.
    const { status, stdout, stderr } = spawn(['verify', 'tdd', '#551', '--json'])
    expect(status).not.toBe(0)
    expect(stdout, `expected JSON, got plain text — stderr: ${stderr}`).not.toContain(
      'verify tdd: FAIL —',
    )
    const parsed = JSON.parse(stdout)
    expect(parsed.command).toBe('verify tdd')
    expect(parsed.status).toBe('error')
    expect(parsed.data.exitCode).toBe(1)
    expect(Array.isArray(parsed.data.checks)).toBe(true)
    expect(parsed.data.checks).toHaveLength(6)
    for (const check of parsed.data.checks) {
      expect(check).toHaveProperty('name')
      expect(check).toHaveProperty('pass')
    }
  })

  it('verify graph --help exits 0', () => {
    const { status, stdout } = spawn(['verify', 'graph', '--help'])
    expect(status).toBe(0)
    expect(stdout).toContain('provenance')
  })

  // #1994: the same verify/validate parent-child `--json` shadowing #1992
  // fixed for `verify tdd` is still live in these three sibling handlers —
  // each reads the shadowed `opts.json` (always the parent's `false`
  // default) instead of `cmd.optsWithGlobals().json`, so `--json` was
  // silently ignored and the CLI printed the plain-text line instead.

  it('verify evidence --json emits a parseable error envelope (#1994)', () => {
    // No .evidence/SUMMARY.json in this repo — deterministic error path.
    const { status, stdout, stderr } = spawn(['verify', 'evidence', '--json'])
    expect(status).not.toBe(0)
    expect(stdout, `expected JSON, got plain text — stderr: ${stderr}`).not.toContain(
      'verify evidence:',
    )
    const parsed = JSON.parse(stdout)
    expect(parsed.command).toBe('verify evidence')
    expect(parsed.status).toBe('error')
  })

  it('verify graph --json emits a parseable error envelope (#1994)', () => {
    // No .arbiter/graph.json in this repo — deterministic error path.
    const { status, stdout, stderr } = spawn(['verify', 'graph', '--json'])
    expect(status).not.toBe(0)
    expect(stdout, `expected JSON, got plain text — stderr: ${stderr}`).not.toContain(
      'verify graph:',
    )
    const parsed = JSON.parse(stdout)
    expect(parsed.command).toBe('verify graph')
    expect(parsed.status).toBe('error')
  })

  it('verify plan <file> --json emits a parseable error envelope (#1994)', () => {
    // Nonexistent plan file — deterministic error path.
    const { status, stdout, stderr } = spawn([
      'verify',
      'plan',
      '/tmp/arbiter-1994-does-not-exist.json',
      '--json',
    ])
    expect(status).not.toBe(0)
    expect(stdout, `expected JSON, got plain text — stderr: ${stderr}`).not.toContain(
      'verify plan:',
    )
    const parsed = JSON.parse(stdout)
    expect(parsed.command).toBe('verify plan')
    expect(parsed.status).toBe('error')
  })

  // #2001: the file-not-found path above pins exitCode 2 + a JSON error
  // envelope, but the existing-file-with-invalid-content paths were only
  // verified manually (see #1996 closing comment) — no pinning test. A
  // future refactor reintroducing a throwing `.parse()` in `parsePlan()`
  // (src/commands/verify-plan.ts) would land unnoticed. Pin current
  // behavior for all three invalid-content shapes.

  it('verify plan <file> --json: existing file, schema-invalid content (wrong field) → exit 2 + error envelope (#2001)', () => {
    const file = writePlanFixture(JSON.stringify({ not_a_valid_plan_field: true }))
    const { status, stdout, stderr } = spawn(['verify', 'plan', file, '--json'])
    expect(status).toBe(2)
    expect(stdout, `expected JSON, got plain text — stderr: ${stderr}`).not.toContain(
      'verify plan:',
    )
    const parsed = JSON.parse(stdout)
    expect(parsed.command).toBe('verify plan')
    expect(parsed.status).toBe('error')
  })

  it('verify plan <file> --json: existing file, malformed JSON → exit 2 + error envelope (#2001)', () => {
    const file = writePlanFixture('{ this is not valid JSON')
    const { status, stdout, stderr } = spawn(['verify', 'plan', file, '--json'])
    expect(status).toBe(2)
    expect(stdout, `expected JSON, got plain text — stderr: ${stderr}`).not.toContain(
      'verify plan:',
    )
    const parsed = JSON.parse(stdout)
    expect(parsed.command).toBe('verify plan')
    expect(parsed.status).toBe('error')
  })

  it('verify plan <file> --json: existing file, wrong root type (array) → exit 2 + error envelope (#2001)', () => {
    const file = writePlanFixture(JSON.stringify([1, 2, 3]))
    const { status, stdout, stderr } = spawn(['verify', 'plan', file, '--json'])
    expect(status).toBe(2)
    expect(stdout, `expected JSON, got plain text — stderr: ${stderr}`).not.toContain(
      'verify plan:',
    )
    const parsed = JSON.parse(stdout)
    expect(parsed.command).toBe('verify plan')
    expect(parsed.status).toBe('error')
  })
})

// #1996: static regression guard — the #1992/#1994 parent/child `--json`
// shadowing class has now bitten 4 `verify`/`validate` child commands (tdd,
// evidence, graph, plan). Read the real source and assert every child
// `.action(` body reads `cmd.optsWithGlobals().json`, never the shadowed
// `opts.json` / `options.json` — so a 5th child can't reintroduce the bug.
describe('arbiter verify — child commands never read the shadowed --json (#1996)', () => {
  /** Source lines where a top-level `verify` child registration starts. */
  function childBlockStarts(lines: string[]): number[] {
    const starts: number[] = []
    for (let i = 0; i < lines.length; i++) {
      if (/^verify$/.test(lines[i] ?? '')) starts.push(i)
    }
    return starts
  }

  /** Slice from a child's start line to the next top-level (column-0) statement. */
  function extractChildBlock(lines: string[], start: number): string {
    let end = start + 1
    while (end < lines.length && !/^\S/.test(lines[end] ?? '')) end++
    return lines.slice(start, end).join('\n')
  }

  function childCommandName(block: string): string | undefined {
    return block.match(/\.command\(\s*['"]([a-z]+)/)?.[1]
  }

  it('finds the 4 known verify child commands with no shadowed opts.json read', () => {
    const src = readFileSync(CLI_SRC, 'utf-8')
    const lines = src.split('\n')
    const starts = childBlockStarts(lines)
    expect(starts.length).toBeGreaterThanOrEqual(4)

    const seen: string[] = []
    for (const start of starts) {
      const block = extractChildBlock(lines, start)
      const codeOnly = block
        .split('\n')
        .map((l) => l.replace(/\/\/.*$/, ''))
        .join('\n')
      const name = childCommandName(codeOnly)
      if (name !== undefined) seen.push(name)
      const shadowedRead = /\b(?:opts|options)\.json\b/.test(codeOnly)
      expect(
        shadowedRead,
        `verify ${name ?? '?'} reads the shadowed opts.json — use cmd.optsWithGlobals().json instead`,
      ).toBe(false)
    }
    expect(seen).toEqual(expect.arrayContaining(['evidence', 'plan', 'graph', 'tdd']))
  })
})
