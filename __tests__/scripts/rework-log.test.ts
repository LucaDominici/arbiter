// SPDX-License-Identifier: Apache-2.0
// RED phase (acceptance-anchor P4): rework telemetry — enum-validated JSONL ledger at
// .arbiter/rework/ledger.jsonl (committed: the paired gitignore negations must keep it
// un-ignored), append via `add`, aggregate via `report` (reason × caught + template hint).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  validateEntry,
  aggregateLedger,
  REWORK_REASONS,
  CAUGHT_STAGES,
} from '../../scripts/rework-log.mjs'

const SCRIPT = resolve(__dirname, '../../scripts/rework-log.mjs')
const REPO_ROOT = resolve(__dirname, '../..')

describe('validateEntry (pure)', () => {
  it('accepts a complete entry', () => {
    expect(
      validateEntry({ issue: 42, pr: 7, reason: 'scope-creep', caught: 'review', note: 'x' }),
    ).toEqual([])
  })

  it('rejects out-of-enum reason/caught and a missing issue', () => {
    expect(validateEntry({ issue: 42, reason: 'vibes', caught: 'review' }).join(' ')).toMatch(
      /reason/,
    )
    expect(validateEntry({ issue: 42, reason: 'other', caught: 'later' }).join(' ')).toMatch(
      /caught/,
    )
    expect(validateEntry({ reason: 'other', caught: 'review' }).join(' ')).toMatch(/issue/)
  })

  it('exposes the taxonomy enums', () => {
    expect(REWORK_REASONS).toContain('underspecified-issue')
    expect(CAUGHT_STAGES).toEqual(['review', 'gate', 'post-merge'])
  })
})

describe('aggregateLedger (pure)', () => {
  it('counts reason × caught and surfaces the template hint for the top reason', () => {
    const lines = [
      JSON.stringify({ issue: 1, reason: 'underspecified-issue', caught: 'review' }),
      JSON.stringify({ issue: 2, reason: 'underspecified-issue', caught: 'post-merge' }),
      JSON.stringify({ issue: 3, reason: 'scope-creep', caught: 'review' }),
    ]
    const agg = aggregateLedger(lines)
    expect(agg.total).toBe(3)
    expect(agg.byReason['underspecified-issue']).toBe(2)
    expect(agg.byCaught['review']).toBe(2)
    expect(agg.hints[0]).toMatch(/underspecified-issue/)
  })

  it('skips malformed lines without crashing and reports them', () => {
    const agg = aggregateLedger([
      '{broken',
      JSON.stringify({ issue: 1, reason: 'other', caught: 'gate' }),
    ])
    expect(agg.total).toBe(1)
    expect(agg.malformed).toBe(1)
  })
})

describe('rework-log CLI', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rework-log-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function run(args: string[]) {
    return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf-8' })
  }

  it('add appends a schema-valid JSONL line and report aggregates it', () => {
    const r = run([
      'add',
      '--issue',
      '42',
      '--reason',
      'missing-edge-case',
      '--caught',
      'review',
      '--note',
      'null case forgotten',
    ])
    expect(r.status).toBe(0)
    const ledger = join(root, '.arbiter', 'rework', 'ledger.jsonl')
    expect(existsSync(ledger)).toBe(true)
    const entry = JSON.parse(readFileSync(ledger, 'utf-8').trim())
    expect(entry).toMatchObject({ issue: 42, reason: 'missing-edge-case', caught: 'review' })
    expect(entry.ts).toBeTruthy()

    const rep = run(['report'])
    expect(rep.status).toBe(0)
    expect(rep.stdout).toContain('missing-edge-case')
  })

  it('add rejects invalid taxonomy with exit 1', () => {
    expect(run(['add', '--issue', '1', '--reason', 'vibes', '--caught', 'review']).status).toBe(1)
  })

  it('report on an absent ledger exits 0 with a no-entries note', () => {
    const r = run(['report'])
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/no rework entries/i)
  })

  it('unknown subcommand exits 2', () => {
    expect(run(['frobnicate']).status).toBe(2)
  })
})

describe('ledger is committable in this repo (gitignore negations)', () => {
  it('git does not ignore .arbiter/rework/ledger.jsonl', () => {
    const r = spawnSync('git', ['check-ignore', '.arbiter/rework/ledger.jsonl'], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
    })
    // exit 1 = NOT ignored (that is what we want); exit 0 = ignored (regression)
    expect(r.status).toBe(1)
  })
})
