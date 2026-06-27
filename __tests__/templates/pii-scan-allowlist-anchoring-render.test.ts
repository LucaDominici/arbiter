// SPDX-License-Identifier: Apache-2.0
// #1669 — the emitted pii-scan.mjs (INV-12, HARD gate, no grace) read its allowlist with permissive
// SUBSTRING matching (entry.file via rel.includes, entry.pattern via matchStr.includes), with the
// only floor being "reject a fully-empty entry". So a single under-specified entry blanket-disabled
// the gate: {"file":"src"} suppressed every finding in the tree, {"pattern":"@"} suppressed every
// email, {"file":"r"} matched unrelated paths by one-char substring containment — an under-reviewed
// kill-switch for a security gate. These render+execute tests prove the broad entries no longer
// suppress a real finding, while a precise (file+line / file+exact-pattern) entry still does.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

// Composed at runtime so this test source carries no literal PII (INV-12 self-hook).
const EMAIL = ['alice', 'corp.example.com'].join('@')

function stage(allowlist: unknown[] | null): { dir: string; scanner: string } {
  const data = makeConfig('/tmp/test', { governanceLevel: 'L2' }) as unknown as Record<
    string,
    unknown
  >
  const dir = mkdtempSync(join(tmpdir(), 'pii-allowlist-'))
  mkdirSync(join(dir, 'src'), { recursive: true })
  // Real, unallowlisted PII on a known line (line 1).
  writeFileSync(join(dir, 'src', 'real.ts'), `export const email = '${EMAIL}'\n`)
  if (allowlist) {
    mkdirSync(join(dir, 'suppressions'), { recursive: true })
    writeFileSync(join(dir, 'suppressions', 'pii-allowlist.json'), JSON.stringify(allowlist))
  }
  const scanner = join(dir, 'pii-scan.mjs')
  writeFileSync(scanner, renderTemplate('scripts/pii-scan.mjs.ejs', data))
  return { dir, scanner }
}

function run(scanner: string, dir: string) {
  return spawnSync('node', [scanner], { cwd: dir, encoding: 'utf-8', timeout: 10_000 })
}

describe('#1669 emitted pii-scan allowlist matches are anchored, not substrings', () => {
  it('control: with no allowlist the real email is a HARD finding (exit 1)', () => {
    const { dir, scanner } = stage(null)
    try {
      expect(run(scanner, dir).status).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.each([
    { name: 'bare file substring {file:"src"}', entry: { file: 'src' } },
    { name: 'one-char file substring {file:"r"}', entry: { file: 'r' } },
    { name: 'pattern substring {pattern:"@"}', entry: { pattern: '@' } },
  ])('does NOT let a broad entry ($name) suppress the finding', ({ entry }) => {
    const { dir, scanner } = stage([entry])
    try {
      // RED before the fix: each broad entry returned exit 0 ("No PII patterns found").
      expect(run(scanner, dir).status).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.each([
    { name: 'exact file + line', entry: { file: 'src/real.ts', line: 1 } },
    { name: 'exact file + exact pattern', entry: { file: 'src/real.ts', pattern: EMAIL } },
    { name: 'exact pattern only', entry: { pattern: EMAIL } },
  ])('still suppresses with a precise entry ($name) → exit 0', ({ entry }) => {
    const { dir, scanner } = stage([entry])
    try {
      expect(run(scanner, dir).status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
