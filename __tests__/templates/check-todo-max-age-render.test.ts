// SPDX-License-Identifier: Apache-2.0
// CANON-04 render test (#1456, INV-133): the generated TODO max-age gate must render to an
// executable node script with INV-53 exit codes, and its PURE age logic must work when
// imported — over-age linked TODO → FAIL classification, empty/offline map → SKIP.
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync, chmodSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { renderTemplate, renderFromAbsPath } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function render(tpl: string, overrides: Record<string, unknown> = {}): string {
  const data = makeConfig('/tmp/test', overrides as never) as unknown as Record<string, unknown>
  return renderTemplate(tpl, data)
}

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 5, 20)
// #2526's precedent: build the marker at runtime so this file testing the TO-DO-age machinery
// does not itself inflate the debt ratchet's todoCount collector.
const M = 'TO' + 'DO'

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
    // #2041: the gate is declared in the DECLARATIVE registry (gate-registry.yml.ejs)
    // at L2 — the runCheck call is emitted from it, no longer inline in check-all.mjs.ejs.
    const registrySrc = readFileSync(
      join(import.meta.dirname, '..', '..', 'src', 'templates', 'scripts', 'gate-registry.yml.ejs'),
      'utf-8',
    )
    expect(registrySrc).toMatch(/todo-max-age[^\n]*level: L2/)
    expect(registrySrc).toContain('check-todo-max-age.mjs')
  })
})

// ── Rendered-artifact CLI inversion proofs (#2561, CANON-24) ───────────────────────────────────
// An `.ejs` cannot be executed directly, so every proof below RENDERS the template to a real
// `.mjs` file and spawns it as a subprocess — a test that merely greps the `.ejs` source for the
// string `resolve(` would pass while proving nothing about the emitted script's behaviour.
//
// #2561 root defect: `join(baseDir, dir)` at the scan-dir call site does NOT reset on an absolute
// `dir` (unlike resolve()), so `join('/repo', '/tmp/fixture/src')` silently becomes
// '/repo/tmp/fixture/src' — a path that (almost certainly) does not exist. The gate then scanned
// nothing, found zero TODO(#NNN) refs, and printed "no TODO(#NNN) references — PASS": the exact
// conflation of "nothing found" with "nothing looked at". Identical to #2526's fix for arbiter's
// own scripts/check-todo-max-age.mjs, ported here to the emitted template.
//
// gh/git are stubbed with tiny fake executables placed first on PATH — no live network or auth
// needed, and no case here can pass by silently falling through to the offline-SKIP path.
function makeFakeBin(createdAtByIssue: Record<number, string> = {}): {
  bin: string
  cleanup: () => void
} {
  const bin = mkdtempSync(join(tmpdir(), 'todo-age-tpl-bin-'))
  const fakeGit = join(bin, 'git')
  writeFileSync(
    fakeGit,
    [
      '#!/bin/sh',
      'if [ "$1" = "remote" ]; then echo "https://github.com/testowner/testrepo.git"; exit 0; fi',
      'exit 1',
      '',
    ].join('\n'),
  )
  chmodSync(fakeGit, 0o755)
  const cases = Object.entries(createdAtByIssue)
    .map(([n, iso]) => `    */issues/${n}) echo '${iso}' ;;`)
    .join('\n')
  const fakeGh = join(bin, 'gh')
  writeFileSync(
    fakeGh,
    ['#!/bin/sh', 'case "$2" in', cases, '    *) echo "" ;;', 'esac', ''].join('\n'),
  )
  chmodSync(fakeGh, 0o755)
  return { bin, cleanup: () => rmSync(bin, { recursive: true, force: true }) }
}

/** Plant `source` as the gate at <dir>/scripts/check-todo-max-age.mjs, alongside its co-emitted
 * glob-walk lib dependency — exactly as the generator emits both into every project. */
function plantGate(dir: string, source: string): string {
  mkdirSync(join(dir, 'scripts', 'lib'), { recursive: true })
  const p = join(dir, 'scripts', 'check-todo-max-age.mjs')
  writeFileSync(p, source)
  writeFileSync(
    join(dir, 'scripts', 'lib', 'glob-walk.mjs'),
    render('scripts/lib/glob-walk.mjs.ejs'),
  )
  return p
}

function runGate(gate: string, cwd: string, bin: string, scanDirArg: string | undefined) {
  const args = scanDirArg === undefined ? [gate] : [gate, scanDirArg]
  const r = spawnSync('node', args, {
    encoding: 'utf-8',
    cwd,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

describe('scripts/check-todo-max-age.mjs.ejs — rendered CLI inversion proofs (#2561)', () => {
  it('FAILS and names the file: rendered gate pointed at an ABSOLUTE dir with an over-age TODO(#NNN)', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'todo-age-tpl-cwd-'))
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'todo-age-tpl-fixture-'))
    const old = new Date(NOW - 300 * DAY).toISOString()
    const { bin, cleanup: cleanupBin } = makeFakeBin({ 900: old })
    try {
      mkdirSync(join(fixtureRoot, 'src'), { recursive: true })
      writeFileSync(
        join(fixtureRoot, 'src', 'bad.ts'),
        `// ${M}(#900): resolve this eventually\nexport const a = 1\n`,
      )
      const gate = plantGate(cwd, render('scripts/check-todo-max-age.mjs.ejs'))
      const result = runGate(gate, cwd, bin, join(fixtureRoot, 'src'))
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('FAIL')
      expect(result.stdout).toContain(`${M}(#900)`)
      expect(result.stdout).toContain('bad.ts')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
      rmSync(fixtureRoot, { recursive: true, force: true })
      cleanupBin()
    }
  })

  it('PASSES: rendered gate pointed at a CLEAN absolute dir, having actually scanned it', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'todo-age-tpl-cwd-'))
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'todo-age-tpl-fixture-'))
    const fresh = new Date(NOW - 10 * DAY).toISOString()
    const { bin, cleanup: cleanupBin } = makeFakeBin({ 901: fresh })
    try {
      mkdirSync(join(fixtureRoot, 'src'), { recursive: true })
      writeFileSync(
        join(fixtureRoot, 'src', 'ok.ts'),
        `// ${M}(#901): fine for now\nexport const a = 1\n`,
      )
      const gate = plantGate(cwd, render('scripts/check-todo-max-age.mjs.ejs'))
      const result = runGate(gate, cwd, bin, join(fixtureRoot, 'src'))
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('PASS')
      expect(result.stdout).toMatch(/scanned 1 file/i)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
      rmSync(fixtureRoot, { recursive: true, force: true })
      cleanupBin()
    }
  })

  it('ABORTS (never passes): rendered gate pointed at a nonexistent or empty absolute dir', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'todo-age-tpl-cwd-'))
    const { bin, cleanup: cleanupBin } = makeFakeBin({})
    const missing = join(tmpdir(), `todo-age-tpl-missing-${process.pid}-${Date.now()}`)
    const emptyDir = mkdtempSync(join(tmpdir(), 'todo-age-tpl-empty-'))
    try {
      const gate = plantGate(cwd, render('scripts/check-todo-max-age.mjs.ejs'))

      const missingResult = runGate(gate, cwd, bin, missing)
      expect(missingResult.status).toBe(1)
      expect(missingResult.stdout).toContain('ABORT')
      expect(missingResult.stdout).toMatch(/scanned 0 file/i)

      const emptyResult = runGate(gate, cwd, bin, emptyDir)
      expect(emptyResult.status).toBe(1)
      expect(emptyResult.stdout).toContain('ABORT')
      expect(emptyResult.stdout).toMatch(/scanned 0 file/i)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
      rmSync(emptyDir, { recursive: true, force: true })
      cleanupBin()
    }
  })

  // Anchor proof: the PRE-#2561 rendered template — a byte-for-byte snapshot of this template as
  // it shipped before this fix, in __tests__/fixtures/templates/ — must NOT catch the exact same
  // planted over-age TODO(#NNN) that the proof above catches. This is what ties the render tests
  // above to the real historical defect rather than to an invented harness: a passing suite here
  // proves the fix changed real behaviour, not just template text.
  it('is anchored to the real defect: the PRE-#2561 rendered template did NOT catch the same case', () => {
    const preFixTemplatePath = join(
      import.meta.dirname,
      '..',
      'fixtures',
      'templates',
      'check-todo-max-age.pre-2561.mjs.ejs',
    )
    const data = makeConfig('/tmp/test', {} as never) as unknown as Record<string, unknown>
    const preFixSource = renderFromAbsPath(preFixTemplatePath, data)
    // Sanity: the anchor fixture really is the un-fixed shape (join, no filesScanned assertion).
    expect(preFixSource).not.toContain('resolve(baseDir, dir)')
    expect(preFixSource).not.toContain('ABORT')

    const cwd = mkdtempSync(join(tmpdir(), 'todo-age-tpl-precwd-'))
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'todo-age-tpl-prefixture-'))
    const old = new Date(NOW - 300 * DAY).toISOString()
    const { bin, cleanup: cleanupBin } = makeFakeBin({ 902: old })
    try {
      mkdirSync(join(fixtureRoot, 'src'), { recursive: true })
      writeFileSync(
        join(fixtureRoot, 'src', 'bad.ts'),
        `// ${M}(#902): resolve this eventually\nexport const a = 1\n`,
      )
      const gate = plantGate(cwd, preFixSource)
      const result = runGate(gate, cwd, bin, join(fixtureRoot, 'src'))
      // The defect: it silently PASSES instead of FAILing on the very same over-age planted TODO.
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('no TODO(#NNN) references')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
      rmSync(fixtureRoot, { recursive: true, force: true })
      cleanupBin()
    }
  })
})
