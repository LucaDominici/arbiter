// SPDX-License-Identifier: Apache-2.0
// #2671 — the emitted check-fe-boundaries.mjs hook must honor an inline
// `arbiter-allow-raw-fetch: <reason>` suppression on the offending line, the
// way Coach's locally-patched copy already did before its adopted render
// dropped the mechanism. Inversion: an unsuppressed raw fetch still fails
// (guard not disarmed), a suppressed one with a real rationale passes, and a
// bare marker with no rationale still fails (rationale-required shape).
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function render(): string {
  const data = makeConfig('/tmp/test', {
    archetype: 'frontend-spa',
    frontend: { framework: 'react' },
  }) as unknown as Record<string, unknown>
  return renderTemplate('scripts/check-fe-boundaries.mjs.ejs', data)
}

function stageDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fe-boundaries-'))
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  mkdirSync(join(dir, 'src', 'entities', 'thing'), { recursive: true })
  writeFileSync(join(dir, 'scripts', 'check-fe-boundaries.mjs'), render())
  return dir
}

function runCheck(dir: string): number {
  return (
    spawnSync('node', [join(dir, 'scripts', 'check-fe-boundaries.mjs')], {
      cwd: dir,
      encoding: 'utf-8',
    }).status ?? 1
  )
}

describe('#2671 emitted check-fe-boundaries honors arbiter-allow-raw-fetch', () => {
  it('still FAILS an unsuppressed raw fetch outside the adapter layer (guard not disarmed)', () => {
    const dir = stageDir()
    try {
      writeFileSync(
        join(dir, 'src', 'entities', 'thing', 'thing.ts'),
        'export async function load() { return fetch("/x") }\n',
      )
      expect(runCheck(dir)).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('PASSES a raw fetch carrying arbiter-allow-raw-fetch with a real rationale', () => {
    const dir = stageDir()
    try {
      writeFileSync(
        join(dir, 'src', 'entities', 'thing', 'thing.ts'),
        'export async function load() { return fetch("/x") } // arbiter-allow-raw-fetch: internal LAN sync snapshot, not JSON\n',
      )
      expect(runCheck(dir)).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('still FAILS a bare arbiter-allow-raw-fetch marker with no rationale (rationale-required)', () => {
    const dir = stageDir()
    try {
      writeFileSync(
        join(dir, 'src', 'entities', 'thing', 'thing.ts'),
        'export async function load() { return fetch("/x") } // arbiter-allow-raw-fetch:\n',
      )
      expect(runCheck(dir)).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('still FAILS a token-only "reason" with no space (10 non-space chars is not a rationale)', () => {
    const dir = stageDir()
    try {
      writeFileSync(
        join(dir, 'src', 'entities', 'thing', 'thing.ts'),
        'export async function load() { return fetch("/x") } // arbiter-allow-raw-fetch: aaaaaaaaaa\n',
      )
      expect(runCheck(dir)).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('still FAILS when the marker sits inside a string literal, not a real // comment', () => {
    const dir = stageDir()
    try {
      writeFileSync(
        join(dir, 'src', 'entities', 'thing', 'thing.ts'),
        'export async function load() { return fetch(url, "// arbiter-allow-raw-fetch: reason words here") }\n',
      )
      expect(runCheck(dir)).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('PASSES a real trailing marker even when an earlier regex literal contains an apostrophe', () => {
    const dir = stageDir()
    try {
      writeFileSync(
        join(dir, 'src', 'entities', 'thing', 'thing.ts'),
        'const re = /it\'s/; export async function load() { return fetch("/x") } // arbiter-allow-raw-fetch: internal LAN sync snapshot\n',
      )
      // RED before the fix: the apostrophe inside /it's/ is read as opening an
      // unterminated string, which swallows the real trailing // comment so the
      // marker is never recognized as sitting in a real comment.
      expect(runCheck(dir)).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('still FAILS when a {} object literal followed by division is misread as a regex, swallowing an in-string marker', () => {
    const dir = stageDir()
    try {
      writeFileSync(
        join(dir, 'src', 'entities', 'thing', 'thing.ts'),
        'export async function load() { return fetch("/x") } const x = {} / "text // arbiter-allow-raw-fetch: reason words here"\n',
      )
      // RED before the fix: `}` in the regex-start predecessor set misclassifies
      // the division after an object literal as opening a regex, which skips
      // straight past the string's opening quote and never registers the
      // in-string marker as being inside a string — wrongly exempting the
      // violation. Division must not open a regex; the marker sits inside a
      // string literal, not a real comment, so it must not qualify.
      expect(runCheck(dir)).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
