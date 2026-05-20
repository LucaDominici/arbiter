// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(new URL('../..', import.meta.url).pathname)
const SCRIPT = join(REPO_ROOT, 'scripts/check-doc-style.mjs')

function runScript(cwd: string): { status: number; stdout: string } {
  try {
    const stdout = execFileSync('node', [SCRIPT], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { status: 0, stdout }
  } catch (e) {
    const err = e as { status?: number; stdout?: string }
    return { status: err.status ?? 1, stdout: err.stdout ?? '' }
  }
}

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'check-doc-style-'))
  mkdirSync(join(tmp, 'docs'), { recursive: true })
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

const FULL_FRONTMATTER = `---
title: 'X'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# X
`

describe('check-doc-style — passes', () => {
  it('exits 0 when a doc has complete frontmatter and one H1', () => {
    writeFileSync(join(tmp, 'docs', 'ok.md'), FULL_FRONTMATTER)
    const r = runScript(tmp)
    expect(r.status).toBe(0)
  })
})

describe('check-doc-style — hard errors', () => {
  it('exits 1 when frontmatter is missing entirely', () => {
    writeFileSync(join(tmp, 'docs', 'bare.md'), '# Bare\n\nNo frontmatter.\n')
    const r = runScript(tmp)
    expect(r.status).toBe(1)
    expect(r.stdout).toMatch(/missing frontmatter block/)
  })

  it('exits 1 when last_review is not ISO date', () => {
    const bad = FULL_FRONTMATTER.replace(`last_review: '2026-05-20'`, `last_review: '20-05-2026'`)
    writeFileSync(join(tmp, 'docs', 'baddate.md'), bad)
    const r = runScript(tmp)
    expect(r.status).toBe(1)
    expect(r.stdout).toMatch(/not ISO date/)
  })

  it('exits 1 when doc_version is not semver', () => {
    const bad = FULL_FRONTMATTER.replace(`doc_version: '1.0.0'`, `doc_version: 'v1'`)
    writeFileSync(join(tmp, 'docs', 'badver.md'), bad)
    const r = runScript(tmp)
    expect(r.status).toBe(1)
    expect(r.stdout).toMatch(/not semver/)
  })

  it('exits 1 when a required frontmatter key is missing', () => {
    const partial = `---
title: 'Y'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
---

# Y
`
    writeFileSync(join(tmp, 'docs', 'partial.md'), partial)
    const r = runScript(tmp)
    expect(r.status).toBe(1)
    expect(r.stdout).toMatch(/missing frontmatter key/)
  })
})

describe('check-doc-style — soft warnings (still exit 0)', () => {
  it('warns on non-canonical status but exits 0', () => {
    const warnish = FULL_FRONTMATTER.replace(`status: active`, `status: CURRENT`)
    writeFileSync(join(tmp, 'docs', 'warn.md'), warnish)
    const r = runScript(tmp)
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/non-canonical status/)
  })

  it('warns when no H1 is present but exits 0', () => {
    const noH1 = `---
title: 'Z'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

No heading body.
`
    writeFileSync(join(tmp, 'docs', 'no-h1.md'), noH1)
    const r = runScript(tmp)
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/no H1 heading/)
  })
})
