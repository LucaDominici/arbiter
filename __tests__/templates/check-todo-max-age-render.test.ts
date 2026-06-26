// SPDX-License-Identifier: Apache-2.0
// CANON-04 render test (#1456, INV-133): the generated TODO max-age gate must render to an
// executable node script with INV-53 exit codes, and its PURE age logic must work when
// imported — over-age linked TODO → FAIL classification, empty/offline map → SKIP.
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function render(tpl: string, overrides: Record<string, unknown> = {}): string {
  const data = makeConfig('/tmp/test', overrides as never) as unknown as Record<string, unknown>
  return renderTemplate(tpl, data)
}

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 5, 20)

type Gate = {
  isOverAge: (iso: string, nowMs: number, maxAgeDays: number) => boolean
  parseTodoIssueRefs: (s: string) => { issueNumber: number; line: number }[]
  classifyOverAge: (
    refs: { issueNumber: number; line: number }[],
    map: Map<number, string>,
    nowMs: number,
    maxAgeDays: number,
  ) => { skipped: boolean; overAge: unknown[] }
  DEFAULT_MAX_AGE_DAYS: number
}

let gate: Gate
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'todoage-'))
  const file = join(dir, 'check-todo-max-age.mjs')
  writeFileSync(file, render('scripts/check-todo-max-age.mjs.ejs'))
  // The rendered gate imports the shared cycle-safe walker (#1521); stage it alongside,
  // exactly as the generator co-emits scripts/lib/glob-walk.mjs into every project.
  mkdirSync(join(dir, 'lib'), { recursive: true })
  writeFileSync(join(dir, 'lib', 'glob-walk.mjs'), render('scripts/lib/glob-walk.mjs.ejs'))
  gate = (await import(pathToFileURL(file).href)) as unknown as Gate
  rmSync(dir, { recursive: true, force: true })
})

describe('scripts/check-todo-max-age.mjs.ejs — render (#1456)', () => {
  it('renders an executable node gate with shebang and INV-53 exit codes', () => {
    const content = render('scripts/check-todo-max-age.mjs.ejs')
    expect(content.startsWith('#!/usr/bin/env node')).toBe(true)
    expect(content).toContain('process.exit')
    // graceful gh pattern present — derives age from created_at only
    expect(content).toContain('.created_at')
    expect(content).toContain('TODO_MAX_AGE_DAYS')
  })

  it('default max-age is 180 days', () => {
    expect(gate.DEFAULT_MAX_AGE_DAYS).toBe(180)
  })

  it('isOverAge: over-age true, fresh false, unparseable false', () => {
    expect(gate.isOverAge(new Date(NOW - 300 * DAY).toISOString(), NOW, 180)).toBe(true)
    expect(gate.isOverAge(new Date(NOW - 10 * DAY).toISOString(), NOW, 180)).toBe(false)
    expect(gate.isOverAge('', NOW, 180)).toBe(false)
  })

  it('classifyOverAge: over-age linked TODO → FAIL; empty map → SKIP', () => {
    const refs = [{ issueNumber: 1, line: 3 }]
    const old = new Map<number, string>([[1, new Date(NOW - 365 * DAY).toISOString()]])
    expect(gate.classifyOverAge(refs, old, NOW, 180)).toMatchObject({ skipped: false })
    expect(gate.classifyOverAge(refs, old, NOW, 180).overAge).toHaveLength(1)
    expect(gate.classifyOverAge(refs, new Map(), NOW, 180)).toMatchObject({ skipped: true })
  })

  it('parseTodoIssueRefs extracts issue numbers across stacks', () => {
    expect(gate.parseTodoIssueRefs('# TODO(#88): py comment')).toEqual([
      { issueNumber: 88, line: 1 },
    ])
  })
})

describe('check-all.mjs wiring (#1456)', () => {
  // The runCheck wiring line is language-agnostic plain text inside the L2 runtime
  // block (not an EJS conditional), so it is present for every stack. Assert against
  // the template source — robust to the many computed render fields the L2 block needs.
  it('wires the todo max-age gate at L2 (runCheck, INV-133)', () => {
    const src = readFileSync(
      join(import.meta.dirname, '..', '..', 'src', 'templates', 'scripts', 'check-all.mjs.ejs'),
      'utf-8',
    )
    expect(src).toMatch(/runCheck\('todo max-age \(INV-133\)'[^\n]*check-todo-max-age\.mjs/)
  })
})
