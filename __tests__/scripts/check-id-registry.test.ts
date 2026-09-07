// INV-140: the ID registry is well-formed, collision-free, and its citations resolve.
// Each case drives the real gate over a fixture repo and asserts the exit code, because a
// registry gate that has never been seen to go red is a gate nobody knows works.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'
import {
  extractJsonBlock,
  sampleFromPattern,
  findCollisions,
} from '../../scripts/check-id-registry.mjs'

const ROOT = resolve(import.meta.dirname, '../..')
const GATE = join(ROOT, 'scripts/check-id-registry.mjs')

const created: string[] = []
afterEach(() => {
  for (const d of created.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** A minimal repo carrying a registry with one scheme, plus the OD registry it resolves against. */
function fixture(schemes: unknown[], odIds: string[] = ['OD-14']): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-id-registry-'))
  created.push(dir)
  const sysDir = join(dir, 'docs/internal/SYSTEM')
  mkdirSync(sysDir, { recursive: true })
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  writeFileSync(join(dir, 'scripts/placeholder-gate.mjs'), '// gate\n')
  writeFileSync(
    join(sysDir, 'ID-REGISTRY.md'),
    `# reg\n\n<!-- ID_REGISTRY_START -->\n\n\`\`\`json\n${JSON.stringify(
      { registryVersion: '1.0.0', schemes },
      null,
      2,
    )}\n\`\`\`\n\n<!-- ID_REGISTRY_END -->\n`,
  )
  writeFileSync(
    join(sysDir, 'OD-REGISTRY.md'),
    `# od\n\n<!-- OD_REGISTRY_START -->\n\n\`\`\`json\n${JSON.stringify({
      registryVersion: '1.0.0',
      decisions: odIds.map((id) => ({ id })),
    })}\n\`\`\`\n\n<!-- OD_REGISTRY_END -->\n`,
  )
  return dir
}

function scheme(over: Record<string, unknown> = {}) {
  return {
    prefix: 'ZZ',
    pattern: '^ZZ-[0-9]{2}$',
    meaning: 'A fixture scheme used only by this test.',
    ssot: 'scripts/placeholder-gate.mjs',
    gate: 'scripts/placeholder-gate.mjs',
    track: 'self',
    tool: 'arbiter validate',
    hook: 'n/a',
    status: 'active',
    note: 'Fixture row; hook is n/a because nothing edits it.',
    ...over,
  }
}

function run(dir: string, ...extra: string[]) {
  return spawnSync('node', [GATE, '--dir', dir, ...extra], { encoding: 'utf-8' })
}

describe('check-id-registry.mjs (INV-140)', () => {
  it('passes on a well-formed registry', () => {
    const r = run(fixture([scheme()]))
    expect(r.status, r.stderr).toBe(0)
  })

  it('passes against the real repository', () => {
    const r = spawnSync('node', [GATE], { cwd: ROOT, encoding: 'utf-8' })
    expect(r.status, r.stderr).toBe(0)
  })

  it('rejects two schemes claiming one prefix — the historical MN collision', () => {
    const r = run(fixture([scheme(), scheme({ meaning: 'A second claimant on the same prefix.' })]))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('claimed twice')
  })

  it('rejects a pattern not anchored on its own prefix', () => {
    const r = run(fixture([scheme({ pattern: '^QQ-[0-9]{2}$' })]))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('not anchored on its own prefix')
  })

  it('rejects an OD citation with no row in the OD registry', () => {
    const dir = fixture([scheme()], ['OD-14'])
    // id-registry:ignore-citation — the fixture id below is the subject of the assertion, not a
    // citation of a real owner decision.
    writeFileSync(join(dir, 'docs/internal/SYSTEM/NOTES.md'), `We decided this per OD-77.\n`) // id-registry:ignore-citation
    const r = run(dir)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('OD-77') // id-registry:ignore-citation
  })

  it('rejects a staged row whose expiry has passed', () => {
    const dir = fixture([scheme({ status: 'staged', expires: '2026-01-01' })])
    const r = run(dir, '--today=2026-06-01')
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('has passed')
  })

  it('accepts a staged row whose expiry is still ahead', () => {
    const dir = fixture([scheme({ status: 'staged', expires: '2027-01-01' })])
    const r = run(dir, '--today=2026-06-01')
    expect(r.status, r.stderr).toBe(0)
  })

  it('rejects an n/a leg with no reason', () => {
    const dir = fixture([scheme({ tool: 'n/a', note: undefined })])
    const r = run(dir)
    expect(r.status).toBe(1)
  })

  it('rejects a missing SSOT on an active row', () => {
    const r = run(fixture([scheme({ ssot: 'docs/does-not-exist.md' })]))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('does not exist')
  })

  it('errors (exit 2) when the registry block is absent', () => {
    const dir = fixture([scheme()])
    writeFileSync(join(dir, 'docs/internal/SYSTEM/ID-REGISTRY.md'), '# no sentinels here\n')
    expect(run(dir).status).toBe(2)
  })

  describe('pure helpers', () => {
    it('extractJsonBlock reads the fenced payload between sentinels', () => {
      const out = extractJsonBlock(
        'a\n<!-- X_START -->\n```json\n{"a":1}\n```\n<!-- X_END -->',
        'X',
      )
      expect(out).toEqual({ ok: true, value: { a: 1 } })
    })

    it('extractJsonBlock reports a missing sentinel rather than throwing', () => {
      expect(extractJsonBlock('nothing', 'X').ok).toBe(false)
    })

    it('sampleFromPattern expands the shapes the registry uses', () => {
      expect(sampleFromPattern('^INV-[0-9]{2,3}$')).toBe('INV-00')
      expect(sampleFromPattern('^GA-[A-Z]+-[0-9]{2}$')).toBe('GA-A-00')
      expect(sampleFromPattern('^E[0-9]{1,2}[a-z]?$')).toBe('E0')
    })

    it('sampleFromPattern refuses a pattern it cannot expand, rather than guessing', () => {
      expect(sampleFromPattern('^(A|B)-[0-9]$')).toBeNull()
    })

    it('findCollisions catches a broad pattern swallowing another scheme', () => {
      const v = findCollisions([
        { prefix: 'A', pattern: '^A[A-Z]?-[0-9]{2}$', meaning: 'broad' },
        { prefix: 'AB', pattern: '^AB-[0-9]{2}$', meaning: 'narrow' },
      ])
      expect(v.join('\n')).toContain('collision')
    })
  })
})
