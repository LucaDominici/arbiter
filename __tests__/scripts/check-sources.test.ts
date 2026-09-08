// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for scripts/check-sources.mjs — SOTA source certification, tier 1 (INV-147, #2480 wave 5).
 *
 * RED phase: the module under test does not exist yet, so these fail by construction (#2051).
 *
 * Tier 1 is the deterministic, offline, unfakeable half of the source chain, and it is deliberately
 * the ONLY half enforced here. The question it answers is not "is this source relevant" — that is a
 * judgement, and tier 2 asks a model for it. Tier 1 answers something a machine can settle alone:
 *
 *   does the text this project CLAIMS to be quoting actually appear, verbatim,
 *   in a committed excerpt whose hash matches what was recorded?
 *
 * That is what kills decorative bibliography. A URL in a document proves nothing — the page can
 * change, or never have said it. A quote checked against a hash-pinned committed excerpt cannot be
 * wrong without the gate noticing, and needs no network to check, which is what makes it usable in
 * a pre-commit hook and on a machine with no credentials.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const GATE = resolve('scripts/check-sources.mjs')
const EXCERPT = 'A quoted claim must survive being checked against its own source.\n'
const HASH = createHash('sha256').update(EXCERPT).digest('hex')

function source(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'SRC-001',
    title: 'A source with a checkable claim',
    url: 'https://example.invalid/spec',
    kind: 'docs',
    retrieved_at: '2026-09-04',
    excerpt_path: 'docs/sources/excerpts/SRC-001.txt',
    content_hash: HASH,
    citations: [{ quoted_text: 'must survive being checked against its own source' }],
    selected_by_user: true,
    informs: [],
    application_status: 'cited',
    ...over,
  }
}

describe('check-sources.mjs tier 1 (#2480)', () => {
  let dir: string

  const write = (sources: Array<Record<string, unknown>>, excerpt = EXCERPT): void => {
    mkdirSync(join(dir, 'docs', 'internal', 'PRODUCT'), { recursive: true })
    mkdirSync(join(dir, 'docs', 'sources', 'excerpts'), { recursive: true })
    if (excerpt !== '') {
      writeFileSync(join(dir, 'docs', 'sources', 'excerpts', 'SRC-001.txt'), excerpt)
    }
    writeFileSync(
      join(dir, 'docs', 'internal', 'PRODUCT', 'SOURCES.md'),
      [
        '# Sources',
        '',
        '<!-- SOURCES_START -->',
        '```json',
        JSON.stringify({ sources }, null, 2),
        '```',
        '<!-- SOURCES_END -->',
        '',
      ].join('\n'),
    )
  }
  const run = (): { status: number; out: string } => {
    const r = spawnSync('node', [GATE, '--dir', dir], { encoding: 'utf-8' })
    return { status: r.status ?? -1, out: (r.stdout ?? '') + (r.stderr ?? '') }
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-sources-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('accepts a source whose excerpt hashes correctly and whose quote is literal', () => {
    write([source()])
    const r = run()
    expect(r.status).toBe(0)
    expect(r.out).toMatch(/PASS/)
  })

  it('SKIPs out loud when no SOURCES.md exists — a project need not cite anything', () => {
    const r = run()
    expect(r.status).toBe(0)
    expect(r.out).toMatch(/\[SKIP\]/)
    expect(r.out).not.toMatch(/PASS/)
  })

  it('refuses a quote that is NOT a literal substring of the excerpt', () => {
    write([source({ citations: [{ quoted_text: 'a sentence the source never contained' }] })])
    const r = run()
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/not a literal substring|not found/i)
  })

  it('refuses an excerpt whose hash does not match what was recorded', () => {
    write([source({ content_hash: 'b'.repeat(64) })])
    const r = run()
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/hash/i)
  })

  it('catches the real failure: the excerpt was edited after the hash was taken', () => {
    // The quote still appears, so a substring check alone would pass. Only the hash notices that
    // the committed evidence is no longer the evidence that was recorded.
    write([source()], EXCERPT.replace('checked', 'CHECKED') + 'and an added line\n')
    const r = run()
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/hash/i)
  })

  it('refuses a source whose excerpt file is missing entirely', () => {
    write([source()], '')
    const r = run()
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/excerpt/i)
  })

  it('refuses a duplicate SRC id', () => {
    write([source(), source()])
    const r = run()
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/duplicate/i)
  })

  it('refuses an id outside the registered SRC-NNN pattern', () => {
    write([source({ id: 'SRC-1' })])
    const r = run()
    expect(r.status).toBe(1)
  })

  it('requires at least one citation — a source nobody quotes is a bookmark, not evidence', () => {
    write([source({ citations: [] })])
    const r = run()
    expect(r.status).toBe(1)
  })

  it('exits 2, not 1, when the SOURCES block is unparseable — error is not violation (INV-53)', () => {
    mkdirSync(join(dir, 'docs', 'internal', 'PRODUCT'), { recursive: true })
    writeFileSync(
      join(dir, 'docs', 'internal', 'PRODUCT', 'SOURCES.md'),
      '<!-- SOURCES_START -->\n```json\n{ not json\n```\n<!-- SOURCES_END -->\n',
    )
    expect(run().status).toBe(2)
  })

  it('reports the verdict as JSON under --json, with skip distinguishable from pass', () => {
    const r = spawnSync('node', [GATE, '--dir', dir, '--json'], { encoding: 'utf-8' })
    expect(JSON.parse(r.stdout ?? '{}').verdict).toBe('skip')
  })

  it('is offline by contract: it never reaches the network, even for a live URL', () => {
    // The url field is recorded provenance, not something tier 1 dereferences. Link-liveness is a
    // separate, advisory, networked concern — a gate that fails when a site is down is a gate that
    // fails for reasons unrelated to the claim it guards.
    write([source({ url: 'https://arc42.org/overview/' })])
    const started = Date.now()
    const r = run()
    expect(r.status).toBe(0)
    expect(Date.now() - started).toBeLessThan(10_000)
  })
})
