/**
 * CANON-15 promotion (#1923): a template that emits a linter / security-scanner /
 * architecture-boundary config file must also emit the gate step that invokes it.
 * A config file with no gate invocation is a paper rule — no CI runner enforces it.
 *
 * Until now this was prose, checked at PR review; the CANON-parity gate gave it a
 * dated promotion (`promotion: #1923 by 2026-08-29`). This is that gate.
 *
 * Scope (the three CANON-15 artifact-class directories): every `.ejs` under
 * src/templates/{boundaries,static-analysis,security} must be declared in
 * scripts/canon15-config-gates.json and mapped either to a gate id that really
 * exists in the gate registry, or to `null` with a reason. Directory-scoped
 * discovery is what makes the gate self-extending: a NEW config template forces a
 * decision instead of passing silently.
 */
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-canon15-wired-gate.mjs')

function write(root: string, rel: string, body: string): void {
  const target = join(root, rel)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, body)
}

interface MapEntry {
  template: string
  gate: string | null
  reason?: string
}

/** Synthetic repo: one boundary-config template, a registry, and a declaration map. */
function makeRoot(opts: {
  templates?: string[]
  registryGates?: string[]
  map?: MapEntry[]
}): string {
  const dir = mkdtempSync(join(tmpdir(), 'canon15-test-'))
  for (const t of opts.templates ?? []) write(dir, `src/templates/${t}`, '// config\n')
  const gates = opts.registryGates ?? []
  write(
    dir,
    'src/templates/scripts/gate-registry.yml.ejs',
    gates.map((id) => `  - { id: ${id}, name: ${id}, level: L2, kind: check }`).join('\n') + '\n',
  )
  write(dir, 'scripts/canon15-config-gates.json', JSON.stringify(opts.map ?? [], null, 2))
  return dir
}

function run(root: string) {
  const r = spawnSync('node', [SCRIPT, '--root', root], { encoding: 'utf-8' })
  return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

const dirs: string[] = []
function fixture(opts: Parameters<typeof makeRoot>[0]): string {
  const d = makeRoot(opts)
  dirs.push(d)
  return d
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('check-canon15-wired-gate (CANON-15, #1923)', () => {
  it('passes when every config template maps to a gate that exists in the registry', () => {
    const root = fixture({
      templates: ['boundaries/eslint.config.boundaries.mjs.ejs'],
      registryGates: ['ts-boundaries'],
      map: [{ template: 'boundaries/eslint.config.boundaries.mjs.ejs', gate: 'ts-boundaries' }],
    })
    const { status, out } = run(root)
    expect(status, out).toBe(0)
  })

  it('fails when a config template is emitted but its gate id is in no registry entry', () => {
    const root = fixture({
      templates: ['boundaries/eslint.config.boundaries.mjs.ejs'],
      registryGates: ['lint'],
      map: [{ template: 'boundaries/eslint.config.boundaries.mjs.ejs', gate: 'ts-boundaries' }],
    })
    const { status, out } = run(root)
    expect(status).toBe(1)
    expect(out).toContain('ts-boundaries')
    expect(out).toContain('eslint.config.boundaries.mjs.ejs')
  })

  it('fails when a config template is not declared at all (completeness ratchet)', () => {
    const root = fixture({
      templates: [
        'boundaries/eslint.config.boundaries.mjs.ejs',
        'security/brand-new-scanner.toml.ejs',
      ],
      registryGates: ['ts-boundaries'],
      map: [{ template: 'boundaries/eslint.config.boundaries.mjs.ejs', gate: 'ts-boundaries' }],
    })
    const { status, out } = run(root)
    expect(status).toBe(1)
    expect(out).toContain('security/brand-new-scanner.toml.ejs')
  })

  it('accepts a reasoned no-gate declaration (not every emitted file is a gated config)', () => {
    const root = fixture({
      templates: ['security/STRIDE.md.ejs'],
      registryGates: [],
      map: [
        {
          template: 'security/STRIDE.md.ejs',
          gate: null,
          reason: 'Threat-model document, not a scanner config — nothing to invoke.',
        },
      ],
    })
    expect(run(root).status).toBe(0)
  })

  it('rejects a no-gate declaration with no reason (silent carve-out)', () => {
    const root = fixture({
      templates: ['security/STRIDE.md.ejs'],
      registryGates: [],
      map: [{ template: 'security/STRIDE.md.ejs', gate: null }],
    })
    const { status, out } = run(root)
    expect(status).toBe(1)
    expect(out).toContain('STRIDE.md.ejs')
  })

  it('fails on a dead declaration whose template no longer exists', () => {
    const root = fixture({
      templates: [],
      registryGates: ['ts-boundaries'],
      map: [{ template: 'boundaries/deleted.mjs.ejs', gate: 'ts-boundaries' }],
    })
    const { status, out } = run(root)
    expect(status).toBe(1)
    expect(out).toContain('boundaries/deleted.mjs.ejs')
  })

  it("passes on arbiter's own tree — every shipped config template is gated or reasoned", () => {
    const r = spawnSync('node', [SCRIPT], { encoding: 'utf-8' })
    expect(r.status, `${r.stdout ?? ''}${r.stderr ?? ''}`).toBe(0)
  })
})
