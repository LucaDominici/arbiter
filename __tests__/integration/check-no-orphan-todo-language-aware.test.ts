// SPDX-License-Identifier: Apache-2.0
// #2663 (P0 review fix): the emitted gate must be language-aware, like sibling
// emitted gates (check-test-naming.mjs.ejs branches per `language`). Before this
// fix the twin hardcoded EXTENSIONS={.ts,.tsx,.mjs,.js} and scanDirs=['src','__tests__'],
// so a Go/Python/Rust/Java project (source outside those roots/extensions) always
// resolved a zero-file scan set and hard-failed via the CANON-24 ABORT branch —
// every non-TS/JS consumer got a permanent red gate for a language it doesn't use.
// Zero files scanned for a language with no matching source yet must also not hard
// fail (NO-DATA convention): PASS with a loud line instead of ABORT.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderGateInto(dir: string, language: string): void {
  mkdirSync(join(dir, 'scripts', 'lib'), { recursive: true })
  const data = makeConfig(dir, { language } as never) as unknown as Record<string, unknown>
  const content = renderTemplate('scripts/check-no-orphan-todo.mjs.ejs', data)
  writeFileSync(join(dir, 'scripts', 'check-no-orphan-todo.mjs'), content)
  // Shared helpers the gate imports — generic, not language-interpolated, so the
  // real repo copies work for any rendered language variant.
  copyFileSync(
    join(__dirname, '..', '..', 'scripts', 'lib', 'glob-walk.mjs'),
    join(dir, 'scripts', 'lib', 'glob-walk.mjs'),
  )
  copyFileSync(
    join(__dirname, '..', '..', 'scripts', 'lib', 'run-helpers.mjs'),
    join(dir, 'scripts', 'lib', 'run-helpers.mjs'),
  )
}

function runGate(dir: string): { status: number | null; stdout: string } {
  const r = spawnSync('node', [join(dir, 'scripts', 'check-no-orphan-todo.mjs')], {
    cwd: dir,
    encoding: 'utf-8',
  })
  return { status: r.status, stdout: String(r.stdout ?? '') }
}

describe('#2663 check-no-orphan-todo.mjs.ejs is language-aware', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arb-2663-lang-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('a Go project (root-level .go files, no src/) is actually scanned, not zero-file ABORTed', () => {
    renderGateInto(dir, 'go')
    writeFileSync(join(dir, 'main.go'), '// ' + 'TO' + 'DO: fix this later\npackage main\n')
    const gate = runGate(dir)
    expect(gate.status).toBe(1)
    expect(gate.stdout).toContain('main.go')
  })

  it('a Go project with only a properly-referenced TODO passes', () => {
    renderGateInto(dir, 'go')
    writeFileSync(join(dir, 'main.go'), '// TODO(#12): fix this later\npackage main\n')
    const gate = runGate(dir)
    expect(gate.status).toBe(0)
  })

  it('NO-DATA: a language with zero matching source files PASSes loudly instead of ABORTing', () => {
    renderGateInto(dir, 'go')
    // No .go files at all under any of the gate's scan roots.
    const gate = runGate(dir)
    expect(gate.status).toBe(0)
    expect(gate.stdout.toLowerCase()).toMatch(/no .*(files|source)|0 file/)
  })

  // #2663 (round 2 review fix): `language: 'multi'` (a polyglot repo) previously fell back to
  // the TypeScript-only default, so a Java file under a nonstandard directory was never
  // scanned — an orphan TODO there was silently ignored, and a repo with zero TS/JS files
  // resolved a false NO-DATA green even with a real Java violation on disk.
  it('multi: a Java orphan TODO under a nonstandard dir is scanned and flagged', () => {
    renderGateInto(dir, 'multi')
    mkdirSync(join(dir, 'services', 'billing'), { recursive: true })
    writeFileSync(
      join(dir, 'services', 'billing', 'Invoice.java'),
      '// ' + 'TO' + 'DO: reconcile totals\npublic class Invoice {}\n',
    )
    const gate = runGate(dir)
    expect(gate.status).toBe(1)
    expect(gate.stdout).toContain('services/billing/Invoice.java')
  })
})
