// #2554 — a `track: both` row could not say "gate on both tracks, hook on self only": the
// `hook` column was single-valued, so MS/EP had to decline a claim (`hook: n/a`) that was only
// half true. The hook column now also accepts a per-track object `{ self, target }`, each leg
// independently a path or 'n/a'; the plain string remains the shorthand for "same on both sides".
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')
const ID_REGISTRY_GATE = join(ROOT, 'scripts/check-id-registry.mjs')
const ONTOLOGY_GATE = join(ROOT, 'scripts/check-ontology-wired.mjs')

const created: string[] = []
afterEach(() => {
  for (const d of created.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** A minimal repo carrying a registry with one scheme, plus the OD registry it resolves against. */
function idRegistryFixture(schemes: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-id-registry-hook-'))
  created.push(dir)
  const sysDir = join(dir, 'docs/internal/SYSTEM')
  mkdirSync(sysDir, { recursive: true })
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  writeFileSync(join(dir, 'scripts/placeholder-gate.mjs'), '// gate\n')
  writeFileSync(join(dir, 'scripts/placeholder-hook.mjs'), '// hook\n')
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
      decisions: [],
    })}\n\`\`\`\n\n<!-- OD_REGISTRY_END -->\n`,
  )
  return dir
}

function bothScheme(over: Record<string, unknown> = {}) {
  return {
    prefix: 'ZZ',
    pattern: '^ZZ-[0-9]{2}$',
    meaning: 'A fixture scheme used only by this test.',
    ssot: 'scripts/placeholder-gate.mjs',
    gate: 'scripts/placeholder-gate.mjs',
    track: 'both',
    tool: 'arbiter check',
    hook: { self: 'scripts/placeholder-hook.mjs', target: 'n/a' },
    status: 'active',
    note: 'Fixture: the hook governs the self-repo instance only, no emitted twin exists.',
    ...over,
  }
}

function runIdRegistry(dir: string) {
  return spawnSync('node', [ID_REGISTRY_GATE, '--dir', dir], { encoding: 'utf-8' })
}

describe('id-registry hook column: per-track shape (#2554)', () => {
  it('schema accepts a `both` row whose hook is a per-track object', () => {
    const r = runIdRegistry(idRegistryFixture([bothScheme()]))
    expect(r.status, r.stderr).toBe(0)
  })

  it('schema rejects a hook object missing the `target` leg', () => {
    const r = runIdRegistry(
      idRegistryFixture([bothScheme({ hook: { self: 'scripts/placeholder-hook.mjs' } })]),
    )
    expect(r.status).toBe(1)
  })

  it('schema rejects a hook object with an unknown leg name', () => {
    const r = runIdRegistry(
      idRegistryFixture([
        bothScheme({
          hook: { self: 'scripts/placeholder-hook.mjs', target: 'n/a', emitted: 'n/a' },
        }),
      ]),
    )
    expect(r.status).toBe(1)
  })

  it('rejects a per-track hook leg naming a path that does not exist', () => {
    const r = runIdRegistry(
      idRegistryFixture([
        bothScheme({ hook: { self: 'scripts/does-not-exist.mjs', target: 'n/a' } }),
      ]),
    )
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('does not exist')
  })

  it('resolves a real target leg against its emitted Track-B template, not the self-repo path (#2554 P2)', () => {
    const dir = idRegistryFixture([
      bothScheme({
        hook: { self: '.claude/hooks/zz-hook.mjs', target: '.claude/hooks/zz-hook.mjs' },
      }),
    ])
    mkdirSync(join(dir, '.claude/hooks'), { recursive: true })
    mkdirSync(join(dir, 'src/templates/claude/hooks'), { recursive: true })
    writeFileSync(join(dir, '.claude/hooks/zz-hook.mjs'), '// self hook\n')
    writeFileSync(join(dir, 'src/templates/claude/hooks/zz-hook.mjs'), '// emitted hook\n')
    expect(runIdRegistry(dir).status).toBe(0)
  })

  it('fails a real target leg when only the self-repo copy exists, not the emitted twin', () => {
    const dir = idRegistryFixture([
      bothScheme({
        hook: { self: '.claude/hooks/zz-hook.mjs', target: '.claude/hooks/zz-hook.mjs' },
      }),
    ])
    mkdirSync(join(dir, '.claude/hooks'), { recursive: true })
    writeFileSync(join(dir, '.claude/hooks/zz-hook.mjs'), '// self hook only\n')
    const r = runIdRegistry(dir)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('Track-B template')
  })

  // generateClaudeHooks (src/generators/claude.ts) EJS-renders some hooks per name rather than
  // copying them verbatim (e.g. pre-edit-plan-anchor.mjs.ejs, a real template in this repo). A
  // target leg naming such a hook must resolve to its `.ejs` twin (#2554, round 2).
  it('resolves a real target leg against an `.ejs`-rendered Track-B template', () => {
    const dir = idRegistryFixture([
      bothScheme({
        hook: { self: '.claude/hooks/zz-hook.mjs', target: '.claude/hooks/zz-hook.mjs' },
      }),
    ])
    mkdirSync(join(dir, '.claude/hooks'), { recursive: true })
    mkdirSync(join(dir, 'src/templates/claude/hooks'), { recursive: true })
    writeFileSync(join(dir, '.claude/hooks/zz-hook.mjs'), '// self hook\n')
    writeFileSync(join(dir, 'src/templates/claude/hooks/zz-hook.mjs.ejs'), '// rendered hook\n')
    expect(runIdRegistry(dir).status).toBe(0)
  })

  it('fails a real target leg when neither the raw nor the `.ejs` Track-B template exists', () => {
    const dir = idRegistryFixture([
      bothScheme({
        hook: { self: '.claude/hooks/zz-hook.mjs', target: '.claude/hooks/zz-hook.mjs' },
      }),
    ])
    mkdirSync(join(dir, '.claude/hooks'), { recursive: true })
    writeFileSync(join(dir, '.claude/hooks/zz-hook.mjs'), '// self hook only\n')
    const r = runIdRegistry(dir)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('Track-B template')
  })
})

describe('check-ontology-wired.mjs: per-track hook resolution (#2554)', () => {
  function ontologyFixture(
    schemes: Record<string, unknown>[],
    baseline = { staged: 0, naGate: 0, naTool: 0, naHook: 9 },
    opts: {
      registerSelfHook?: boolean
      writeTargetHookTemplate?: boolean
      targetHookIsEjs?: boolean
      registerTargetHook?: boolean
    } = {},
  ): string {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-ontology-hook-'))
    created.push(dir)
    mkdirSync(join(dir, 'docs/internal/SYSTEM'), { recursive: true })
    mkdirSync(join(dir, 'scripts/data'), { recursive: true })
    mkdirSync(join(dir, 'src/templates/scripts'), { recursive: true })
    mkdirSync(join(dir, 'src/templates/claude/hooks'), { recursive: true })
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
      "runCheck('zz', 'node', ['scripts/check-zz.mjs'])\n",
    )
    writeFileSync(join(dir, 'scripts/check-zz.mjs'), '// gate\n')
    writeFileSync(
      join(dir, 'src/templates/scripts/gate-registry.yml.ejs'),
      '# roster\nscripts/check-zz.mjs\n',
    )
    writeFileSync(join(dir, 'src/cli.ts'), ".command('check')\n")
    writeFileSync(join(dir, '.claude/hooks/zz-hook.mjs'), '// hook\n')
    writeFileSync(
      join(dir, '.claude/settings.json'),
      opts.registerSelfHook === false ? '{}' : '{"hooks":{"PostToolUse":"zz-hook.mjs"}}',
    )
    if (opts.writeTargetHookTemplate !== false) {
      const templateName = opts.targetHookIsEjs ? 'zz-hook.mjs.ejs' : 'zz-hook.mjs'
      writeFileSync(join(dir, 'src/templates/claude/hooks', templateName), '// emitted hook\n')
    }
    writeFileSync(
      join(dir, 'src/templates/claude/settings.json.ejs'),
      opts.registerTargetHook === false ? '{}' : '{"hooks":{"PostToolUse":"zz-hook.mjs"}}',
    )
    return dir
  }

  const bothTrackHookRow = {
    prefix: 'ZZ',
    pattern: '^ZZ-[0-9]{2}$',
    meaning: 'A fixture scheme.',
    ssot: 'scripts/check-zz.mjs',
    gate: 'scripts/check-zz.mjs',
    track: 'both',
    tool: 'arbiter check',
    hook: { self: '.claude/hooks/zz-hook.mjs', target: 'n/a' },
    status: 'active',
  }

  function run(dir: string) {
    return spawnSync('node', [ONTOLOGY_GATE, '--dir', dir], { encoding: 'utf-8' })
  }

  it('passes a `both` row whose hook fires on self and is declined on target', () => {
    const r = run(ontologyFixture([bothTrackHookRow]))
    expect(r.status, r.stderr).toBe(0)
  })

  it('fails when the self leg is required but not registered in settings', () => {
    const r = run(ontologyFixture([bothTrackHookRow], undefined, { registerSelfHook: false }))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('an unregistered hook never fires')
  })

  it('does not demand the target leg when it is declined n/a', () => {
    const r = run(ontologyFixture([bothTrackHookRow]))
    expect(r.stderr).not.toContain('TARGET_SETTINGS')
    expect(r.status, r.stderr).toBe(0)
  })

  const bothLegsWiredRow = {
    ...bothTrackHookRow,
    hook: { self: '.claude/hooks/zz-hook.mjs', target: '.claude/hooks/zz-hook.mjs' },
  }

  it('passes when a real target leg resolves to its emitted Track-B template (#2554 P2)', () => {
    const r = run(ontologyFixture([bothLegsWiredRow]))
    expect(r.status, r.stderr).toBe(0)
  })

  it('fails a real target leg whose emitted Track-B template does not exist', () => {
    const r = run(
      ontologyFixture([bothLegsWiredRow], undefined, { writeTargetHookTemplate: false }),
    )
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('does not exist')
    expect(r.stderr).toContain('Track-B template')
  })

  it('fails a real target leg whose emitted template exists but is unregistered on the target side', () => {
    const r = run(ontologyFixture([bothLegsWiredRow], undefined, { registerTargetHook: false }))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('CANON-10/CANON-14')
  })

  // generateClaudeHooks (src/generators/claude.ts) EJS-renders some hooks (e.g.
  // pre-edit-plan-anchor.mjs.ejs) and raw-copies others (e.g. check-no-unused-exports.mjs) —
  // real templates of both shapes exist under src/templates/claude/hooks/ today. A target leg
  // naming an EJS-backed hook must resolve to its `.ejs` twin, not just the raw one (#2554,
  // round 2).
  it('passes a target leg backed by a real `.ejs`-rendered hook template', () => {
    const r = run(ontologyFixture([bothLegsWiredRow], undefined, { targetHookIsEjs: true }))
    expect(r.status, r.stderr).toBe(0)
  })

  it('fails a target leg when neither the raw nor the `.ejs` template exists', () => {
    const r = run(
      ontologyFixture([bothLegsWiredRow], undefined, {
        writeTargetHookTemplate: false,
        targetHookIsEjs: true,
      }),
    )
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('does not exist')
    expect(r.stderr).toContain('Track-B template')
  })
})
