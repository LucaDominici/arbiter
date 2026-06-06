// SPDX-License-Identifier: Apache-2.0
// __tests__/scripts/gen-doc-helpers.test.ts
// TDD tests for scripts/lib/gen-doc-helpers.mjs — shared helpers for gen-*.mjs scripts.

import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { fmField, readdirSafe, prettify } from '../../scripts/lib/gen-doc-helpers.mjs'

describe('fmField()', () => {
  it('extracts a plain frontmatter value', () => {
    const content = `---\nlast_review: '2026-06-01'\nstatus: active\n---\n`
    expect(fmField(content, 'last_review')).toBe('2026-06-01')
  })

  it('extracts an unquoted frontmatter value', () => {
    const content = `status: active\nowner: alice\n`
    expect(fmField(content, 'owner')).toBe('alice')
  })

  it('returns null when key is absent', () => {
    const content = `---\nstatus: active\n---\n`
    expect(fmField(content, 'last_review')).toBeNull()
  })

  it('trims surrounding whitespace from the value', () => {
    const content = `doc_version:   1.0.0  \n`
    expect(fmField(content, 'doc_version')).toBe('1.0.0')
  })
})

describe('readdirSafe()', () => {
  it('returns an array for a readable directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'readdirSafe-test-'))
    try {
      const result = readdirSafe(dir)
      expect(Array.isArray(result)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns [] for a non-existent directory (no throw)', () => {
    expect(readdirSafe('/does/not/exist/ever')).toEqual([])
  })

  it('lists files when directory has contents', () => {
    const dir = mkdtempSync(join(tmpdir(), 'readdirSafe-test-'))
    try {
      mkdirSync(join(dir, 'sub'))
      const result = readdirSafe(dir)
      expect(result).toContain('sub')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('prettify()', () => {
  it('returns a Promise (async contract)', async () => {
    const raw = '# Hello\n\nworld\n'
    const promise = prettify(raw, '/tmp/dummy.md')
    expect(promise).toBeInstanceOf(Promise)
    const result = await promise
    expect(typeof result).toBe('string')
  })

  it('formats a heading-only markdown string to a non-empty string', async () => {
    const raw = '# Test\n'
    const result = await prettify(raw, '/tmp/dummy.md')
    expect(result.trim().length).toBeGreaterThan(0)
  })

  it('result contains the original content (no data loss)', async () => {
    const raw = '# Title\n\nSome content here.\n'
    const result = await prettify(raw, '/tmp/dummy.md')
    expect(result).toContain('Title')
    expect(result).toContain('Some content here')
  })
})
