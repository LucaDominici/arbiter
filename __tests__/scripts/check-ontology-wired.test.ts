// INV-141: the anti-prose meta-gate. Every active scheme must be a wired behaviour, and the
// ratchet must refuse silent growth in the parts that are only described.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'
import { verbTokens, gateWiredIn, countUnwired } from '../../scripts/check-ontology-wired.mjs'

const ROOT = resolve(import.meta.dirname, '../..')
const GATE = join(ROOT, 'scripts/check-ontology-wired.mjs')

const created: string[] = []
afterEach(() => {
  for (const d of created.splice(0)) rmSync(d, { recursive: true, force: true })
})

type Counts = { staged: number; naGate: number; naTool: number; naHook: number }

function fixture(
  schemes: Record<string, unknown>[],
  baseline: Counts = { staged: 0, naGate: 0, naTool: 0, naHook: 9 },
  opts: { wireGate?: boolean; registerHook?: boolean } = {},
): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-ontology-'))
  created.push(dir)
  mkdirSync(join(dir, 'docs/internal/SYSTEM'), { recursive: true })
  mkdirSync(join(dir, 'scripts/data'), { recursive: true })
  mkdirSync(join(dir, 'src/templates/scripts'), { recursive: true })
  mkdirSync(join(dir, 'src/templates/claude'), { recursive: true })
  mkdirSync(join(dir, '.claude/hooks'), { recursive: true })

  writeFileSync(
    join(dir, 'docs/internal/SYSTEM/ID-REGISTRY.md'),
    `<!-- ID_REGISTRY_START -->\n\n\`\`\`json\n${JSON.stringify(
      { registryVersion: '1.0.0', schemes },
      null,
      2,
    )}\n\`\`\`\n\n<!-- ID_REGISTRY_END -->\n`,
  )
  writeFileSync(join(dir, 'scripts/data/ontology-baseline.json'), JSON.stringify(baseline))
  writeFileSync(
    join(dir, 'scripts/check-all.mjs'),
    opts.wireGate === false
      ? '// nothing wired\n'
      : "runCheck('zz', 'node', ['scripts/check-zz.mjs'])\n",
  )
  writeFileSync(join(dir, 'scripts/check-zz.mjs'), '// gate\n')
  writeFileSync(join(dir, 'src/templates/scripts/gate-registry.yml.ejs'), '# roster\n')
  writeFileSync(join(dir, 'src/cli.ts'), ".command('validate')\n")
  writeFileSync(join(dir, '.claude/hooks/zz-hook.mjs'), '// hook\n')
  writeFileSync(
    join(dir, '.claude/settings.json'),
    opts.registerHook === false ? '{}' : '{"hooks":{"PostToolUse":"zz-hook.mjs"}}',
  )
  writeFileSync(join(dir, 'src/templates/claude/settings.json.ejs'), '{}')
  return dir
}

const active = {
  prefix: 'ZZ',
  pattern: '^ZZ-[0-9]{2}$',
  meaning: 'A fixture scheme.',
  ssot: 'scripts/check-zz.mjs',
  gate: 'scripts/check-zz.mjs',
  track: 'self',
  tool: 'arbiter validate',
  hook: '.claude/hooks/zz-hook.mjs',
  status: 'active',
}

function run(dir: string) {
  return spawnSync('node', [GATE, '--dir', dir], { encoding: 'utf-8' })
}

describe('check-ontology-wired.mjs (INV-141)', () => {
  it('passes when an active scheme is wired on every leg', () => {
    const r = run(fixture([active]))
    expect(r.status, r.stderr).toBe(0)
  })

  it('passes against the real repository', () => {
    const r = spawnSync('node', [GATE], { cwd: ROOT, encoding: 'utf-8' })
    expect(r.status, r.stderr).toBe(0)
  })

  it('fails when the gate exists but nothing runs it', () => {
    const r = run(fixture([active], undefined, { wireGate: false }))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('a gate nothing runs is documentation')
  })

  it('fails when the hook exists but is not registered in settings', () => {
    const r = run(fixture([active], undefined, { registerHook: false }))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('an unregistered hook never fires')
  })

  it('fails when the tool names a verb the CLI does not define', () => {
    const r = run(fixture([{ ...active, tool: 'arbiter conjure' }]))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('conjure')
  })

  it('demands the Track-B roster for a target-track scheme, not check-all', () => {
    const r = run(fixture([{ ...active, track: 'target' }]))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('gate-registry.yml.ejs')
  })

  it('exempts a staged row from wiring but counts it against the ratchet', () => {
    const staged = { ...active, status: 'staged', expires: '2027-01-01', note: 'wave 9' }
    expect(run(fixture([staged], { staged: 1, naGate: 0, naTool: 0, naHook: 9 })).status).toBe(0)
    const r = run(fixture([staged], { staged: 0, naGate: 0, naTool: 0, naHook: 9 }))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('ratchet')
  })

  it('errors (exit 2) when the baseline is absent', () => {
    const dir = fixture([active])
    rmSync(join(dir, 'scripts/data/ontology-baseline.json'))
    expect(run(dir).status).toBe(2)
  })

  describe('pure helpers', () => {
    it('verbTokens splits an arbiter verb chain and rejects a non-CLI tool', () => {
      expect(verbTokens('arbiter graph build')).toEqual(['graph', 'build'])
      expect(verbTokens('arbiter validate --json')).toEqual(['validate'])
      expect(verbTokens('n/a')).toBeNull()
    })

    it('gateWiredIn matches on basename so path style cannot fake a miss', () => {
      expect(
        gateWiredIn("runCheck('x','node',['scripts/check-x.mjs'])", 'scripts/check-x.mjs'),
      ).toBe(true)
      expect(gateWiredIn('nothing here', 'scripts/check-x.mjs')).toBe(false)
    })

    it('countUnwired counts staged rows and every n/a leg', () => {
      expect(
        countUnwired([
          { status: 'staged', gate: 'n/a', tool: 'n/a', hook: 'n/a' },
          { status: 'active', gate: 'g', tool: 't', hook: 'n/a' },
        ]),
      ).toEqual({ staged: 1, naGate: 1, naTool: 1, naHook: 2 })
    })
  })
})
