// SPDX-License-Identifier: Apache-2.0
// RED phase (acceptance-anchor P1): the issue-readiness CLI is the entry gate upstream
// of every wave — exit 0 ready / 1 not-ready (+JSON missing list, optional comment
// body) / 2 error. Pure logic lives in scripts/lib/acceptance-criteria.mjs; this pins
// the CLI contract the wave-drain / ship skills depend on.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const SCRIPT = resolve(__dirname, '../../scripts/issue-readiness.mjs')

const READY_BODY = [
  '### Acceptance criteria',
  '- [ ] AC-1: fetcher retries 3 times on 5xx',
  '### Non-goals',
  '- no circuit breaker',
  '### Files / contracts touched',
  '- src/fetcher.ts',
].join('\n')

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'issue-readiness-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function run(args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf-8' })
}

describe('issue-readiness CLI', () => {
  it('exits 0 with {ready:true} for a fully specified body', () => {
    writeFileSync(join(dir, 'body.md'), READY_BODY)
    const r = run(['--body-file', join(dir, 'body.md')])
    expect(r.status).toBe(0)
    expect(JSON.parse(r.stdout.split('\n')[0])).toEqual({ ready: true, missing: [] })
  })

  it('exits 1 with the missing list and comment body for an underspecified issue', () => {
    writeFileSync(join(dir, 'body.md'), 'make it better please')
    const r = run(['--body-file', join(dir, 'body.md'), '--emit-comment'])
    expect(r.status).toBe(1)
    const verdict = JSON.parse(r.stdout.split('\n')[0])
    expect(verdict.ready).toBe(false)
    expect(verdict.missing.length).toBeGreaterThanOrEqual(3)
    expect(r.stdout).toContain('needs-clarification')
  })

  it('exits 2 on a missing body file or bad usage', () => {
    expect(run(['--body-file', join(dir, 'nope.md')]).status).toBe(2)
    expect(run([]).status).toBe(2)
  })
})
