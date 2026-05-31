// SPDX-License-Identifier: Apache-2.0
// __tests__/scripts/gen-doc-index.test.ts
// First test suite for the doc-index generator (#1102 Obsidian enrichment).
// Tests: exported collectDocs() + buildIndex() + --check CLI mode.

import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
// These imports will fail until gen-doc-index.mjs exports the functions (RED phase).
import { collectDocs, buildIndex } from '../../scripts/gen-doc-index.mjs'

const SCRIPT = resolve('scripts/gen-doc-index.mjs')

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'gen-doc-index-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** Build a minimal doc with frontmatter. */
function fmDoc(title: string, status = 'active', kindTag = 'kind/adr'): string {
  return (
    `---\ntitle: '${title}'\ndoc_version: '1.0.0'\n` +
    `status: ${status}\nlast_review: '2026-01-01'\nowner: 'team'\n` +
    `canonical_id: ''\ntags: ['audience/dev', '${kindTag}']\nrelated: []\n---\n\n` +
    `# ${title}\n`
  )
}

// ---------------------------------------------------------------------------
// collectDocs()
// ---------------------------------------------------------------------------

describe('collectDocs()', () => {
  it('returns one record per .md file under docsDir', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const docs = join(dir, 'docs')
      mkdirSync(join(docs, 'ADR'), { recursive: true })
      writeFileSync(join(docs, 'ADR', 'adr-001.md'), fmDoc('ADR 001'))
      writeFileSync(join(docs, 'CHANNELS.md'), fmDoc('Channels', 'active', 'kind/setup'))
      const records = collectDocs(docs, join(docs, 'INDEX.md'))
      expect(records).toHaveLength(2)
    } finally {
      cleanup()
    }
  })

  it('excludes INDEX.md itself from the collected records', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const docs = join(dir, 'docs')
      mkdirSync(docs, { recursive: true })
      const index = join(docs, 'INDEX.md')
      writeFileSync(index, '# Index\n')
      writeFileSync(join(docs, 'FOO.md'), fmDoc('Foo'))
      const records = collectDocs(docs, index)
      expect(records.every((r) => !r.relPath.includes('INDEX.md'))).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('surfaces title from frontmatter', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const docs = join(dir, 'docs')
      mkdirSync(docs, { recursive: true })
      writeFileSync(join(docs, 'FOO.md'), fmDoc('My Doc', 'draft', 'kind/runbook'))
      const [rec] = collectDocs(docs, join(docs, 'INDEX.md'))
      expect(rec.title).toBe('My Doc')
    } finally {
      cleanup()
    }
  })

  it('surfaces status from frontmatter', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const docs = join(dir, 'docs')
      mkdirSync(docs, { recursive: true })
      writeFileSync(join(docs, 'FOO.md'), fmDoc('My Doc', 'draft', 'kind/runbook'))
      const [rec] = collectDocs(docs, join(docs, 'INDEX.md'))
      expect(rec.status).toBe('draft')
    } finally {
      cleanup()
    }
  })

  it('surfaces the kind/* tag from frontmatter tags array', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const docs = join(dir, 'docs')
      mkdirSync(docs, { recursive: true })
      writeFileSync(join(docs, 'FOO.md'), fmDoc('My Doc', 'active', 'kind/runbook'))
      const [rec] = collectDocs(docs, join(docs, 'INDEX.md'))
      expect(rec.kind).toBe('kind/runbook')
    } finally {
      cleanup()
    }
  })

  it('returns relPath relative to docsDir (not full absolute path)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const docs = join(dir, 'docs')
      mkdirSync(join(docs, 'ADR'), { recursive: true })
      writeFileSync(join(docs, 'ADR', 'adr-001.md'), fmDoc('ADR 001'))
      const [rec] = collectDocs(docs, join(docs, 'INDEX.md'))
      expect(rec.relPath).toBe('ADR/adr-001.md')
    } finally {
      cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// buildIndex()
// ---------------------------------------------------------------------------

describe('buildIndex()', () => {
  it('emits real markdown links, not backtick-wrapped paths', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const docs = join(dir, 'docs')
      mkdirSync(join(docs, 'ADR'), { recursive: true })
      writeFileSync(join(docs, 'ADR', 'adr-001.md'), fmDoc('ADR 001'))
      const records = collectDocs(docs, join(docs, 'INDEX.md'))
      const output = buildIndex(records)
      expect(output).toContain('[ADR 001](ADR/adr-001.md)')
      expect(output).not.toMatch(/`ADR\//)
    } finally {
      cleanup()
    }
  })

  it('groups docs under ## section headings by top-level directory', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const docs = join(dir, 'docs')
      mkdirSync(join(docs, 'ADR'), { recursive: true })
      mkdirSync(join(docs, 'SYSTEM'), { recursive: true })
      writeFileSync(join(docs, 'ADR', 'adr-001.md'), fmDoc('ADR 001'))
      writeFileSync(join(docs, 'SYSTEM', 'CANON.md'), fmDoc('Canon', 'active', 'kind/canon'))
      const records = collectDocs(docs, join(docs, 'INDEX.md'))
      const output = buildIndex(records)
      expect(output).toContain('## ADR')
      expect(output).toContain('## SYSTEM')
    } finally {
      cleanup()
    }
  })

  it('surfaces status in the section table', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const docs = join(dir, 'docs')
      mkdirSync(docs, { recursive: true })
      writeFileSync(join(docs, 'FOO.md'), fmDoc('Foo', 'draft', 'kind/runbook'))
      const records = collectDocs(docs, join(docs, 'INDEX.md'))
      const output = buildIndex(records)
      expect(output).toContain('draft')
    } finally {
      cleanup()
    }
  })

  it('surfaces kind/* tag in the section table', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const docs = join(dir, 'docs')
      mkdirSync(docs, { recursive: true })
      writeFileSync(join(docs, 'FOO.md'), fmDoc('Foo', 'active', 'kind/runbook'))
      const records = collectDocs(docs, join(docs, 'INDEX.md'))
      const output = buildIndex(records)
      expect(output).toContain('kind/runbook')
    } finally {
      cleanup()
    }
  })

  it('document count in the header matches the record count', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const docs = join(dir, 'docs')
      mkdirSync(join(docs, 'ADR'), { recursive: true })
      writeFileSync(join(docs, 'ADR', 'a.md'), fmDoc('A'))
      writeFileSync(join(docs, 'ADR', 'b.md'), fmDoc('B'))
      writeFileSync(join(docs, 'FOO.md'), fmDoc('Foo'))
      const records = collectDocs(docs, join(docs, 'INDEX.md'))
      const output = buildIndex(records)
      expect(output).toContain('3 documents.')
    } finally {
      cleanup()
    }
  })

  it('is idempotent — same records produce identical output', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const docs = join(dir, 'docs')
      mkdirSync(join(docs, 'ADR'), { recursive: true })
      writeFileSync(join(docs, 'ADR', 'adr-001.md'), fmDoc('ADR 001'))
      const records = collectDocs(docs, join(docs, 'INDEX.md'))
      expect(buildIndex(records)).toBe(buildIndex(records))
    } finally {
      cleanup()
    }
  })

  it('places root-level docs (directly under docs/) under a ## docs section', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const docs = join(dir, 'docs')
      mkdirSync(docs, { recursive: true })
      writeFileSync(join(docs, 'CHANNELS.md'), fmDoc('Channels'))
      const records = collectDocs(docs, join(docs, 'INDEX.md'))
      const output = buildIndex(records)
      expect(output).toContain('## docs')
    } finally {
      cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// CLI --check mode (via spawnSync, cwd = temp dir so repoRoot = temp dir)
// ---------------------------------------------------------------------------

describe('gen-doc-index --check CLI', () => {
  it('exits 1 and emits "stale" when INDEX.md is out of date', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const docs = join(dir, 'docs')
      mkdirSync(docs, { recursive: true })
      writeFileSync(join(docs, 'FOO.md'), fmDoc('Foo'))
      writeFileSync(join(docs, 'INDEX.md'), '# stale content\n')
      const result = spawnSync('node', [SCRIPT, '--check'], { encoding: 'utf-8', cwd: dir })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('stale')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when INDEX.md is up to date', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const docs = join(dir, 'docs')
      mkdirSync(docs, { recursive: true })
      writeFileSync(join(docs, 'FOO.md'), fmDoc('Foo'))
      // Generate index first (write mode), then verify (check mode)
      spawnSync('node', [SCRIPT], { encoding: 'utf-8', cwd: dir })
      const result = spawnSync('node', [SCRIPT, '--check'], { encoding: 'utf-8', cwd: dir })
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })
})
