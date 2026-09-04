// SPDX-License-Identifier: Apache-2.0
// #2041 — declarative gate registry. RED tests: a gate's lane membership must be
// declarative (registry-driven, not hardcoded in the EJS ifs); L3 must be an
// executable LOCAL lane (no clamp); a layering contract test must be emitted
// into the consumer.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { renderTemplate } from '../../src/utils/render.js'
import { loadGateRegistry, validatePromotions } from '../../src/generators/check-all.js'
import { INVARIANT_CATALOG } from '../../src/invariants/catalog.js'
import { makeConfig } from '../helpers.js'

function renderGate(data: Record<string, unknown>): string {
  return renderTemplate('scripts/check-all.mjs.ejs', data)
}

function runScript(
  scriptBody: string,
  args: string[],
): { status: number; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), 'gate-registry-'))
  try {
    writeFileSync(join(dir, 'check-all.mjs'), scriptBody, 'utf-8')
    // The emitted gate imports the helper trinity from ./lib/run-helpers.mjs —
    // render it alongside, exactly as the generator does.
    mkdirSync(join(dir, 'lib'), { recursive: true })
    writeFileSync(
      join(dir, 'lib', 'run-helpers.mjs'),
      renderTemplate('scripts/lib/run-helpers.mjs.ejs', {}),
      'utf-8',
    )
    // #2427: the emitted gate takes the per-repo mutex before its first check.
    writeFileSync(
      join(dir, 'lib', 'gate-mutex.mjs'),
      renderTemplate('scripts/lib/gate-mutex.mjs.ejs', {}),
      'utf-8',
    )
    // TypeScript + coverage-enabled renders the coverage-gate import as well.
    writeFileSync(
      join(dir, 'lib', 'coverage-gate.mjs'),
      renderTemplate('scripts/lib/coverage-gate.mjs.ejs', {
        projectName: 'test-project',
      }),
      'utf-8',
    )
    // Run from the fixture dir (a consumer runs the gate from its project root):
    // inline bodies read repo-local files (package.json, .github/workflows) and
    // must not observe the test runner's tree — nor hit the network.
    const r = spawnSync('node', [join(dir, 'check-all.mjs'), ...args], {
      cwd: dir,
      encoding: 'utf-8',
    })
    return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function baseData(dir: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  // Mirrors the enriched render data the generator builds (generateCheckAll):
  // coverageThreshold/coverageEnabled/mutationEnabled + the level booleans.
  const cfg = makeConfig(dir, {
    governanceLevel: 'L2',
    invariantTiers: ['architectural', 'governance', 'data', 'operational'],
    ...overrides,
  } as never) as unknown as Record<string, unknown>
  return {
    ...cfg,
    coverageThreshold: 80,
    coverageEnabled: true,
    mutationEnabled: true,
    isL2Plus: true,
    isL3Plus: false,
    isL4: false,
  }
}

describe('declarative gate registry (#2041)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gate-reg-fixture-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('AC-2041.2/4: a gate level declared in the registry drives its lane membership', () => {
    const data = baseData(dir)
    // The probe gate is declared at L2 in the registry data — it must run at L2
    // and be ABSENT from the L1 dry-run manifest. Today the level is hardcoded
    // in the EJS ifs and the gates data is ignored.
    const probe = {
      id: 'probe',
      name: 'probe gate',
      level: 'L2',
      kind: 'check',
      cmd: ['node', 'probe.mjs'],
    }
    const rendered = renderGate({ ...data, gates: [probe] })
    const l1 = runScript(rendered, ['--level', 'L1', '--dry-run'])
    expect(l1.stdout).not.toContain('probe gate')
    const l2 = runScript(rendered, ['--level', 'L2', '--dry-run'])
    expect(l2.stdout).toContain('probe gate')
  })

  it('AC-2041.1: L3 is an executable local lane — no clamp warning, L3 gates run', () => {
    // solo-reactivation (the L3 gate this proves runs) is trunk-solo/L3+-only
    // (#2222 emission-coherence fix) — the file it calls is only ever generated
    // for that combo (src/generators/solo-exception.ts), so exercise it here.
    const data = { ...baseData(dir), collaborationMode: 'trunk-solo', governanceLevel: 'L3' }
    const rendered = renderGate({ ...data, gates: loadGateRegistry({ ...data }) })
    const l3 = runScript(rendered, ['--level', 'L3', '--dry-run'])
    expect(l3.stderr).not.toContain('clamps to L2')
    expect(l3.stdout).toContain('solo reactivation')
  })

  // #2258: table-driven across arbiter's live-consumer languages — a TS-only
  // fixture data set masked the bug (nightly-audit-prod is the one L3 gate
  // that doesn't require isL3Plus), so go @ L2/trunk-solo emitted ZERO L3
  // gates and this same contract test FAILED "L3 lane declares zero gates"
  // for that cell. Spawns the actual emitted test-gate-layering.mjs against
  // the actual emitted registry — the production oracle, not a registry-shape
  // proxy.
  it.each([
    { language: 'typescript' },
    { language: 'go' },
    { language: 'rust' },
    { language: 'python' },
    { language: 'java', buildTool: 'gradle' },
    { language: 'java', buildTool: 'maven' },
    { language: 'kotlin', buildTool: 'gradle' },
  ] as const)(
    'AC-2041.3: a layering contract test is emitted for consumers ($language @ L2, trunk-solo)',
    ({ language, ...overrides }) => {
      const data = baseData(dir, { language, collaborationMode: 'trunk-solo', ...overrides })
      const registry = loadGateRegistry({ ...data })
      // The emitted test asserts L1 ⊂ L2 ⊂ L3 membership from the registry.
      const rendered = renderTemplate('scripts/test-gate-layering.mjs.ejs', data)
      expect(rendered).toMatch(/L1/)
      const scriptDir = mkdtempSync(join(tmpdir(), 'gate-layering-'))
      try {
        writeFileSync(join(scriptDir, 'test-gate-layering.mjs'), rendered, 'utf-8')
        mkdirSync(join(scriptDir, 'scripts'), { recursive: true })
        writeFileSync(
          join(scriptDir, 'scripts', 'check-all.mjs'),
          renderGate({ ...data, gates: registry }),
          'utf-8',
        )
        const r = spawnSync('node', [join(scriptDir, 'test-gate-layering.mjs')], {
          cwd: scriptDir,
          encoding: 'utf-8',
        })
        expect(r.status, r.stdout + r.stderr).toBe(0)
      } finally {
        rmSync(scriptDir, { recursive: true, force: true })
      }
    },
  )

  it.each([
    {
      buildTool: 'gradle',
      expected: ['./gradlew', 'build', '-q'],
    },
    {
      buildTool: 'maven',
      expected: ['mvn', 'verify', '-q'],
    },
  ] as const)(
    'Java L3 lifecycle passes separate $buildTool argv values',
    ({ buildTool, expected }) => {
      const registry = loadGateRegistry(baseData(dir, { language: 'java', buildTool }))
      expect(registry.find((gate) => gate.id === 'java-lifecycle')?.cmd).toEqual(expected)
    },
  )

  it.each([
    { buildTool: 'gradle', command: './gradlew', expected: ['build', '-q'] },
    { buildTool: 'maven', command: 'mvn', expected: ['verify', '-q'] },
  ] as const)(
    'executes Java $buildTool lifecycle with separate argv',
    ({ buildTool, command, expected }) => {
      const project = mkdtempSync(join(tmpdir(), 'java-lifecycle-'))
      const argvFile = join(project, 'argv.txt')
      const registry = loadGateRegistry(baseData(dir, { language: 'java', buildTool }))
      const script = '#!/bin/sh\nprintf \'%s\\n\' "$@" > "' + argvFile + '"\n'

      try {
        mkdirSync(join(project, 'scripts', 'lib'), { recursive: true })
        writeFileSync(
          join(project, 'scripts', 'check-all.mjs'),
          renderGate({ ...baseData(dir, { language: 'java', buildTool }), gates: registry }),
        )
        writeFileSync(
          join(project, 'scripts', 'lib', 'run-helpers.mjs'),
          renderTemplate('scripts/lib/run-helpers.mjs.ejs', {}),
        )
        writeFileSync(
          join(project, 'scripts', 'lib', 'gate-mutex.mjs'),
          renderTemplate('scripts/lib/gate-mutex.mjs.ejs', {}),
        )
        if (buildTool === 'gradle') {
          writeFileSync(join(project, 'gradlew'), script)
          chmodSync(join(project, 'gradlew'), 0o755)
        } else {
          mkdirSync(join(project, 'bin'), { recursive: true })
          writeFileSync(join(project, 'bin', 'mvn'), script)
          chmodSync(join(project, 'bin', 'mvn'), 0o755)
        }

        const result = spawnSync(
          'node',
          ['scripts/check-all.mjs', 'L3', '--gate', 'java-lifecycle'],
          {
            cwd: project,
            encoding: 'utf-8',
            env: { ...process.env, PATH: `${join(project, 'bin')}:${process.env.PATH ?? ''}` },
          },
        )
        expect(result.status, result.stdout + result.stderr).toBe(0)
        expect(readFileSync(argvFile, 'utf-8').trim().split('\n')).toEqual(expected)
        expect(command).toBe(registry.find((gate) => gate.id === 'java-lifecycle')?.cmd[0])
      } finally {
        rmSync(project, { recursive: true, force: true })
      }
    },
  )

  it('Kotlin L3 fixture owns an executable Gradle wrapper', () => {
    const fixture = resolve('__tests__/fixtures/real-projects/kotlin-backend-web-db-gradle')
    const wrapper = join(fixture, 'gradle', 'wrapper')
    const gradlew = join(fixture, 'gradlew')

    expect(existsSync(join(wrapper, 'gradle-wrapper.jar'))).toBe(true)
    expect(existsSync(join(wrapper, 'gradle-wrapper.properties'))).toBe(true)
    expect(statSync(gradlew).mode & 0o111).not.toBe(0)
    expect(readFileSync(gradlew, 'utf-8')).toContain('org.gradle.wrapper.GradleWrapperMain')
  })
})

// #9003 — promotes_to (a base/full-strength gate-substitution axis) and audit
// (a level-orthogonal gate-tagging axis), both additive/opt-in fields on a gate entry.
describe('gate registry: promotes_to and audit (#9003)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gate-promo-fixture-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const OK_CMD = ['node', '-e', 'process.exit(0)']

  it('a gate with no promotes_to/audit renders byte-identical to the pre-#9003 shape', () => {
    const data = baseData(dir)
    const plain = { id: 'probe', name: 'probe gate', level: 'L2', kind: 'check', cmd: OK_CMD }
    const rendered = renderGate({ ...data, gates: [plain] })
    // The per-gate skip-wrap (if/else around runCheck) is opt-in — a gate
    // with neither promotes_to nor audit gets the exact pre-#9003 one-liner,
    // with no wrapping if/else around it.
    expect(rendered).toContain("runCheck('probe gate', 'node', ['-e', 'process.exit(0)']);")
    expect(rendered).not.toContain("if (_promotedAway.has('probe')")
    expect(rendered).not.toMatch(/if \(_auditGatesOff\) \{\n\s*console\.log\('\[CHECK\] probe gate/)
  })

  it('promotes_to: the base gate runs when the promoted tier is not reached', () => {
    const data = { ...baseData(dir), governanceLevel: 'L3' }
    const base = {
      id: 'harness-fast',
      name: 'harness fast',
      level: 'L1',
      kind: 'check',
      cmd: OK_CMD,
    }
    const full = {
      id: 'harness-full',
      name: 'harness full',
      level: 'L3',
      kind: 'check',
      cmd: OK_CMD,
      promotes_to: 'harness-fast',
    }
    const rendered = renderGate({ ...data, gates: [base, full] })
    const l1 = runScript(rendered, ['--level', 'L1'])
    expect(l1.status, l1.stdout + l1.stderr).toBe(0)
    expect(l1.stdout).toContain('harness fast ... PASS')
    expect(l1.stdout).not.toContain('harness full')
  })

  it('promotes_to: the promoted gate replaces the base once its own level is reached', () => {
    const data = { ...baseData(dir), governanceLevel: 'L3' }
    const base = {
      id: 'harness-fast',
      name: 'harness fast',
      level: 'L1',
      kind: 'check',
      cmd: OK_CMD,
    }
    const full = {
      id: 'harness-full',
      name: 'harness full',
      level: 'L3',
      kind: 'check',
      cmd: OK_CMD,
      promotes_to: 'harness-fast',
    }
    const rendered = renderGate({ ...data, gates: [base, full] })
    const l3 = runScript(rendered, ['--level', 'L3'])
    expect(l3.status, l3.stdout + l3.stderr).toBe(0)
    expect(l3.stdout).toContain('harness fast ... SKIP')
    expect(l3.stdout).toContain('harness full ... PASS')
  })

  it('audit: an audit-tagged gate runs by default (ARBITER_AUDIT_MODE unset)', () => {
    const data = baseData(dir)
    const gate = {
      id: 'audit-only',
      name: 'audit only gate',
      level: 'L1',
      kind: 'check',
      cmd: OK_CMD,
      audit: true,
    }
    const rendered = renderGate({ ...data, gates: [gate] })
    delete process.env.ARBITER_AUDIT_MODE
    const r = runScript(rendered, ['--level', 'L1'])
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(r.stdout).toContain('audit only gate ... PASS')
  })

  it('audit: ARBITER_AUDIT_MODE=off skips audit-tagged gates only', () => {
    const data = baseData(dir)
    const auditGate = {
      id: 'audit-only',
      name: 'audit only gate',
      level: 'L1',
      kind: 'check',
      cmd: OK_CMD,
      audit: true,
    }
    const plainGate = { id: 'plain', name: 'plain gate', level: 'L1', kind: 'check', cmd: OK_CMD }
    const rendered = renderGate({ ...data, gates: [auditGate, plainGate] })
    const prev = process.env.ARBITER_AUDIT_MODE
    process.env.ARBITER_AUDIT_MODE = 'off'
    try {
      const r = runScript(rendered, ['--level', 'L1'])
      expect(r.status, r.stdout + r.stderr).toBe(0)
      expect(r.stdout).toContain('audit only gate ... SKIP')
      expect(r.stdout).toContain('plain gate ... PASS')
    } finally {
      if (prev === undefined) delete process.env.ARBITER_AUDIT_MODE
      else process.env.ARBITER_AUDIT_MODE = prev
    }
  })

  it.each(['false', '0', 'no'])(
    'audit: ARBITER_AUDIT_MODE=%s (boolean off-forms, not just literal "off") also skips',
    (offForm) => {
      const data = baseData(dir)
      const auditGate = {
        id: 'audit-only',
        name: 'audit only gate',
        level: 'L1',
        kind: 'check',
        cmd: OK_CMD,
        audit: true,
      }
      const rendered = renderGate({ ...data, gates: [auditGate] })
      const prev = process.env.ARBITER_AUDIT_MODE
      process.env.ARBITER_AUDIT_MODE = offForm
      try {
        const r = runScript(rendered, ['--level', 'L1'])
        expect(r.status, r.stdout + r.stderr).toBe(0)
        expect(r.stdout).toContain('audit only gate ... SKIP')
      } finally {
        if (prev === undefined) delete process.env.ARBITER_AUDIT_MODE
        else process.env.ARBITER_AUDIT_MODE = prev
      }
    },
  )

  it('loadGateRegistry (the real, unmodified registry) loads clean — no false-positive from the new validator', () => {
    const data = baseData(dir, { language: 'typescript' })
    expect(() => loadGateRegistry(data)).not.toThrow()
  })

  it('validatePromotions throws LOUD on a promotes_to referencing an unknown gate id', () => {
    const entries = [
      { id: 'harness-fast', name: 'harness fast', level: 'L1' as const, kind: 'check' as const },
      {
        id: 'harness-full',
        name: 'harness full',
        level: 'L3' as const,
        kind: 'check' as const,
        promotes_to: 'no-such-gate',
      },
    ]
    expect(() => validatePromotions(entries)).toThrow(/promotes_to unknown gate id "no-such-gate"/)
  })

  it('validatePromotions accepts a promotes_to referencing a real gate id', () => {
    const entries = [
      { id: 'harness-fast', name: 'harness fast', level: 'L1' as const, kind: 'check' as const },
      {
        id: 'harness-full',
        name: 'harness full',
        level: 'L3' as const,
        kind: 'check' as const,
        promotes_to: 'harness-fast',
      },
    ]
    expect(() => validatePromotions(entries)).not.toThrow()
  })

  it('validatePromotions throws LOUD when the promoting gate also carries a runtime condition', () => {
    // A false `condition` on the promoting gate would self-skip it while the
    // base it names is unconditionally suppressed — neither gate runs,
    // silently. This is exactly the class of fake-green the registry's
    // other validators exist to reject at generation time.
    const entries = [
      { id: 'harness-fast', name: 'harness fast', level: 'L1' as const, kind: 'check' as const },
      {
        id: 'harness-full',
        name: 'harness full',
        level: 'L3' as const,
        kind: 'check' as const,
        promotes_to: 'harness-fast',
        condition: "gateFilePresent('scripts/harness-full.mjs', 'harness full')",
      },
    ]
    expect(() => validatePromotions(entries)).toThrow(
      /declares promotes_to and a runtime condition\/else/,
    )
  })

  it('validatePromotions throws LOUD when the promoting gate is kind: inline', () => {
    // An inline gate's body is a hardcoded EJS branch matched on g.id — a
    // promoting gate with no matching branch emits nothing while still
    // counting as "reached" for _promotedAway, suppressing both gates.
    const entries = [
      { id: 'harness-fast', name: 'harness fast', level: 'L1' as const, kind: 'check' as const },
      {
        id: 'harness-full',
        name: 'harness full',
        level: 'L3' as const,
        kind: 'inline' as const,
        promotes_to: 'harness-fast',
      },
    ]
    expect(() => validatePromotions(entries)).toThrow(/declares promotes_to and kind: inline/)
  })
})

describe('gate-registry INV-label correctness (#2413)', () => {
  // #2413: action-pins was labeled "(INV-75)" (the heartbeat-watchdog invariant)
  // when its actual enforcement is INV-76 (SHA-pinned actions) — a citation
  // that had silently drifted off-by-one for the whole INV-73..82 GitHub CI
  // block. This pins every `(INV-NN)` gate label in the template to the
  // catalog entry it actually cites: the gate's own enforcement script
  // basename must appear in that INV's title/description/enforcement text.
  const templatePath = resolve('src/templates/scripts/gate-registry.yml.ejs')
  const template = readFileSync(templatePath, 'utf-8')
  const catalogById = new Map(INVARIANT_CATALOG.map((inv) => [inv.id, inv]))

  // Gates that legitimately share an invariant with a sibling gate whose own
  // enforcement script IS the one named in the catalog text — a naive
  // "script basename in catalog text" check would false-positive on these.
  // Manually verified against src/invariants/catalog.ts (#2413):
  const SHARED_INVARIANT_EXCEPTIONS: Record<string, string> = {
    // INV-25's catalog text only names the pre-push hook; check-min-test-execution.mjs
    // is documented as INV-25's generated-target sibling in scripts/canon01-self-only.json.
    'min-test-execution':
      'INV-25 shares scripts/canon01-self-only.json documentation with check-min-test-execution.mjs, not named in the catalog entry itself',
    // INV-124's catalog text only names check-test-pyramid.mjs; test-scope-tier
    // enforces the same "declared test levels must be non-empty" invariant via a
    // sibling script.
    'test-scope-tier':
      'INV-124 covers both check-test-pyramid.mjs and check-test-scope-tier.mjs; only the former is named in the catalog text',
  }

  const entryRe =
    /\{ id: ([\w-]+), name: '([^']*)\(INV-(\d+)\)'[^}]*cmd: \['node', \['([^']+)'\]\]/g
  const entries: { id: string; label: string; inv: string; script: string }[] = []
  let m: RegExpExecArray | null
  while ((m = entryRe.exec(template))) {
    entries.push({ id: m[1], label: m[2].trim(), inv: m[3], script: m[4] })
  }

  it('finds INV-labeled check gates in the template (fixture sanity)', () => {
    expect(entries.length).toBeGreaterThan(20)
  })

  for (const entry of entries) {
    if (entry.id in SHARED_INVARIANT_EXCEPTIONS) continue
    it(`${entry.id}: label "(INV-${entry.inv})" matches that INV's own catalog enforcement`, () => {
      const inv = catalogById.get(`INV-${entry.inv}`)
      expect(inv, `INV-${entry.inv} must exist in the catalog`).toBeDefined()
      const scriptBase = entry.script.split('/').pop() ?? entry.script
      const haystack = `${inv!.title} ${inv!.description} ${inv!.enforcement ?? ''}`
      expect(
        haystack.includes(scriptBase),
        `gate "${entry.id}" is labeled (INV-${entry.inv}) but that catalog entry never mentions ${scriptBase} — wrong INV number?`,
      ).toBe(true)
    })
  }
})
