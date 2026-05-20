// SPDX-License-Identifier: Apache-2.0
// CANON-04: render tests for evidence-writer.sh.ejs (#973, Port #11)

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { TddEvidenceV1 } from '../../src/evidence/tdd.js'
import { makeConfig } from '../helpers.js'

const NON_TS_LANGUAGES = ['python', 'rust', 'go', 'java'] as const

function renderEvidenceWriter(overrides: Record<string, unknown> = {}) {
  const data = makeConfig('/tmp/test', {
    language: 'python',
    projectName: 'my-service',
    ...overrides,
  } as Parameters<typeof makeConfig>[1]) as unknown as Record<string, unknown>
  return renderTemplate('scripts/evidence-writer.sh.ejs', data)
}

function bashSyntaxCheck(scriptPath: string): { ok: boolean; stderr: string } {
  const r = spawnSync('bash', ['-n', scriptPath], { encoding: 'utf-8' })
  return { ok: r.status === 0, stderr: r.stderr ?? '' }
}

describe('evidence-writer.sh.ejs (CANON-04, #973)', () => {
  it('renders without EJS syntax errors', () => {
    expect(() => renderEvidenceWriter()).not.toThrow()
  })

  it('starts with a POSIX-shell shebang', () => {
    const out = renderEvidenceWriter()
    expect(out).toMatch(/^#!\/usr\/bin\/env (sh|bash)\b/)
  })

  it('uses set -eu for fail-closed semantics', () => {
    expect(renderEvidenceWriter()).toContain('set -eu')
  })

  it('declares the documented required CLI args', () => {
    const out = renderEvidenceWriter()
    expect(out).toContain('--task-id')
    expect(out).toContain('--phase')
    expect(out).toContain('--test-path')
    expect(out).toContain('--out-dir')
    expect(out).toContain('--observed-failure')
  })

  it('writes JSON to <out-dir>/tdd/<task-id>.json', () => {
    const out = renderEvidenceWriter()
    expect(out).toContain('"$OUT_DIR/tdd"')
    expect(out).toContain('$TDD_DIR/$TASK_ID.json')
  })

  it('defaults out-dir to .arbiter/evidence', () => {
    expect(renderEvidenceWriter()).toContain('OUT_DIR=".arbiter/evidence"')
  })

  it('computes timestamp via date -u in the documented ISO format', () => {
    expect(renderEvidenceWriter()).toContain('date -u +%Y-%m-%dT%H:%M:%SZ')
  })

  it('emits the $schemaVersion field as a literal (heredoc escapes the $)', () => {
    // Schema requires the literal "$schemaVersion" key (note leading $).
    // The heredoc must preserve it; shell expansion would replace $schemaVersion
    // with an empty string.
    const out = renderEvidenceWriter()
    expect(out).toContain('"\\$schemaVersion"')
  })

  it.each(NON_TS_LANGUAGES)('renders without error for language=%s', (language) => {
    expect(() => renderEvidenceWriter({ language })).not.toThrow()
  })

  it.each(NON_TS_LANGUAGES)('passes `bash -n` syntax check for language=%s', (language) => {
    const out = renderEvidenceWriter({ language })
    const f = join(tmpdir(), `ew-syntax-${language}-${Date.now()}.sh`)
    writeFileSync(f, out)
    try {
      const r = bashSyntaxCheck(f)
      expect(r.ok, r.stderr).toBe(true)
    } finally {
      rmSync(f, { force: true })
    }
  })

  it('contains no leaked EJS tags after render', () => {
    const out = renderEvidenceWriter()
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })
})

describe('evidence-writer.sh.ejs — runtime behaviour (#973)', () => {
  let workDir: string
  let scriptPath: string

  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), 'ew-runtime-'))
    // Initialise a git repo so `git rev-parse HEAD` produces a 40-char sha.
    execFileSync('git', ['init', '-q'], { cwd: workDir })
    execFileSync('git', ['config', 'user.email', 'test@arbiter.dev'], { cwd: workDir })
    execFileSync('git', ['config', 'user.name', 'Arbiter Test'], { cwd: workDir })
    execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: workDir })

    scriptPath = join(workDir, 'evidence-writer.sh')
    writeFileSync(scriptPath, renderEvidenceWriter({ language: 'python' }))
  })

  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  it('writes evidence file at <out-dir>/tdd/#<id>.json', () => {
    const r = spawnSync(
      'bash',
      [
        scriptPath,
        '--task-id',
        '#999',
        '--test-path',
        '__tests__/foo.py',
        '--observed-failure',
        'FAIL  __tests__/foo.py',
      ],
      { cwd: workDir, encoding: 'utf-8' },
    )
    expect(r.status, r.stderr).toBe(0)
    const evPath = join(workDir, '.arbiter', 'evidence', 'tdd', '#999.json')
    const raw = readFileSync(evPath, 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed['$schemaVersion']).toBe(1)
    expect(parsed.task_id).toBe('#999')
    expect(parsed.test_path).toBe('__tests__/foo.py')
    expect(parsed.recorded_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  })

  it('output validates against TddEvidenceV1 schema', () => {
    const evPath = join(workDir, '.arbiter', 'evidence', 'tdd', '#999.json')
    const data = JSON.parse(readFileSync(evPath, 'utf-8'))
    const result = TddEvidenceV1.safeParse(data)
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true)
  })

  it('prepends `#` when --task-id is provided without it', () => {
    const r = spawnSync(
      'bash',
      [
        scriptPath,
        '--task-id',
        '777',
        '--test-path',
        'bar.rs',
        '--observed-failure',
        'test result: FAILED',
      ],
      { cwd: workDir, encoding: 'utf-8' },
    )
    expect(r.status, r.stderr).toBe(0)
    const evPath = join(workDir, '.arbiter', 'evidence', 'tdd', '#777.json')
    const data = JSON.parse(readFileSync(evPath, 'utf-8'))
    expect(data.task_id).toBe('#777')
  })

  it('exits 2 when --observed-failure is missing (schema: non-empty)', () => {
    const r = spawnSync('bash', [scriptPath, '--task-id', '555', '--test-path', 'foo.go'], {
      cwd: workDir,
      encoding: 'utf-8',
    })
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('--observed-failure')
  })

  it('exits 2 when --task-id contains non-digits', () => {
    const r = spawnSync(
      'bash',
      [scriptPath, '--task-id', 'abc', '--test-path', 'foo.go', '--observed-failure', 'FAIL'],
      { cwd: workDir, encoding: 'utf-8' },
    )
    expect(r.status).toBe(2)
  })

  it('writes valid JSON even when observed-failure contains "double quotes" and \\backslashes', () => {
    const tricky = 'FAIL  "abc"\\def\tend'
    const r = spawnSync(
      'bash',
      [scriptPath, '--task-id', '321', '--test-path', 'tricky.py', '--observed-failure', tricky],
      { cwd: workDir, encoding: 'utf-8' },
    )
    expect(r.status, r.stderr).toBe(0)
    const evPath = join(workDir, '.arbiter', 'evidence', 'tdd', '#321.json')
    const data = JSON.parse(readFileSync(evPath, 'utf-8'))
    expect(data.observed_failure).toBe(tricky)
    const result = TddEvidenceV1.safeParse(data)
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true)
  })
})
