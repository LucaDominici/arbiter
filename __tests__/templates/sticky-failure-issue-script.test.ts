// SPDX-License-Identifier: Apache-2.0
//
// A6 (#1817) executable proof: renders sticky-failure-issue.sh.ejs to a real file and
// runs it against a mocked `gh` CLI (a tiny Node script on a temp PATH, state-backed by
// a JSON file) — no real GitHub API involved. Proves the AC verbatim: two simulated
// consecutive scheduled-lane failures produce ONE sticky issue with TWO entries
// (append, not one-issue-per-failure), and a subsequent green run closes it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, chmodSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

interface MockIssue {
  number: number
  title: string
  state: 'open' | 'closed'
  body: string
  comments: string[]
}

interface MockGhState {
  nextNumber: number
  issues: MockIssue[]
}

// Minimal `gh` CLI double: implements only the 5 sub-invocations the sticky-issue
// script actually makes (issue list/create/view/comment/close), state persisted as
// JSON so behavior survives across the two separate process invocations the test
// makes (record, record, close).
const MOCK_GH_SOURCE = `#!/usr/bin/env node
// CommonJS (no extension on PATH, so Node module-type detection defaults to
// commonjs here — deliberately not ESM 'import' syntax).
const { readFileSync, writeFileSync } = require('node:fs')

const statePath = process.env.MOCK_GH_STATE
const args = process.argv.slice(2)

function load() {
  return JSON.parse(readFileSync(statePath, 'utf-8'))
}
function save(state) {
  writeFileSync(statePath, JSON.stringify(state, null, 2))
}

const [resource, action, ...rest] = args

if (resource === 'issue' && action === 'list') {
  const searchIdx = rest.indexOf('--search')
  const search = rest[searchIdx + 1]
  const m = /"([^"]+)"/.exec(search)
  const title = m ? m[1] : ''
  const state = load()
  const found = state.issues.find((i) => i.title === title && i.state === 'open')
  if (found) process.stdout.write(String(found.number) + '\\n')
  process.exit(0)
}

if (resource === 'issue' && action === 'create') {
  const titleIdx = rest.indexOf('--title')
  const bodyIdx = rest.indexOf('--body')
  const title = rest[titleIdx + 1]
  const body = rest[bodyIdx + 1]
  const state = load()
  const number = state.nextNumber
  state.nextNumber += 1
  state.issues.push({ number, title, state: 'open', body, comments: [] })
  save(state)
  process.stdout.write(\`https://github.com/mock/repo/issues/\${number}\\n\`)
  process.exit(0)
}

if (resource === 'issue' && action === 'view') {
  const number = Number(rest[0])
  const state = load()
  const issue = state.issues.find((i) => i.number === number)
  const count = issue ? issue.comments.filter((c) => c.startsWith('Run: ')).length : 0
  process.stdout.write(String(count) + '\\n')
  process.exit(0)
}

if (resource === 'issue' && action === 'comment') {
  const number = Number(rest[0])
  const bodyIdx = rest.indexOf('--body')
  const body = rest[bodyIdx + 1]
  const state = load()
  const issue = state.issues.find((i) => i.number === number)
  issue.comments.push(body)
  save(state)
  process.exit(0)
}

if (resource === 'issue' && action === 'close') {
  const number = Number(rest[0])
  const commentIdx = rest.indexOf('--comment')
  const comment = rest[commentIdx + 1]
  const state = load()
  const issue = state.issues.find((i) => i.number === number)
  issue.state = 'closed'
  issue.comments.push(comment)
  save(state)
  process.exit(0)
}

process.stderr.write(\`mock-gh: unhandled invocation: \${args.join(' ')}\\n\`)
process.exit(1)
`

let workDir: string
let scriptPath: string
let statePath: string
let ghPath: string
let env: NodeJS.ProcessEnv

function resetState(): void {
  const empty: MockGhState = { nextNumber: 1, issues: [] }
  writeFileSync(statePath, JSON.stringify(empty, null, 2))
}

function runScript(mode: 'record' | 'close', lane: string): void {
  execFileSync(scriptPath, [mode, lane], {
    env,
    stdio: 'pipe',
  })
}

function readState(): MockGhState {
  return JSON.parse(readFileSync(statePath, 'utf-8'))
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'arbiter-sticky-issue-'))

  const rendered = renderTemplate(
    'github/scripts/sticky-failure-issue.sh.ejs',
    makeConfig(workDir, { enableFiveLaneCi: true, useGitHub: true }) as unknown as Record<
      string,
      unknown
    >,
  )
  scriptPath = join(workDir, 'sticky-failure-issue.sh')
  writeFileSync(scriptPath, rendered)
  chmodSync(scriptPath, 0o755)

  ghPath = join(workDir, 'gh')
  writeFileSync(ghPath, MOCK_GH_SOURCE)
  chmodSync(ghPath, 0o755)

  statePath = join(workDir, 'gh-state.json')
  resetState()

  env = {
    ...process.env,
    PATH: `${workDir}:${process.env.PATH}`,
    GH_TOKEN: 'mock-token',
    MOCK_GH_STATE: statePath,
    RUN_URL: 'https://github.com/mock/repo/actions/runs/1',
  }
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
})

describe('sticky-failure-issue.sh — A6 AC (two consecutive failures -> one issue, two entries)', () => {
  it('creates exactly one open issue after two consecutive record invocations', () => {
    runScript('record', 'nightly')
    runScript('record', 'nightly')

    const state = readState()
    expect(state.issues).toHaveLength(1)
    expect(state.issues[0].state).toBe('open')
  })

  it('appends one entry per failure — two failures produce two comments', () => {
    runScript('record', 'nightly')
    runScript('record', 'nightly')

    const state = readState()
    const runComments = state.issues[0].comments.filter((c) => c.startsWith('Run: '))
    expect(runComments).toHaveLength(2)
    expect(runComments[0]).toContain('Failure #1')
    expect(runComments[1]).toContain('Failure #2')
  })

  it('a third failure appends a third entry to the SAME issue (never a new one)', () => {
    runScript('record', 'nightly')
    runScript('record', 'nightly')
    runScript('record', 'nightly')

    const state = readState()
    expect(state.issues).toHaveLength(1)
    const runComments = state.issues[0].comments.filter((c) => c.startsWith('Run: '))
    expect(runComments).toHaveLength(3)
    expect(runComments[2]).toContain('Failure #3')
  })

  it('a green run closes the sticky issue with a run-link comment', () => {
    runScript('record', 'nightly')
    runScript('record', 'nightly')
    runScript('close', 'nightly')

    const state = readState()
    expect(state.issues).toHaveLength(1)
    expect(state.issues[0].state).toBe('closed')
    expect(state.issues[0].comments.at(-1)).toContain('green again')
  })

  it('close is a no-op when no sticky issue is open', () => {
    runScript('close', 'nightly')

    const state = readState()
    expect(state.issues).toHaveLength(0)
  })

  it('keeps separate lanes on separate sticky issues', () => {
    runScript('record', 'nightly')
    runScript('record', 'weekly')

    const state = readState()
    expect(state.issues).toHaveLength(2)
    expect(state.issues.map((i) => i.title).sort()).toEqual([
      'chore(nightly): pipeline red',
      'chore(weekly): pipeline red',
    ])
  })
})
