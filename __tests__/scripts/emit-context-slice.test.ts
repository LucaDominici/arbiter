import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'

const SCRIPT = resolve('scripts/emit-context-slice.mjs')
const REPO_ROOT = resolve('.')

function run(args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', cwd: REPO_ROOT })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

const FIXTURE_LINES = [
  'line one — alpha',
  'line two — beta with **markdown**',
  'line three — `code`',
  'line four — MUST keep word boundaries',
  'line five — final',
]
const FIXTURE_BODY = `${FIXTURE_LINES.join('\n')}\n`

let fixturePath: string
let fixtureRel: string

beforeAll(() => {
  fixturePath = join(REPO_ROOT, '__tests__/fixtures/context-slice-sample.txt')
  writeFileSync(fixturePath, FIXTURE_BODY)
  fixtureRel = relative(REPO_ROOT, fixturePath)
})

afterAll(() => {
  rmSync(fixturePath, { force: true })
})

describe('scripts/emit-context-slice.mjs (#993 — CONTEXT_SLICE emitter)', () => {
  it('exits 0 with valid source + range', () => {
    const r = run(['--source', fixtureRel, '--lines', '1-3'])
    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
    expect(r.stdout.length).toBeGreaterThan(0)
  })

  it('emits all required header fields in fixed order', () => {
    const r = run(['--source', fixtureRel, '--lines', '2-4'])
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/^# CONTEXT_SLICE\n/)
    expect(r.stdout).toMatch(/^- spec_version: 1\.0\.0$/m)
    expect(r.stdout).toMatch(new RegExp(`^- source: ${fixtureRel}:L2-L4$`, 'm'))
    expect(r.stdout).toMatch(/^- line_count: 3$/m)
    expect(r.stdout).toMatch(/^- byte_count: \d+$/m)
    expect(r.stdout).toMatch(/^- sha256: [0-9a-f]{64}$/m)
  })

  it('body is byte-identical to the cited line range', () => {
    const r = run(['--source', fixtureRel, '--lines', '2-4'])
    expect(r.status).toBe(0)
    const expected = `${FIXTURE_LINES.slice(1, 4).join('\n')}\n`
    const body = r.stdout.split('\n\n').slice(1).join('\n\n')
    expect(body).toBe(expected)
  })

  it('byte_count equals UTF-8 byte length of body', () => {
    const r = run(['--source', fixtureRel, '--lines', '1-5'])
    expect(r.status).toBe(0)
    const expected = FIXTURE_BODY
    const body = r.stdout.split('\n\n').slice(1).join('\n\n')
    expect(body).toBe(expected)
    const m = r.stdout.match(/^- byte_count: (\d+)$/m)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBe(Buffer.byteLength(expected, 'utf-8'))
  })

  it('sha256 matches sha256 of body bytes only', () => {
    const r = run(['--source', fixtureRel, '--lines', '1-5'])
    expect(r.status).toBe(0)
    const body = r.stdout.split('\n\n').slice(1).join('\n\n')
    const expected = createHash('sha256').update(Buffer.from(body, 'utf-8')).digest('hex')
    const m = r.stdout.match(/^- sha256: ([0-9a-f]{64})$/m)
    expect(m).not.toBeNull()
    expect(m![1]).toBe(expected)
  })

  it('single-line slice (L3-L3) works', () => {
    const r = run(['--source', fixtureRel, '--lines', '3-3'])
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/^- line_count: 1$/m)
    const body = r.stdout.split('\n\n').slice(1).join('\n\n')
    expect(body).toBe(`${FIXTURE_LINES[2]}\n`)
  })

  it('last-line slice when file has trailing newline keeps the newline', () => {
    const r = run(['--source', fixtureRel, '--lines', '5-5'])
    expect(r.status).toBe(0)
    const body = r.stdout.split('\n\n').slice(1).join('\n\n')
    expect(body).toBe(`${FIXTURE_LINES[4]}\n`)
  })

  it('last-line slice when file lacks trailing newline omits the newline', () => {
    const noNlPath = join(REPO_ROOT, '__tests__/fixtures/context-slice-no-nl.txt')
    const noNlBody = 'one\ntwo\nthree'
    writeFileSync(noNlPath, noNlBody)
    try {
      const r = run(['--source', relative(REPO_ROOT, noNlPath), '--lines', '3-3'])
      expect(r.status).toBe(0)
      const body = r.stdout.split('\n\n').slice(1).join('\n\n')
      expect(body).toBe('three')
    } finally {
      rmSync(noNlPath, { force: true })
    }
  })

  it('is deterministic: same args → byte-identical stdout', () => {
    const a = run(['--source', fixtureRel, '--lines', '1-5'])
    const b = run(['--source', fixtureRel, '--lines', '1-5'])
    expect(a.status).toBe(0)
    expect(b.status).toBe(0)
    expect(a.stdout).toBe(b.stdout)
  })

  it('--out writes file and stdout stays empty', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctx-slice-'))
    const out = join(dir, 'slice.md')
    try {
      const r = run(['--source', fixtureRel, '--lines', '1-3', '--out', out])
      expect(r.status).toBe(0)
      expect(r.stdout).toBe('')
      const written = readFileSync(out, 'utf-8')
      expect(written).toMatch(/^# CONTEXT_SLICE\n/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects missing --source', () => {
    const r = run(['--lines', '1-3'])
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/--source/)
  })

  it('rejects missing --lines', () => {
    const r = run(['--source', fixtureRel])
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/--lines/)
  })

  it('rejects malformed --lines (no dash)', () => {
    const r = run(['--source', fixtureRel, '--lines', '3'])
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/lines/i)
  })

  it('rejects --lines with end before start', () => {
    const r = run(['--source', fixtureRel, '--lines', '4-2'])
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/lines/i)
  })

  it('rejects --lines with zero or negative bounds', () => {
    const r = run(['--source', fixtureRel, '--lines', '0-2'])
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/lines/i)
  })

  it('rejects --lines out of bounds (end > file length)', () => {
    const r = run(['--source', fixtureRel, '--lines', '1-9999'])
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/lines|range|bounds/i)
  })

  it('rejects absolute --source path', () => {
    const r = run(['--source', fixturePath, '--lines', '1-3'])
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/source|path|relative/i)
  })

  it('rejects parent-traversing --source path', () => {
    const r = run(['--source', '../etc/passwd', '--lines', '1-1'])
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/source|path|traversal|outside/i)
  })

  it('exits 2 when source file does not exist', () => {
    const r = run(['--source', '__tests__/fixtures/does-not-exist.txt', '--lines', '1-1'])
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/source|read|ENOENT/i)
  })
})
