// SPDX-License-Identifier: Apache-2.0
// #1991: src/utils/fs.ts is the sole write façade across ALL of src/.
//
// Supersedes two narrower guards that between them left most of src/ unwatched:
//   * scripts/check-no-direct-fs-in-generators.mjs — full write-op set, src/generators/ only
//   * __tests__/commands/canon17-writefile-migration.test.ts (#1733) — writeFileSync only,
//     top-level src/commands/*.ts only, single-quoted import shapes only, no recursion
// Every shape those two miss is asserted below, because each one is a live bypass.
import { describe, it, expect, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const SCRIPT = resolve('scripts/check-no-direct-fs.mjs')

const roots: string[] = []
afterEach(() => {
  for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** A fake repo root with `src/<rel>` files. */
function fixture(files: Record<string, string>, allowlist?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'no-direct-fs-'))
  roots.push(root)
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, body)
  }
  if (allowlist !== undefined) writeFileSync(join(root, '.no-direct-fs-allowlist'), allowlist)
  return root
}

function run(root: string): { status: number | null; out: string } {
  const r = spawnSync('node', [SCRIPT, '--root', root], { encoding: 'utf-8' })
  return { status: r.status, out: `${r.stdout}${r.stderr}` }
}

const FUTURE = '2099-01-01'
const PAST = '2000-01-01'

describe('check-no-direct-fs.mjs — detection (#1991)', () => {
  it('flags a NESTED, ALIASED, DOUBLE-QUOTED violation — the shape all prior guards miss', () => {
    const root = fixture({
      'src/commands/doctor/x.ts': 'import { writeFileSync as w } from "node:fs"\nw("a", "b")\n',
    })
    const { status, out } = run(root)
    expect(status).toBe(1)
    expect(out).toContain('src/commands/doctor/x.ts')
  })

  it('flags every op in the declared set', () => {
    for (const op of [
      'writeFileSync',
      'mkdirSync',
      'copyFileSync',
      'appendFileSync',
      'renameSync',
    ]) {
      const root = fixture({ 'src/a.ts': `import { ${op} } from 'node:fs'\n` })
      expect(run(root).status, op).toBe(1)
    }
  })

  it('flags namespace and default imports used for a write call', () => {
    for (const imp of ["import * as fs from 'node:fs'", "import fs from 'node:fs'"]) {
      const root = fixture({ 'src/a.ts': `${imp}\nfs.writeFileSync('a', 'b')\n` })
      expect(run(root).status, imp).toBe(1)
    }
  })

  it('flags node:fs/promises writes (prospective — zero such imports today)', () => {
    const root = fixture({ 'src/a.ts': "import { writeFile } from 'node:fs/promises'\n" })
    expect(run(root).status).toBe(1)
  })

  it('does not flag read-only ops, which have no façade to route through', () => {
    const root = fixture({
      'src/a.ts': "import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'\n",
    })
    expect(run(root).status).toBe(0)
  })

  it('does not flag src/templates/ — those are EJS sources for consumer repos', () => {
    const root = fixture({ 'src/templates/x.ts': "import { writeFileSync } from 'node:fs'\n" })
    expect(run(root).status).toBe(0)
  })

  it('does not flag the façade itself', () => {
    const root = fixture({ 'src/utils/fs.ts': "import { writeFileSync } from 'node:fs'\n" })
    expect(run(root).status).toBe(0)
  })
})

describe('check-no-direct-fs.mjs — dated allowlist contract (#1991)', () => {
  const violating = { 'src/a.ts': "import { writeFileSync } from 'node:fs'\n" }

  it('a pin with a FUTURE EXPIRES suppresses the violation', () => {
    const root = fixture(violating, `src/a.ts  EXPIRES: ${FUTURE}  # justified\n`)
    expect(run(root).status).toBe(0)
  })

  it('a pin with NO EXPIRES fails — an undated pin is a permanent bypass', () => {
    const root = fixture(violating, 'src/a.ts  # justified\n')
    const { status, out } = run(root)
    expect(status).toBe(1)
    expect(out).toMatch(/EXPIRES/)
  })

  it('a pin with a malformed date fails rather than being read as absent', () => {
    const root = fixture(violating, 'src/a.ts  EXPIRES: soon  # justified\n')
    expect(run(root).status).toBe(1)
  })

  it('an EXPIRED pin fails — the whole point of dating it', () => {
    const root = fixture(violating, `src/a.ts  EXPIRES: ${PAST}  # justified\n`)
    const { status, out } = run(root)
    expect(status).toBe(1)
    expect(out).toMatch(/laps|expir/i)
  })

  it('a STALE pin fails — a path that no longer violates must be removed, not left to rot', () => {
    const root = fixture(
      { 'src/a.ts': "import { readFileSync } from 'node:fs'\n" },
      `src/a.ts  EXPIRES: ${FUTURE}  # justified\n`,
    )
    const { status, out } = run(root)
    expect(status).toBe(1)
    expect(out).toMatch(/stale|no longer/i)
  })

  it('a pin with no reason fails — a bare path explains nothing', () => {
    const root = fixture(violating, `src/a.ts  EXPIRES: ${FUTURE}\n`)
    expect(run(root).status).toBe(1)
  })
})

describe('check-no-direct-fs.mjs — the real tree (#1991)', () => {
  it("arbiter's own src/ passes with its committed allowlist", () => {
    const r = spawnSync('node', [SCRIPT], { encoding: 'utf-8' })
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(0)
  })
})
