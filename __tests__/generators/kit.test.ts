// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateKitDocs } from '../../src/generators/kit.js'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let outDir: string

beforeEach(() => {
  outDir = mkdtempSync(join(tmpdir(), 'arbiter-kit-gen-'))
})

afterEach(() => {
  rmSync(outDir, { recursive: true, force: true })
})

// ─── Greenfield ───────────────────────────────────────────────────────────────

describe('greenfield generation', () => {
  it('emits exactly 76 dim-*.md files', () => {
    generateKitDocs({ outDir })
    const dimFiles = readdirSync(outDir).filter((f) => /^dim-\d{2}-/.test(f) && f.endsWith('.md'))
    expect(dimFiles.length).toBe(76)
  })

  it('emits exactly one GLOBAL_KIT.md', () => {
    generateKitDocs({ outDir })
    expect(existsSync(join(outDir, 'GLOBAL_KIT.md'))).toBe(true)
  })

  it('result.written has 77 entries (76 dims + GLOBAL_KIT)', () => {
    const result = generateKitDocs({ outDir })
    expect(result.written.length).toBe(77)
    expect(result.skipped.length).toBe(0)
  })

  it('every dim file starts with a valid hash marker line', () => {
    generateKitDocs({ outDir })
    const dimFiles = readdirSync(outDir).filter((f) => /^dim-\d{2}-/.test(f) && f.endsWith('.md'))
    const markerRe = /^<!-- arbiter-generated dim=\S+ hash=[0-9a-f]{64} generator=\S+ -->$/
    for (const f of dimFiles) {
      const firstLine = readFileSync(join(outDir, f), 'utf-8').split('\n')[0]
      expect(markerRe.test(firstLine), `${f} missing valid marker: ${firstLine}`).toBe(true)
    }
  })

  it('GLOBAL_KIT.md starts with a valid hash marker', () => {
    generateKitDocs({ outDir })
    const firstLine = readFileSync(join(outDir, 'GLOBAL_KIT.md'), 'utf-8').split('\n')[0]
    expect(firstLine).toMatch(
      /^<!-- arbiter-generated dim=GLOBAL_KIT hash=[0-9a-f]{64} generator=\S+ -->$/,
    )
  })

  it('each dim file contains its dim ID', () => {
    generateKitDocs({ outDir })
    const dimFiles = readdirSync(outDir).filter((f) => /^dim-\d{2}-/.test(f) && f.endsWith('.md'))
    for (const f of dimFiles) {
      const content = readFileSync(join(outDir, f), 'utf-8')
      // filename is dim-NN-<slug>.md; extract NN to get id N01..N76
      const match = f.match(/^dim-(\d{2})-/)
      if (match) {
        const id = `N${parseInt(match[1], 10).toString().padStart(2, '0')}`
        expect(content, `${f} missing ${id}`).toContain(id)
      }
    }
  })
})

// ─── Brownfield: skip user-edited files ───────────────────────────────────────

describe('brownfield — user edit detected', () => {
  it('skips file with modified body (hash mismatch)', () => {
    generateKitDocs({ outDir })
    // Find first dim file
    const dimFile = readdirSync(outDir).find((f) => /^dim-01-/.test(f))!
    const filePath = join(outDir, dimFile)
    const original = readFileSync(filePath, 'utf-8')
    // Append user edit after marker
    writeFileSync(filePath, original + '\n<!-- user edit -->\n')

    const result = generateKitDocs({ outDir })
    expect(result.skipped).toContain(dimFile)
    expect(result.written).not.toContain(dimFile)
    // User edit still present
    expect(readFileSync(filePath, 'utf-8')).toContain('<!-- user edit -->')
  })

  it('overwrites user-edited file with --force', () => {
    generateKitDocs({ outDir })
    const dimFile = readdirSync(outDir).find((f) => /^dim-01-/.test(f))!
    const filePath = join(outDir, dimFile)
    writeFileSync(filePath, readFileSync(filePath, 'utf-8') + '\n<!-- user edit -->\n')

    const result = generateKitDocs({ outDir, force: true })
    expect(result.written).toContain(dimFile)
    expect(readFileSync(filePath, 'utf-8')).not.toContain('<!-- user edit -->')
  })
})

// ─── Brownfield: pristine file (hash match) ───────────────────────────────────

describe('brownfield — pristine file', () => {
  it('overwrites pristine file on regenerate (hash matches = safe)', () => {
    generateKitDocs({ outDir })
    const dimFile = readdirSync(outDir).find((f) => /^dim-01-/.test(f))!

    // Second run: pristine file gets overwritten cleanly
    const result2 = generateKitDocs({ outDir })
    expect(result2.written).toContain(dimFile)
    expect(result2.skipped).not.toContain(dimFile)
  })
})

// ─── Brownfield: no marker ────────────────────────────────────────────────────

describe('brownfield — no marker', () => {
  it('skips file with no marker line', () => {
    generateKitDocs({ outDir })
    const dimFile = readdirSync(outDir).find((f) => /^dim-01-/.test(f))!
    const filePath = join(outDir, dimFile)
    // Replace with a file that has no marker
    writeFileSync(filePath, '# user-managed file\n\nNo marker here.\n')

    const result = generateKitDocs({ outDir })
    expect(result.skipped).toContain(dimFile)
    expect(readFileSync(filePath, 'utf-8')).toContain('user-managed file')
  })

  it('overwrites no-marker file with --force', () => {
    generateKitDocs({ outDir })
    const dimFile = readdirSync(outDir).find((f) => /^dim-01-/.test(f))!
    const filePath = join(outDir, dimFile)
    writeFileSync(filePath, '# user-managed file\n\nNo marker here.\n')

    const result = generateKitDocs({ outDir, force: true })
    expect(result.written).toContain(dimFile)
    expect(readFileSync(filePath, 'utf-8')).not.toContain('user-managed file')
  })
})

// ─── Idempotency ─────────────────────────────────────────────────────────────

describe('idempotency', () => {
  it('second run produces byte-identical files for all dims', () => {
    generateKitDocs({ outDir })
    const after1 = readdirSync(outDir)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .map((f) => ({ f, content: readFileSync(join(outDir, f), 'utf-8') }))

    generateKitDocs({ outDir })
    const after2 = readdirSync(outDir)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .map((f) => ({ f, content: readFileSync(join(outDir, f), 'utf-8') }))

    expect(after2.length).toBe(after1.length)
    for (let i = 0; i < after1.length; i++) {
      expect(after2[i].content, `${after1[i].f} not idempotent`).toBe(after1[i].content)
    }
  })
})

// ─── Prune ────────────────────────────────────────────────────────────────────

describe('--prune flag', () => {
  it('reports pruned and pruneProtected in result', () => {
    generateKitDocs({ outDir })
    // Plant a pristine orphan (simulate a renamed dim)
    // We need a valid marker + hash. Since the file content is self-consistent,
    // just copy an existing dim file with a new name.
    const dimFiles = readdirSync(outDir).filter((f) => /^dim-\d{2}-/.test(f))
    const src = join(outDir, dimFiles[0])
    const orphanName = 'dim-99-orphan-dim.md'
    writeFileSync(join(outDir, orphanName), readFileSync(src, 'utf-8'))

    const result = generateKitDocs({ outDir, prune: true })
    // Orphan should be pruned (it has a valid marker, body matches hash)
    expect(result.pruned).toContain(orphanName)
    expect(existsSync(join(outDir, orphanName))).toBe(false)
  })

  it('reports non-pristine orphan as pruneProtected (not deleted)', () => {
    generateKitDocs({ outDir })
    // Plant an orphan with mismatched hash (user-edited)
    const orphanName = 'dim-98-orphan-user-edited.md'
    writeFileSync(
      join(outDir, orphanName),
      '<!-- arbiter-generated dim=N98 hash=0000000000000000000000000000000000000000000000000000000000000000 generator=kit@1 -->\n# N98: User edited\n',
    )

    const result = generateKitDocs({ outDir, prune: true })
    expect(result.pruneProtected).toContain(orphanName)
    expect(existsSync(join(outDir, orphanName))).toBe(true)
  })
})
