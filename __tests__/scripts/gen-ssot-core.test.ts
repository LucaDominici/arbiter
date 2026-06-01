// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
// @ts-expect-error — plain .mjs gate script, no type declarations
import { selectSsotDocs, buildInventory, runCli } from '../../scripts/gen-ssot-core.mjs'

function makeRepo(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'gen-ssot-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function writeDoc(dir: string, relPath: string, fm: Record<string, string>): void {
  const abs = join(dir, relPath)
  mkdirSync(join(abs, '..'), { recursive: true })
  const front = Object.entries(fm)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
  writeFileSync(abs, `---\n${front}\n---\n\n# ${relPath}\n`)
}

describe('gen-ssot-core selectSsotDocs (#1100)', () => {
  it('includes active backbone-kind docs, excludes draft / non-backbone', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeDoc(dir, 'docs/METHOD/A.md', { status: 'active', tags: "['kind/method']" })
      writeDoc(dir, 'docs/GOVERNANCE/B.md', { status: 'active', tags: "['kind/governance']" })
      writeDoc(dir, 'docs/METHOD/DRAFT.md', { status: 'draft', tags: "['kind/method']" })
      writeDoc(dir, 'docs/REFERENCE/REF.md', { status: 'active', tags: "['kind/reference']" })
      const paths = selectSsotDocs(dir).map((r: { relPath: string }) => r.relPath)
      expect(paths).toContain('docs/METHOD/A.md')
      expect(paths).toContain('docs/GOVERNANCE/B.md')
      expect(paths).not.toContain('docs/METHOD/DRAFT.md')
      expect(paths).not.toContain('docs/REFERENCE/REF.md')
    } finally {
      cleanup()
    }
  })

  it('excludes ADRs (owned by INV-107) and dim-NN coverage stubs', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeDoc(dir, 'docs/ADR/001-x.md', {
        status: 'active',
        tags: "['kind/adr']",
        canonical_id: '001',
      })
      writeDoc(dir, 'docs/REFERENCE/coverage/dim-01-x.md', {
        status: 'active',
        tags: "['kind/reference']",
      })
      const paths = selectSsotDocs(dir).map((r: { relPath: string }) => r.relPath)
      expect(paths).not.toContain('docs/ADR/001-x.md')
      expect(paths).not.toContain('docs/REFERENCE/coverage/dim-01-x.md')
    } finally {
      cleanup()
    }
  })

  it('includes a non-backbone doc that carries a non-empty canonical_id', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeDoc(dir, 'docs/api/README.md', {
        status: 'active',
        tags: "['kind/reference']",
        canonical_id: 'api',
      })
      const paths = selectSsotDocs(dir).map((r: { relPath: string }) => r.relPath)
      expect(paths).toContain('docs/api/README.md')
    } finally {
      cleanup()
    }
  })

  it('keys backbone membership on the FIRST kind/* tag, not any tag', () => {
    // Guards the first-vs-any semantic of firstKind(): a doc whose first kind tag
    // is non-backbone is excluded even if a later tag is backbone, and vice versa.
    const { dir, cleanup } = makeRepo()
    try {
      writeDoc(dir, 'docs/REFERENCE/ref-first.md', {
        status: 'active',
        tags: "['kind/reference', 'kind/method']",
      })
      writeDoc(dir, 'docs/METHOD/method-first.md', {
        status: 'active',
        tags: "['kind/method', 'kind/reference']",
      })
      const paths = selectSsotDocs(dir).map((r: { relPath: string }) => r.relPath)
      expect(paths).not.toContain('docs/REFERENCE/ref-first.md') // reference first → excluded
      expect(paths).toContain('docs/METHOD/method-first.md') // method first → included
    } finally {
      cleanup()
    }
  })
})

describe('gen-ssot-core buildInventory (#1100)', () => {
  it('groups by kind with stable section order and sorted paths (deterministic)', () => {
    const records = [
      { relPath: 'docs/METHOD/Z.md', kind: 'method', title: 'Z' },
      { relPath: 'docs/METHOD/A.md', kind: 'method', title: 'A' },
      { relPath: 'docs/GOVERNANCE/G.md', kind: 'governance', title: 'G' },
    ]
    const out1 = buildInventory(records)
    const out2 = buildInventory([...records].reverse())
    expect(out1).toBe(out2) // order-independent → deterministic
    // Governance section precedes Method section
    expect(out1.indexOf('### Governance')).toBeLessThan(out1.indexOf('### Method'))
    // Paths sorted within a group
    expect(out1.indexOf('docs/METHOD/A.md')).toBeLessThan(out1.indexOf('docs/METHOD/Z.md'))
  })
})

describe('gen-ssot-core runCli --check (#1100)', () => {
  it('reports stale when the generated region is out of date', async () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeDoc(dir, 'docs/METHOD/NEW.md', { status: 'active', tags: "['kind/method']" })
      const ssot = join(dir, 'docs', 'METHOD', 'SSOT_CORE_SET.md')
      // markers present but region empty → stale vs the NEW.md on disk
      writeFileSync(
        ssot,
        '# SSOT\n\n<!-- BEGIN GENERATED INVENTORY -->\n<!-- END GENERATED INVENTORY -->\n',
      )
      const checkCode = await runCli(dir, ssot, true)
      expect(checkCode).toBe(1)
      // write mode heals it, then --check passes
      const writeCode = await runCli(dir, ssot, false)
      expect(writeCode).toBe(0)
      expect(readFileSync(ssot, 'utf-8')).toContain('docs/METHOD/NEW.md')
      expect(await runCli(dir, ssot, true)).toBe(0)
    } finally {
      cleanup()
    }
  })
})

describe('gen-ssot-core hardening (#1100 review)', () => {
  it('includes a doc for every backbone kind (guards BACKBONE_KINDS completeness)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      const kinds = ['ssot', 'governance', 'spine', 'canon', 'api', 'setup', 'method']
      for (const k of kinds) {
        writeDoc(dir, `docs/K/${k}.md`, { status: 'active', tags: `['kind/${k}']` })
      }
      const got = selectSsotDocs(dir).map((r: { relPath: string }) => r.relPath)
      for (const k of kinds) {
        expect(got, `kind/${k} should qualify`).toContain(`docs/K/${k}.md`)
      }
    } finally {
      cleanup()
    }
  })

  it('excludes a coverage/ stub even when it carries a backbone kind (non-vacuous exclusion)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeDoc(dir, 'docs/REFERENCE/coverage/dim-01-x.md', {
        status: 'active',
        tags: "['kind/method']", // backbone kind → would qualify if not for the coverage/ guard
      })
      const got = selectSsotDocs(dir).map((r: { relPath: string }) => r.relPath)
      expect(got).not.toContain('docs/REFERENCE/coverage/dim-01-x.md')
    } finally {
      cleanup()
    }
  })

  it('fails (exit 1) when the marker pair is missing — no fail-open', async () => {
    const { dir, cleanup } = makeRepo()
    try {
      const ssot = join(dir, 'docs', 'METHOD', 'SSOT_CORE_SET.md')
      mkdirSync(join(dir, 'docs', 'METHOD'), { recursive: true })
      writeFileSync(ssot, '# SSOT\n\nNo markers here.\n')
      expect(await runCli(dir, ssot, true)).toBe(1)
      expect(await runCli(dir, ssot, false)).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('fails (exit 1) when duplicate marker pairs are present', async () => {
    const { dir, cleanup } = makeRepo()
    try {
      const ssot = join(dir, 'docs', 'METHOD', 'SSOT_CORE_SET.md')
      mkdirSync(join(dir, 'docs', 'METHOD'), { recursive: true })
      writeFileSync(
        ssot,
        '# SSOT\n\n<!-- BEGIN GENERATED INVENTORY -->\n<!-- END GENERATED INVENTORY -->\n\n<!-- BEGIN GENERATED INVENTORY -->\n<!-- END GENERATED INVENTORY -->\n',
      )
      expect(await runCli(dir, ssot, false)).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('returns 0 in bootstrap mode when SSOT_CORE_SET.md is absent', async () => {
    const { dir, cleanup } = makeRepo()
    try {
      const ssot = join(dir, 'docs', 'METHOD', 'SSOT_CORE_SET.md')
      expect(await runCli(dir, ssot, true)).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('is stable (idempotent) for doc titles containing markdown emphasis', async () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeDoc(dir, 'docs/METHOD/EMPH.md', {
        status: 'active',
        tags: "['kind/method']",
        title: "'*Foo* _bar_ | baz'",
      })
      const ssot = join(dir, 'docs', 'METHOD', 'SSOT_CORE_SET.md')
      writeFileSync(
        ssot,
        '# SSOT\n\n<!-- BEGIN GENERATED INVENTORY -->\n<!-- END GENERATED INVENTORY -->\n',
      )
      expect(await runCli(dir, ssot, false)).toBe(0)
      // Second generate is byte-identical → --check passes (no self-collision).
      expect(await runCli(dir, ssot, true)).toBe(0)
    } finally {
      cleanup()
    }
  })
})
