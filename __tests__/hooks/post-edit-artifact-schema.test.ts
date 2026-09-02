// INV-142: the edit-time artifact schema hook. Its two registered instances are the live ID
// registry and a real evidence directory, so it is declared spawnable:false in the hardness
// manifest — driving it in place would corrupt the SSOT or plant a fixture where INV-139 forbids
// one. These tests observe it the honest way instead: the pure decision logic directly, and the
// script itself against a scratch copy of the repo where nothing real is at risk.
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'
import {
  REGISTERED,
  selectEntry,
  extractDocument,
} from '../../.claude/hooks/post-edit-artifact-schema.mjs'

const ROOT = resolve(import.meta.dirname, '../..')
const REGISTRY_REL = 'docs/internal/SYSTEM/ID-REGISTRY.md'

const created: string[] = []
afterEach(() => {
  for (const d of created.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** A scratch repo carrying only what the hook touches: itself, its libs, the schemas, the doc. */
function scratchRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-artifact-hook-'))
  created.push(dir)
  mkdirSync(join(dir, '.claude/hooks'), { recursive: true })
  mkdirSync(join(dir, 'scripts/lib'), { recursive: true })
  mkdirSync(join(dir, 'docs/internal/SYSTEM'), { recursive: true })
  mkdirSync(join(dir, 'schemas'), { recursive: true })
  cpSync(
    join(ROOT, '.claude/hooks/post-edit-artifact-schema.mjs'),
    join(dir, '.claude/hooks/post-edit-artifact-schema.mjs'),
  )
  cpSync(join(ROOT, '.claude/hooks/lib.mjs'), join(dir, '.claude/hooks/lib.mjs'))
  // The whole lib dir, not just the validator: .claude/hooks/lib.mjs pulls transitive siblings,
  // and chasing that closure by hand would make this fixture rot the next time one is added.
  cpSync(join(ROOT, 'scripts/lib'), join(dir, 'scripts/lib'), { recursive: true })
  cpSync(
    join(ROOT, 'schemas/id-registry.schema.json'),
    join(dir, 'schemas/id-registry.schema.json'),
  )
  cpSync(join(ROOT, REGISTRY_REL), join(dir, REGISTRY_REL))
  return dir
}

function fire(dir: string): { status: number | null; stderr: string } {
  const target = join(dir, REGISTRY_REL)
  const r = spawnSync('node', [join(dir, '.claude/hooks/post-edit-artifact-schema.mjs')], {
    input: JSON.stringify({ tool_input: { file_path: target } }),
    encoding: 'utf-8',
    cwd: dir,
  })
  return { status: r.status, stderr: r.stderr }
}

describe('post-edit-artifact-schema hook (INV-142)', () => {
  it('passes on the registry as committed', () => {
    expect(fire(scratchRepo()).status).toBe(0)
  })

  it('blocks with exit 2 when a required property is missing', () => {
    const dir = scratchRepo()
    const p = join(dir, REGISTRY_REL)
    writeFileSync(p, readFileSync(p, 'utf-8').replace('"prefix": "INV"', '"prefixx": "INV"'))
    const r = fire(dir)
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('INV-142')
  })

  it('blocks with exit 2 when the sentinels are destroyed', () => {
    const dir = scratchRepo()
    const p = join(dir, REGISTRY_REL)
    writeFileSync(p, readFileSync(p, 'utf-8').replace('<!-- ID_REGISTRY_START -->', ''))
    const r = fire(dir)
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('sentinels')
  })

  it('ignores a file no registered entry governs', () => {
    const dir = scratchRepo()
    const other = join(dir, 'docs/internal/SYSTEM/UNRELATED.md')
    writeFileSync(other, 'not an artifact\n')
    const r = spawnSync('node', [join(dir, '.claude/hooks/post-edit-artifact-schema.mjs')], {
      input: JSON.stringify({ tool_input: { file_path: other } }),
      encoding: 'utf-8',
      cwd: dir,
    })
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
  })

  describe('pure decision logic', () => {
    it('selects the entry governing an exact registered path', () => {
      expect(selectEntry(REGISTRY_REL)?.schema).toBe('schemas/id-registry.schema.json')
    })

    it('selects by directory prefix, narrowed by suffix', () => {
      expect(selectEntry('.arbiter/evidence/agent-returns/x.json')).toBeDefined()
      expect(selectEntry('.arbiter/evidence/agent-returns/notes.md')).toBeUndefined()
    })

    it('governs nothing outside the registered set', () => {
      expect(selectEntry('src/cli.ts')).toBeUndefined()
    })

    it('extracts a sentinel-fenced document', () => {
      const entry = { extract: 'sentinel:X' }
      const out = extractDocument(entry, '<!-- X_START -->\n```json\n{"a":1}\n```\n<!-- X_END -->')
      expect(out).toEqual({ ok: true, document: { a: 1 } })
    })

    it('reports missing sentinels rather than throwing', () => {
      const out = extractDocument({ extract: 'sentinel:X' }, 'nothing')
      expect(out.ok).toBe(false)
    })

    it('reports malformed JSON rather than throwing', () => {
      const out = extractDocument({ extract: 'json' }, '{not json')
      expect(out.ok).toBe(false)
    })

    it('registers every instance with a schema and an extract mode', () => {
      for (const e of REGISTERED) {
        expect(e.schema).toMatch(/^schemas\/.*\.schema\.json$/)
        expect(e.extract === 'json' || e.extract.startsWith('sentinel:')).toBe(true)
      }
    })
  })
})
