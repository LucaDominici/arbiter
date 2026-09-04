import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { generateCheckAll } from '../../src/generators/check-all.js'
import { makeConfig } from '../helpers.js'
import type { ProjectConfig } from '../../src/wizard/types.js'

describe('generateCheckAll', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-check-all-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('generates scripts/check-all.mjs AND scripts/lib/run-helpers.mjs (#351, CANON-01)', () => {
    const result = generateCheckAll(makeConfig(dir))
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('scripts/check-all.mjs'))).toBe(true)
    expect(paths.some((p) => p.endsWith('scripts/lib/run-helpers.mjs'))).toBe(true)
    expect(result.files.every((f) => f.action === 'created')).toBe(true)
  })

  it('emits the reduced external-review schema beside the generic agent-return schema (#2357)', () => {
    const result = generateCheckAll(makeConfig(dir))
    expect(
      result.files.some((f) => f.path.endsWith('schemas/agent-return-external.schema.json')),
    ).toBe(true)
  })

  it('emits cross-model evidence tooling and its advisory gate at L2 (#2358)', () => {
    const result = generateCheckAll(makeConfig(dir, { governanceLevel: 'L2' }))
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('scripts/check-cross-model-review.mjs'))).toBe(true)
    expect(paths.some((p) => p.endsWith('schemas/cross-model-dispatch.schema.json'))).toBe(true)
    expect(readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')).toContain(
      'cross-model review (#2358)',
    )
  })

  // #2278: the evidence-gate block emitted at L3+ reads .evidence/SUMMARY.json, and
  // until now nothing in a generated tree could write it — the template existed but
  // no generator rendered it. Emission is gated on the SAME level as its consumer.
  it('emits the evidence-collect producer at L3+ and not below (#2278)', () => {
    generateCheckAll(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'scripts', 'evidence-collect.mjs'))).toBe(false)

    const l3 = mkdtempSync(join(tmpdir(), 'arbiter-check-all-l3-'))
    try {
      generateCheckAll(makeConfig(l3, { governanceLevel: 'L3' }))
      const emitted = readFileSync(join(l3, 'scripts', 'evidence-collect.mjs'), 'utf-8')
      // Renders with real thresholds (no leftover EJS, no `undefined` interpolation).
      expect(emitted).not.toContain('<%')
      expect(emitted).toMatch(/const MUTATION_THRESHOLD = \d+;/)
      expect(emitted).toMatch(/const COVERAGE_THRESHOLD = \d+;/)
      expect(emitted).toContain("join(EVIDENCE_DIR, 'SUMMARY.json')")
    } finally {
      rmSync(l3, { recursive: true, force: true })
    }
  })

  // #2278: before the wiring nothing ever rendered this template, so no language
  // branch had ever run. A bare key in an unrendered branch is a ReferenceError that
  // crashes `arbiter init`, and a clean render can still emit unbalanced braces the
  // operator only meets at runtime — hence render AND `node --check` per stack.
  it('renders a syntactically valid evidence-collect for every stack (#2278)', () => {
    const combos = [
      { language: 'typescript', buildTool: 'npm' },
      { language: 'java', buildTool: 'gradle' },
      { language: 'java', buildTool: 'maven' },
      { language: 'rust', buildTool: 'cargo' },
      { language: 'go', buildTool: 'go' },
      { language: 'python', buildTool: 'poetry' },
    ] as const
    for (const combo of combos) {
      const target = mkdtempSync(join(tmpdir(), 'arbiter-ec-'))
      try {
        generateCheckAll(makeConfig(target, { governanceLevel: 'L3', ...combo }))
        const script = join(target, 'scripts', 'evidence-collect.mjs')
        const emitted = readFileSync(script, 'utf-8')
        expect(emitted, `${combo.language}/${combo.buildTool}`).not.toContain('<%')
        expect(emitted, `${combo.language}/${combo.buildTool}`).not.toContain('= undefined;')
        const syntax = spawnSync('node', ['--check', script], { encoding: 'utf-8' })
        expect(syntax.status, `${combo.language}/${combo.buildTool}: ${syntax.stderr}`).toBe(0)
      } finally {
        rmSync(target, { recursive: true, force: true })
      }
    }
  })

  it('wires the generated docs index drift check at L2+ (#2214)', () => {
    generateCheckAll(makeConfig(dir, { governanceLevel: 'L2' }))
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain("['scripts/gen-doc-index.mjs', '--check']")
  })

  it('emits exactly 51 files at L1 including the target hook-routing gate (#2129)', () => {
    // L1: no docs-check; non-rust language: no Rust checkers → check-all + run-helpers
    // + check-collab-mode-wired (INV-100, #1093) + check-constraint-scan (INV-115, #1214)
    // + optional-emissions.json (INV-123, #1331) + check-test-pyramid.mjs (INV-124, #1364)
    // + check-api-e2e.mjs (INV-126, #1365)
    // + check-render-smoke.mjs + lib/glob-walk.mjs (INV-127, #1366)
    // (conformance.mjs INV-128/#1398 + gold-audit.mjs #1419 are NOT emitted here — their
    //  dedicated always-on owners are the sole emitters; generateCheckAll only wires them, #1578)
    // + check-no-tracked-artifacts.mjs (INV-129, #1407)
    // + check-image-pins.mjs (#1442)
    // + lib/e2e-reliability.mjs + check-e2e-quarantine.mjs (INV-130, #1445)
    // + check-tdd-evidence.mjs (INV-131, #1446)
    // + check-doc-set.mjs + check-anti-fake-green.mjs (thin runners, INV-135, #1428)
    // + check-doc-freshness.mjs (freshness thin runner, T4, gold-doc-tranches-t3-t5.md §2.3 —
    //   emitted unconditionally but wired OUTSIDE check-all.mjs L2, monthly/release lane only)
    // + check-todo-max-age.mjs (INV-133, #1456)
    // + verify-module-coverage.mjs (INV-134, #1457)
    // + verify-mutation-baseline.mjs (#1508)
    // + check-muted-test.mjs + check-skip-critical-e2e.mjs + check-no-stub-redirects.mjs
    //   + check-grace-window.mjs (anti-fake-green file-scan guards, A5, #1497)
    // + check-assertion-delta.mjs (anti-fake-green file-scan guard, #2161 — unconditional, any
    //   test stack; oracle-discrimination, #2160, is NOT here — conditional on an E2E harness,
    //   library archetype default does not qualify, see the dedicated describe block below)
    // + muted-tests-baseline.json (brownfield grandfathering for check-muted-test, #1835-class)
    // + check-safety-adopt-ratchet.mjs (T1, anti-erosion ratchet — convergence playbook)
    // + check-smoke-journeys.mjs (INV-137 smoke-journey acceptance floor, #2080)
    // + check-e2e-escalation.mjs (e2e ledger consecutive-failure escalation gate, #2043)
    // + the 10 anti-context-rot twins (E1-E7 #1943, CANON-14): check-agent-return,
    //   check-refutation-verdicts, check-audit-dry-pass, check-handoff-doc,
    //   check-touched-vs-manifest, record-agent-return, lib/gate-args,
    //   lib/agent-return-validate, schemas/agent-return.schema.json,
    //   schemas/agent-return-external.schema.json
    // + the 3 acceptance-anchor orchestration tools (INV-138, ADR-110):
    //   issue-readiness.mjs + rework-log.mjs + lib/acceptance-criteria.mjs
    // + check-emission-parity.mjs (#2110 — manifest-vs-disk parity in the project's own gate)
    // + check-m16-handoff.mjs (M16 handoff-contract marker gate, #2103)
    // + lib/gate-evidence.mjs (#2328 — the gate-pass identity binding shared by the
    //   writer, both Claude hooks and the pre-push reuse rule)
    // + check-tabletop-evidence.mjs + schemas/tabletop-evidence.schema.json (#2429 — the
    //   tabletop evidence gate and the schema it validates against; emitted, not self-only,
    //   because a consumer runs tabletops on its own journeys)
    const result = generateCheckAll(
      makeConfig(dir, { language: 'typescript', governanceLevel: 'L1' }),
    )
    expect(result.files).toHaveLength(52)
    expect(result.files.some((f) => f.path.endsWith('scripts/lib/gate-evidence.mjs'))).toBe(true)
    // #2427 — the per-repo gate mutex: check-all re-execs itself under it and the
    // pre-push hook launches the gate through it, so a consumer missing it would
    // run two gates in one repo and leave an orphan behind a killed push.
    expect(result.files.some((f) => f.path.endsWith('scripts/lib/gate-mutex.mjs'))).toBe(true)
    // #2399 — the review/dispatch evidence binding shared by the review gates and the Stop hook.
    expect(result.files.some((f) => f.path.endsWith('scripts/lib/evidence-binding.mjs'))).toBe(true)
    expect(result.files.some((f) => f.path.endsWith('scripts/issue-readiness.mjs'))).toBe(true)
    expect(result.files.some((f) => f.path.endsWith('scripts/rework-log.mjs'))).toBe(true)
    expect(result.files.some((f) => f.path.endsWith('scripts/lib/acceptance-criteria.mjs'))).toBe(
      true,
    )
    expect(
      result.files.some((f) => f.path.endsWith('scripts/check-safety-adopt-ratchet.mjs')),
    ).toBe(true)
    expect(result.files.some((f) => f.path.endsWith('scripts/check-smoke-journeys.mjs'))).toBe(true)
    expect(result.files.some((f) => f.path.endsWith('scripts/check-e2e-escalation.mjs'))).toBe(true)
    expect(result.files.some((f) => f.path.endsWith('scripts/check-emission-parity.mjs'))).toBe(
      true,
    )
    expect(result.files.some((f) => f.path.endsWith('scripts/check-todo-max-age.mjs'))).toBe(true)
    expect(result.files.some((f) => f.path.endsWith('scripts/verify-module-coverage.mjs'))).toBe(
      true,
    )
    expect(result.files.some((f) => f.path.endsWith('scripts/verify-mutation-baseline.mjs'))).toBe(
      true,
    )
    expect(result.files.some((f) => f.path.endsWith('scripts/optional-emissions.json'))).toBe(true)
    expect(result.files.some((f) => f.path.endsWith('scripts/check-render-smoke.mjs'))).toBe(true)
    expect(result.files.some((f) => f.path.endsWith('scripts/lib/glob-walk.mjs'))).toBe(true)
    // #1578: conformance.mjs and gold-audit.mjs are NOT emitted by generateCheckAll —
    // their dedicated always-on owners (conformance / gold-kit) are the sole emitters.
    // generateCheckAll still WIRES them (advisory runWarnCheck), see the wiring tests.
    expect(result.files.some((f) => f.path.endsWith('scripts/conformance.mjs'))).toBe(false)
    expect(result.files.some((f) => f.path.endsWith('scripts/gold-audit.mjs'))).toBe(false)
    expect(
      result.files.some((f) => f.path.endsWith('scripts/check-no-tracked-artifacts.mjs')),
    ).toBe(true)
    // #2037: constraint-map.json is scaffolded alongside its checker so the INV-115
    // gate never runs against an absent map by construction.
    const constraintMap = result.files.find((f) => f.path.endsWith('scripts/constraint-map.json'))
    expect(constraintMap).toBeDefined()
    expect(() => JSON.parse(readFileSync(constraintMap!.path, 'utf-8'))).not.toThrow()
    expect(result.files.some((f) => f.path.endsWith('scripts/check-image-pins.mjs'))).toBe(true)
    expect(result.files.some((f) => f.path.endsWith('scripts/lib/e2e-reliability.mjs'))).toBe(true)
    expect(result.files.some((f) => f.path.endsWith('scripts/check-e2e-quarantine.mjs'))).toBe(true)
    expect(result.files.some((f) => f.path.endsWith('scripts/check-tdd-evidence.mjs'))).toBe(true)
    expect(result.files.some((f) => f.path.endsWith('scripts/check-doc-set.mjs'))).toBe(true)
    expect(result.files.some((f) => f.path.endsWith('scripts/check-doc-freshness.mjs'))).toBe(true)
    expect(result.files.some((f) => f.path.endsWith('scripts/check-anti-fake-green.mjs'))).toBe(
      true,
    )
    // E1-E7 #1943 (CANON-14): recorder + harvest gate + libs + schema emitted at
    // every level — the design keeps the recorder AVAILABLE from L1 (gates
    // vacuous-PASS without evidence).
    for (const twin of [
      'scripts/check-touched-vs-manifest.mjs',
      'scripts/record-agent-return.mjs',
      'scripts/lib/gate-args.mjs',
      'scripts/lib/agent-return-validate.mjs',
      'schemas/agent-return.schema.json',
      'schemas/agent-return-external.schema.json',
    ]) {
      expect(result.files.some((f) => f.path.endsWith(twin))).toBe(true)
    }
    // #2058: nightly artifact-cleanup safety net, invoked by the workflow directly
    // (not wired into the check-all.mjs gate ring).
    expect(
      result.files.some((f) => f.path.endsWith('scripts/gh-cleanup-expired-artifacts.mjs')),
    ).toBe(true)
    // The four repo-wide advisory gates follow their check-all wiring predicate
    // (enableDebtGates, L2+): NOT emitted at L1 — emitting them unwired would be
    // a dead emission (#1835 class, caught by check-emission-coherence).
    for (const gated of [
      'scripts/check-agent-return.mjs',
      'scripts/check-refutation-verdicts.mjs',
      'scripts/check-audit-dry-pass.mjs',
      'scripts/check-handoff-doc.mjs',
    ]) {
      expect(result.files.some((f) => f.path.endsWith(gated))).toBe(false)
    }
  })

  it('emits the doc-set + anti-fake-green thin runners and wires them advisory at L2 (INV-135, #1428)', () => {
    const result = generateCheckAll(
      makeConfig(dir, { language: 'typescript', governanceLevel: 'L2' }),
    )
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('scripts/check-doc-set.mjs'))).toBe(true)
    expect(paths.some((p) => p.endsWith('scripts/check-anti-fake-green.mjs'))).toBe(true)
    const docSet = readFileSync(join(dir, 'scripts', 'check-doc-set.mjs'), 'utf-8')
    expect(docSet).toContain('arbiter')
    expect(docSet).toContain('doc-set')
    const afg = readFileSync(join(dir, 'scripts', 'check-anti-fake-green.mjs'), 'utf-8')
    expect(afg).toContain('anti-fake-green')
    const checkAll = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(checkAll).toContain('check-doc-set.mjs')
    expect(checkAll).toContain('check-anti-fake-green.mjs')
    // Advisory wiring (runWarnCheck), never a hard runCheck for these two.
    expect(checkAll).toMatch(/runWarnCheck\('doc-set'/)
    expect(checkAll).toMatch(/runWarnCheck\('anti-fake-green'/)
  })

  it('ships the 4 file-scan anti-fake-green guards and HARD-wires them in check-all (A5, #1497)', () => {
    const result = generateCheckAll(
      makeConfig(dir, { language: 'typescript', governanceLevel: 'L2' }),
    )
    const paths = result.files.map((f) => f.path)
    const guards = [
      'check-muted-test.mjs',
      'check-skip-critical-e2e.mjs',
      'check-no-stub-redirects.mjs',
      'check-grace-window.mjs',
    ]
    for (const g of guards) {
      // (a) the guard script is emitted into the generated project
      expect(paths.some((p) => p.endsWith(`scripts/${g}`))).toBe(true)
      // (b) the emitted guard is self-contained: no EJS markers, no lib import, has --help
      const body = readFileSync(join(dir, 'scripts', g), 'utf-8')
      expect(body).not.toContain('<%')
      expect(body).not.toContain('%>')
      expect(body).not.toContain("from './lib/")
      expect(body).toContain('--help')
      expect(body).toContain('anti-fake-green')
    }
    // (c) each guard is HARD-wired (runCheck, not runWarnCheck) so a planted false-green BLOCKS.
    const checkAll = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(checkAll).toMatch(/runCheck\('muted gate test \(anti-fake-green\)'/)
    expect(checkAll).toMatch(/runCheck\('skipped critical e2e \(anti-fake-green\)'/)
    expect(checkAll).toMatch(/runCheck\('stub redirect husk \(anti-fake-green\)'/)
    expect(checkAll).toMatch(/runCheck\('grace window \(anti-fake-green\)'/)
    // and never softened to advisory for these deterministic guards
    expect(checkAll).not.toMatch(/runWarnCheck\('muted gate test/)
  })

  it('emitted muted-test guard is anti-vacuous: RED on a planted skip, GREEN when clean (A6, #1497)', () => {
    generateCheckAll(makeConfig(dir, { language: 'typescript', governanceLevel: 'L2' }))
    const guard = join(dir, 'scripts', 'check-muted-test.mjs')
    const testsDir = join(dir, '__tests__')
    mkdirSync(testsDir, { recursive: true })
    const spec = join(testsDir, 'sample.test.ts')

    // GREEN: a real, non-muted gate test → guard passes (exit 0).
    writeFileSync(spec, "it('does a thing', () => { expect(1).toBe(1) })\n")
    const clean = spawnSync('node', [guard, '--dir', dir], { encoding: 'utf-8' })
    expect(clean.status).toBe(0)

    // RED: the same test silenced with `.skip` → guard fails closed (exit 1).
    writeFileSync(spec, 'it.' + "skip('does a thing', () => { expect(1).toBe(1) })\n")
    const muted = spawnSync('node', [guard, '--dir', dir], { encoding: 'utf-8' })
    expect(muted.status).toBe(1)
    expect(muted.stderr).toContain('muted gate test')

    // The guard cannot be fake-greened by an UNREASONED exemption attempt buried in a string.
    writeFileSync(
      spec,
      "const x = 'arbiter-allow-skip: lie'\nit." +
        "skip('does a thing', () => { expect(1).toBe(1) })\n",
    )
    const lied = spawnSync('node', [guard, '--dir', dir], { encoding: 'utf-8' })
    expect(lied.status).toBe(1)

    // An AUDITED exemption (real comment + reason) is honored → exit 0.
    writeFileSync(
      spec,
      '// arbiter-allow-skip: flaky upstream, tracked in #123\nit.' +
        "skip('does a thing', () => { expect(1).toBe(1) })\n",
    )
    const exempt = spawnSync('node', [guard, '--dir', dir], { encoding: 'utf-8' })
    expect(exempt.status).toBe(0)
  })

  it('emits scripts/check-api-e2e.mjs and wires it into check-all.mjs (#1365, INV-126)', () => {
    const result = generateCheckAll(makeConfig(dir, { language: 'typescript' }))
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('scripts/check-api-e2e.mjs'))).toBe(true)
    const script = readFileSync(join(dir, 'scripts', 'check-api-e2e.mjs'), 'utf-8')
    expect(script).toContain('INV-126')
    const checkAll = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(checkAll).toContain('check-api-e2e.mjs')
  })

  it('emits scripts/check-constraint-scan.mjs and wires it into check-all.mjs (#1214, INV-115)', () => {
    const result = generateCheckAll(makeConfig(dir, { language: 'typescript' }))
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('scripts/check-constraint-scan.mjs'))).toBe(true)
    const script = readFileSync(join(dir, 'scripts', 'check-constraint-scan.mjs'), 'utf-8')
    expect(script).toContain('INV-115')
    // Emitted twin defaults to warn (start-warn-promote-later) so a fresh init can't hard-fail.
    expect(script).toContain('const ENFORCE_DEFAULT = false')
    const checkAll = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(checkAll).toContain('check-constraint-scan.mjs')
  })

  it('emits scripts/check-collab-mode-wired.mjs and wires it into check-all.mjs (#1093, INV-100)', () => {
    const result = generateCheckAll(makeConfig(dir, { language: 'typescript' }))
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('scripts/check-collab-mode-wired.mjs'))).toBe(true)
    const script = readFileSync(join(dir, 'scripts', 'check-collab-mode-wired.mjs'), 'utf-8')
    expect(script).toContain('[INV-100]')
    expect(script).toContain('collaborationMode')
    const checkAll = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(checkAll).toContain('check-collab-mode-wired.mjs')
  })

  it('AC-8 emits and L1-wires the target reverse hook-routing gate', () => {
    const result = generateCheckAll(makeConfig(dir, { language: 'go', governanceLevel: 'L2' }))
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('scripts/check-hook-routing.mjs'))).toBe(true)
    const script = readFileSync(join(dir, 'scripts', 'check-hook-routing.mjs'), 'utf-8')
    expect(script).toContain('Arbiter hook:')
    const checkAll = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(checkAll).toContain("runCheck('hook routing")
    expect(checkAll).toContain('scripts/check-hook-routing.mjs')
  })

  it('emits run-helpers.mjs with the trinity exports (#351)', () => {
    generateCheckAll(makeConfig(dir))
    const content = readFileSync(join(dir, 'scripts', 'lib', 'run-helpers.mjs'), 'utf-8')
    expect(content).toContain('export function runCheck')
    expect(content).toContain('export function runWarnCheck')
    expect(content).toContain('export function runToolCheck')
    expect(content).toContain('export function pushResult')
  })

  it('emits run-helpers.mjs with an explicit spawn maxBuffer + ENOBUFS-as-FAIL (buffer parity)', () => {
    generateCheckAll(makeConfig(dir))
    const content = readFileSync(join(dir, 'scripts', 'lib', 'run-helpers.mjs'), 'utf-8')
    // Generated projects inherit the same buffer guarantee as arbiter's own gate:
    // an explicit maxBuffer (not Node's 1 MB default) and ENOBUFS surfaced as an
    // actionable FAIL rather than a silent "exit null".
    expect(content).toContain('maxBuffer')
    expect(content).toContain("r.error.code === 'ENOBUFS'")
    expect(content).toContain('output exceeded buffer')
  })

  it('check-all.mjs contains inlined workflow-runners and ci-alignment logic', () => {
    generateCheckAll(makeConfig(dir))
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain('CI_BUILD_RUNNER_LABEL')
    expect(content).toContain('_caDesignExemptions')
    expect(content).toContain('_caExtractManifestGates')
    expect(content).toContain('_wrViolations')
  })

  it('check-all.mjs has shebang line', () => {
    generateCheckAll(makeConfig(dir))
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toMatch(/^#!/)
  })

  describe('gate-pass marker shape (#1705, probe≠writer)', () => {
    it('emitted check-all stamps the marker through the shared gate-evidence lib', () => {
      generateCheckAll(makeConfig(dir))
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      // The writer must not hand-roll the marker: the emitted gate stamps it with
      // buildGateEvidence, the same function the hooks verify against (#2328).
      expect(content).toContain("await import('./lib/gate-evidence.mjs')")
      const markerIdx = content.indexOf("'.arbiter/gate-pass.json'")
      expect(markerIdx).toBeGreaterThan(-1)
      // #2427: the marker binds the identity captured at gate START, not only at
      // stamp time — `start:` is the axis that makes an orphan's marker impossible.
      expect(content).toContain(
        'buildGateEvidence({ root: process.cwd(), level, taskId: _taskId, start: _gateStart })',
      )
      expect(content).toContain("await import('./lib/gate-evidence.mjs')")
      expect(content).toContain('captureGateStart(_mutexRoot)')
    })

    it('the co-emitted lib stamps head_sha/branch/task_id plus the identity axes', () => {
      generateCheckAll(makeConfig(dir))
      const lib = readFileSync(join(dir, 'scripts', 'lib', 'gate-evidence.mjs'), 'utf-8')
      for (const field of [
        'head_sha',
        'branch',
        'task_id',
        'tree_hash',
        'checkout_root',
        'toolchain_fingerprint',
        'ttl_minutes',
      ]) {
        expect(lib, `marker field ${field}`).toContain(field)
      }
      expect(lib).toContain("'rev-parse', '--abbrev-ref', 'HEAD'")
    })
  })

  it('check-all.mjs contains lint and test commands for TypeScript', () => {
    generateCheckAll(makeConfig(dir, { language: 'typescript' }))
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain('eslint')
    expect(content).toContain('npm')
    expect(content).toContain('prettier')
  })

  it('static analysis eslint uses the flat config in isolation (ESLint v9+, B4 #1491)', () => {
    generateCheckAll(makeConfig(dir, { language: 'typescript' }))
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    // Flat config run in isolation — the legacy `--no-eslintrc -c .eslintrc-static.json`
    // path crashed under ESLint v9 (eslintrc removed) and is gone from the command.
    expect(content).toContain("'--config', 'eslint.config.static.mjs'")
    expect(content).toContain("'--no-config-lookup'")
    expect(content).toContain("'--no-error-on-unmatched-pattern'")
    expect(content).not.toContain("'--no-eslintrc'")
    expect(content).not.toContain("'--ext', '.ts,.js'")
  })

  // #1887-D: INV-34 (no-fake-db) was inert — the legacy .eslintrc-no-fake-db.json
  // cannot be loaded by ESLint v9 flat config, and check-all.mjs never referenced
  // it anyway. Same isolated-flat-config pattern as the static-analysis gate.
  it('no-fake-db eslint check uses the flat config in isolation (INV-34, #1887-D)', () => {
    generateCheckAll(makeConfig(dir, { language: 'typescript' }))
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain("'--config', 'eslint.config.no-fake-db.mjs'")
    expect(content).toContain("'--no-config-lookup'")
    expect(content).not.toContain("'--no-eslintrc' -c .eslintrc-no-fake-db.json")
  })

  it('rendered GRACE_MAX_DAYS matches the CLI upgrade-level bound (no drift)', async () => {
    // The generated gate caps the honored grace window at GRACE_MAX_DAYS and the
    // `arbiter upgrade-level` CLI clamps the persisted window to the SAME value.
    // If they drift, the CLI could write a window the gate silently ignores
    // (fake-green-adjacent). This parity test forbids that drift.
    const { GRACE_MAX_DAYS } = await import('../../src/commands/upgrade-level.js')
    generateCheckAll(makeConfig(dir, { governanceLevel: 'L2' }))
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    const m = content.match(/const GRACE_MAX_DAYS\s*=\s*(\d+)/)
    expect(m, 'check-all.mjs must define GRACE_MAX_DAYS').not.toBeNull()
    expect(Number(m![1])).toBe(GRACE_MAX_DAYS)
  })

  it('check-all.mjs contains Rust commands for Rust projects', () => {
    generateCheckAll(makeConfig(dir, { language: 'rust', buildTool: 'cargo' }))
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain('fmt')
    expect(content).toContain('clippy')
    expect(content).toContain('cargo')
  })

  it('skips if check-all.mjs already exists', () => {
    const scriptsDir = join(dir, 'scripts')
    mkdirSync(scriptsDir, { recursive: true })
    writeFileSync(join(scriptsDir, 'check-all.mjs'), 'EXISTING')

    const result = generateCheckAll(makeConfig(dir))
    const mainFile = result.files.find((f) => f.path.endsWith('scripts/check-all.mjs'))
    expect(mainFile?.action).toBe('skipped')
    expect(readFileSync(join(scriptsDir, 'check-all.mjs'), 'utf-8')).toBe('EXISTING')
  })

  it('includes debt ratchet gate at L2 when enableDebtGates is true', () => {
    generateCheckAll(makeConfig(dir, { enableDebtGates: true, governanceLevel: 'L2' }))
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain('debt-report.mjs')
    expect(content).toContain('--gate')
  })

  it('uses --require-improvement flag at L3', () => {
    generateCheckAll(makeConfig(dir, { enableDebtGates: true, governanceLevel: 'L3' }))
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain('--require-improvement')
  })

  it('does not include debt ratchet when enableDebtGates is false', () => {
    generateCheckAll(makeConfig(dir, { enableDebtGates: false }))
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).not.toContain('debt-report.mjs')
  })

  it('INCLUDES pitest for Java + Gradle at L2 (#347 — INV-30 wired)', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'java',
        buildTool: 'gradle',
        enableDebtGates: true,
        governanceLevel: 'L2',
        enableMutationTesting: true,
        thresholdProfile: 'fixed',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain("runCheck('mutation (pitest)', './gradlew', ['pitest', '-q']")
  })

  it('INCLUDES pitest for Java + Maven at L2 (#347 — INV-30 wired)', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'java',
        buildTool: 'maven',
        enableDebtGates: true,
        governanceLevel: 'L2',
        enableMutationTesting: true,
        thresholdProfile: 'fixed',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain(
      "runCheck('mutation (pitest)', 'mvn', ['org.pitest:pitest-maven:mutationCoverage', '-q']",
    )
  })

  it('does not include pitest for Java at L1 (no debt gates, mutation L2-only)', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'java',
        buildTool: 'gradle',
        enableDebtGates: false,
        governanceLevel: 'L1',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).not.toContain("runCheck('mutation (pitest)'")
  })

  it('does not include pitest for non-Java languages at L2 (#347 — pitest is Java-only)', () => {
    for (const lang of ['typescript', 'rust', 'go', 'python'] as const) {
      generateCheckAll(
        makeConfig(dir, {
          language: lang,
          enableDebtGates: true,
          governanceLevel: 'L2',
          enableMutationTesting: true,
          thresholdProfile: 'fixed',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).not.toContain("runCheck('mutation (pitest)'")
    }
  })

  it('does not include mutation step when enableMutationTesting is false (#347)', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'java',
        buildTool: 'gradle',
        enableDebtGates: true,
        governanceLevel: 'L2',
        enableMutationTesting: false,
        thresholdProfile: 'fixed',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).not.toContain("runCheck('mutation (pitest)'")
  })

  it('includes STRIDE/RACI traceability check at L2 when enableDebtGates is true', () => {
    generateCheckAll(makeConfig(dir, { enableDebtGates: true, governanceLevel: 'L2' }))
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain('check-stride-traceability.mjs')
    expect(content).toContain('STRIDE')
  })

  it('does not include STRIDE check outside L2 block (appears only within if-level check)', () => {
    generateCheckAll(makeConfig(dir, { enableDebtGates: true }))
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    // The check appears inside the `if (level !== 'L1')` full-gate body (#2041) — verify that.
    // Anchor on the RUN call, not the embedded GATE_REGISTRY manifest (whose cmd
    // strings also name the script, before the lane blocks).
    const l2BlockStart = content.indexOf("if (level !== 'L1')")
    const strideIdx = content.indexOf("runCheck('STRIDE/RACI traceability'")
    expect(l2BlockStart).toBeGreaterThan(-1)
    expect(strideIdx).toBeGreaterThan(l2BlockStart)
  })

  // ─── MG: scaled thresholds ──────────────────────────────────────────────────

  it('fixed profile (default) uses 80% coverage threshold at L2', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'typescript',
        enableDebtGates: true,
        governanceLevel: 'L2',
        thresholdProfile: 'fixed',
        linesOfCode: 500,
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain('80')
    expect(content).toContain('coverage')
  })

  it('explicit zero lineCoverage is honored as-is, not substituted by computed default (#484)', () => {
    // #484: `||` would treat 0 as falsy and silently substitute the computed
    // default — that is the bug. With `??`, an explicit numeric 0 (which
    // schema-level validation rejects, so it can only arise from programmatic
    // ProjectConfig construction) is passed through verbatim. The point is
    // that the generator does NOT silently override what the caller asked for.
    generateCheckAll(
      makeConfig(dir, {
        language: 'typescript',
        enableDebtGates: true,
        governanceLevel: 'L2',
        thresholds: {
          lineCoverage: 0,
          branchCoverage: 70,
          mutationScore: 80,
          cyclomaticComplexity: 15,
          methodLength: 50,
          maxParams: 5,
        },
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    // The previously-substituted default (80) must NOT appear from a fallback.
    // Either the explicit 0 propagates, or the threshold is absent — but the
    // computed default of 80 must not be silently injected. The #1319.8 gate
    // embeds the threshold as `const _covThreshold = N;`.
    expect(content).not.toContain('_covThreshold = 80')
  })

  it('explicit zero mutationScore is honored as-is, not substituted by computed default (#484)', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'typescript',
        enableDebtGates: true,
        governanceLevel: 'L3',
        thresholds: {
          lineCoverage: 80,
          branchCoverage: 70,
          mutationScore: 0,
          cyclomaticComplexity: 15,
          methodLength: 50,
          maxParams: 5,
        },
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    // L3 computed mutation default is 85; must not be silently substituted.
    expect(content).not.toContain('MUTATION_THRESHOLD=85')
  })

  it('non-zero lineCoverage is used as-is — no fallback triggered (#299 regression)', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'typescript',
        enableDebtGates: true,
        governanceLevel: 'L2',
        thresholds: {
          lineCoverage: 75,
          branchCoverage: 70,
          mutationScore: 80,
          cyclomaticComplexity: 15,
          methodLength: 50,
          maxParams: 5,
        },
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    // #1319.8 gate embeds the threshold as `const _covThreshold = N;`.
    expect(content).toContain('_covThreshold = 75')
  })

  it('scaled profile + LoC<1000 omits coverage gate from generated script', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'typescript',
        enableDebtGates: true,
        governanceLevel: 'L2',
        thresholdProfile: 'scaled',
        linesOfCode: 500,
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    // coverageEnabled=false at this LoC ⇒ the #1319.8 coverage gate is omitted.
    expect(content).not.toContain('coverage threshold (greenfield-aware')
    expect(content).not.toContain('_covThreshold')
  })

  it('scaled profile + LoC>=1000 includes coverage gate with ramped threshold', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'typescript',
        enableDebtGates: true,
        governanceLevel: 'L2',
        thresholdProfile: 'scaled',
        linesOfCode: 5000,
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain('_covThreshold')
    // Threshold between 60% and 85% for 5k LoC
    expect(content).toMatch(/_covThreshold = \d{2}/)
  })

  it('scaled profile + LoC>=10000 uses 85% coverage threshold', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'typescript',
        enableDebtGates: true,
        governanceLevel: 'L2',
        thresholdProfile: 'scaled',
        linesOfCode: 15_000,
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain('_covThreshold = 85')
  })

  // ─── MK: grace period guard ─────────────────────────────────────────────────

  it('runCheck treats ENOENT as hard failure regardless of grace period (lives in lib)', () => {
    generateCheckAll(makeConfig(dir))
    const content = readFileSync(join(dir, 'scripts', 'lib', 'run-helpers.mjs'), 'utf-8')
    expect(content).toContain('ENOENT')
    expect(content).toContain('command not found')
  })

  it('generated script includes grace guard block reading arbiter.json', () => {
    generateCheckAll(makeConfig(dir))
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain('graceActive')
    expect(content).toContain('graceEndsAt')
    expect(content).toContain('graceFromLevel')
    expect(content).toContain('arbiter.json')
  })

  it('helper script implements WARN (grace period) path in runCheck (#351)', () => {
    generateCheckAll(makeConfig(dir))
    const content = readFileSync(join(dir, 'scripts', 'lib', 'run-helpers.mjs'), 'utf-8')
    // recordWarn emits "WARN (grace period, exit N, Tms)" via template literal —
    // assert both the helper structure (recordWarn called with grace-period msg)
    // and that the call lives in runCheck's soft branch.
    expect(content).toContain('grace period, exit ${r.status}')
    expect(content).toContain('recordWarn(name, elapsed,')
  })

  it('generated L2 audit call passes soft option', () => {
    generateCheckAll(makeConfig(dir, { language: 'typescript' }))
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain('{ soft: graceActive }')
  })

  it('generated L2 debt ratchet call passes soft option', () => {
    generateCheckAll(makeConfig(dir, { enableDebtGates: true, governanceLevel: 'L2' }))
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    const ratchetIdx = content.indexOf('debt-report.mjs')
    expect(ratchetIdx).toBeGreaterThan(-1)
    expect(content.slice(ratchetIdx)).toContain('graceActive')
  })

  it('generated TypeScript L2 debt ratchet reuses the fresh coverage summary', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'typescript',
        enableDebtGates: true,
        coverageEnabled: true,
        governanceLevel: 'L2',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain("'--coverage-summary'")
    expect(content).toContain("'--coverage-started-at'")
    expect(content).toContain('_coverageRunStartedAt')
  })

  // ─── M24: Security scanning ─────────────────────────────────────────────────

  it('PII scan runs before the L1 section (early-fail, not inside L2 block)', () => {
    generateCheckAll(
      makeConfig(dir, {
        enableSecurityScanning: true,
        governanceLevel: 'L2',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    const piiIdx = content.indexOf('pii-scan.mjs')
    const l2BlockIdx = content.indexOf("if (level !== 'L1')")
    expect(piiIdx).toBeGreaterThan(-1)
    expect(l2BlockIdx).toBeGreaterThan(-1)
    expect(piiIdx).toBeLessThan(l2BlockIdx)
  })

  it('PII scan is a hard fail (no soft: graceActive on pii-scan call)', () => {
    generateCheckAll(
      makeConfig(dir, {
        enableSecurityScanning: true,
        governanceLevel: 'L2',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    // Anchor on the runCheck call (#2041: the embedded GATE_REGISTRY manifest line
    // precedes the lanes and carries other gates' `soft` flags).
    const piiIdx = content.indexOf("runCheck('PII scan'")
    expect(piiIdx).toBeGreaterThan(-1)
    // The runCheck call for pii-scan must not pass { soft: ... }
    const lineEnd = content.indexOf('\n', piiIdx)
    const piiLine = content.slice(content.lastIndexOf('\n', piiIdx) + 1, lineEnd)
    expect(piiLine).not.toContain('soft')
  })

  it('PII scan also runs at L1 (early-fail not inside L2 block)', () => {
    generateCheckAll(
      makeConfig(dir, {
        enableSecurityScanning: true,
        governanceLevel: 'L1',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain('pii-scan.mjs')
  })

  it('gitleaks step present in L2 section when enableSecurityScanning is true', () => {
    generateCheckAll(
      makeConfig(dir, {
        enableSecurityScanning: true,
        governanceLevel: 'L2',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    const l2BlockIdx = content.indexOf("if (level !== 'L1')")
    const gitleaksIdx = content.indexOf('gitleaks', l2BlockIdx)
    expect(l2BlockIdx).toBeGreaterThan(-1)
    expect(gitleaksIdx).toBeGreaterThan(l2BlockIdx)
  })

  it('gitleaks step honors soft: graceActive (ADR-028)', () => {
    generateCheckAll(
      makeConfig(dir, {
        enableSecurityScanning: true,
        governanceLevel: 'L2',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    // Anchor on the runCheck call (#2041: the embedded GATE_REGISTRY manifest line
    // precedes the lanes and has `soft` but not `graceActive`).
    const gitleaksIdx = content.indexOf("runCheck('gitleaks'")
    expect(gitleaksIdx).toBeGreaterThan(-1)
    const callEnd = content.indexOf('\n', gitleaksIdx)
    const callLine = content.slice(content.lastIndexOf('\n', gitleaksIdx) + 1, callEnd)
    expect(callLine).toContain('graceActive')
  })

  it('Java Gradle: trivy fs dep audit in L2 when enableSecurityScanning (ADR-104)', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'java',
        buildTool: 'gradle',
        enableSecurityScanning: true,
        governanceLevel: 'L2',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    const l2BlockIdx = content.indexOf("if (level !== 'L1')")
    expect(content.indexOf("'dep audit (trivy fs)'", l2BlockIdx)).toBeGreaterThan(l2BlockIdx)
  })

  it('Java Maven: trivy fs dep audit in L2 when enableSecurityScanning (ADR-104)', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'java',
        buildTool: 'maven',
        enableSecurityScanning: true,
        governanceLevel: 'L2',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    const l2BlockIdx = content.indexOf("if (level !== 'L1')")
    expect(content.indexOf("'dep audit (trivy fs)'", l2BlockIdx)).toBeGreaterThan(l2BlockIdx)
  })

  it('Kotlin Gradle: trivy fs dep audit present when enableSecurityScanning (R-15, ADR-104)', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'kotlin',
        buildTool: 'gradle',
        enableSecurityScanning: true,
        governanceLevel: 'L2',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain("'dep audit (trivy fs)'")
  })

  it('Go: govulncheck in L2 when enableSecurityScanning', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'go',
        buildTool: 'go',
        enableSecurityScanning: true,
        governanceLevel: 'L2',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    const l2BlockIdx = content.indexOf("if (level !== 'L1')")
    expect(content.indexOf('govulncheck', l2BlockIdx)).toBeGreaterThan(l2BlockIdx)
  })

  it('Go: gofmt -l gate present in L1 block (#157)', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'go',
        buildTool: 'go',
        governanceLevel: 'L1',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain('gofmt')
    expect(content).toContain("'-l'")
  })

  it('frontend-spa TS: fsd boundaries gate present in check-all.mjs (#158)', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'typescript',
        archetype: 'frontend-spa',
        governanceLevel: 'L1',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain('fsd boundaries')
    // Flat config — ESLint v9 removed the legacy --no-eslintrc/-c loader the
    // .cjs file needs (#1491-class fix, mirrors eslint.config.static.mjs above).
    expect(content).toContain('eslint.config.frontend-spa.mjs')
  })

  it('enableSecurityScanning=false: PII baseline remains while gitleaks and dep audit stay absent', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'java',
        buildTool: 'gradle',
        enableSecurityScanning: false,
        governanceLevel: 'L2',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).not.toContain('gitleaks')
    expect(content).not.toContain("'dep audit (trivy fs)'")
    expect(content).toContain('pii-scan.mjs')
  })

  it('enableSecurityScanning=false: typescript npm audit absent', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'typescript',
        buildTool: 'npm',
        enableSecurityScanning: false,
        governanceLevel: 'L2',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).not.toContain('npm audit')
  })

  it('enableSecurityScanning=false: rust cargo audit absent', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'rust',
        buildTool: 'cargo',
        enableSecurityScanning: false,
        governanceLevel: 'L2',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).not.toContain('cargo audit')
  })

  it('enableSecurityScanning=false: python pip-audit absent', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'python',
        buildTool: 'pip',
        enableSecurityScanning: false,
        governanceLevel: 'L2',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).not.toContain('pip-audit')
  })

  it('gitleaks command uses --gitleaks-ignore-path not --baseline-path', () => {
    generateCheckAll(
      makeConfig(dir, {
        enableSecurityScanning: true,
        governanceLevel: 'L2',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain('--gitleaks-ignore-path')
    expect(content).not.toContain('--baseline-path')
  })

  // ─── M26: hasDatabase integration test steps ────────────────────────────────

  describe('M26 hasDatabase integration steps', () => {
    // TypeScript
    it('TypeScript: runs the generated integration script at L2 when hasDatabase=true', () => {
      generateCheckAll(
        makeConfig(dir, {
          language: 'typescript',
          hasDatabase: true,
          governanceLevel: 'L2',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).toContain("'npm', ['run', 'test:integration']")
    })

    it('TypeScript: omits the integration script at L2 when hasDatabase=false', () => {
      generateCheckAll(
        makeConfig(dir, {
          language: 'typescript',
          hasDatabase: false,
          governanceLevel: 'L2',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).not.toContain("runCheck('db integration tests'")
    })

    it('TypeScript: omits vitest integration step at L1 even when hasDatabase=true', () => {
      generateCheckAll(
        makeConfig(dir, {
          language: 'typescript',
          hasDatabase: true,
          governanceLevel: 'L1',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).not.toContain("'vitest', 'run', 'integration'")
    })

    // Java Gradle
    it('Java Gradle: includes integrationTest step at L2 when hasDatabase=true', () => {
      generateCheckAll(
        makeConfig(dir, {
          language: 'java',
          buildTool: 'gradle',
          hasDatabase: true,
          governanceLevel: 'L2',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).toContain("'integrationTest'")
    })

    it('Java Gradle: omits integrationTest step at L2 when hasDatabase=false', () => {
      generateCheckAll(
        makeConfig(dir, {
          language: 'java',
          buildTool: 'gradle',
          hasDatabase: false,
          governanceLevel: 'L2',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).not.toContain("'integrationTest'")
    })

    it('Java Gradle: omits integrationTest step at L1 even when hasDatabase=true', () => {
      generateCheckAll(
        makeConfig(dir, {
          language: 'java',
          buildTool: 'gradle',
          hasDatabase: true,
          governanceLevel: 'L1',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).not.toContain("'integrationTest'")
    })

    // Java Maven
    it('Java Maven: includes mvn verify integration step at L2 when hasDatabase=true', () => {
      generateCheckAll(
        makeConfig(dir, {
          language: 'java',
          buildTool: 'maven',
          hasDatabase: true,
          governanceLevel: 'L2',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).toContain("['verify', '-q']")
    })

    it('Java Maven: carries the L3 lifecycle argv at L2 when hasDatabase=false', () => {
      generateCheckAll(
        makeConfig(dir, {
          language: 'java',
          buildTool: 'maven',
          hasDatabase: false,
          governanceLevel: 'L2',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).toContain("'mvn', ['verify', '-q']")
    })

    it('Java Maven: carries the L3 lifecycle argv at L1 when hasDatabase=true', () => {
      generateCheckAll(
        makeConfig(dir, {
          language: 'java',
          buildTool: 'maven',
          hasDatabase: true,
          governanceLevel: 'L1',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).toContain("'mvn', ['verify', '-q']")
    })

    // Rust
    it('Rust: includes cargo test --tests step at L2 when hasDatabase=true', () => {
      generateCheckAll(
        makeConfig(dir, {
          language: 'rust',
          buildTool: 'cargo',
          hasDatabase: true,
          governanceLevel: 'L2',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).toContain("'--tests'")
      expect(content).not.toContain("'*integration*'")
    })

    it('Rust: omits cargo --tests step at L2 when hasDatabase=false', () => {
      generateCheckAll(
        makeConfig(dir, {
          language: 'rust',
          buildTool: 'cargo',
          hasDatabase: false,
          governanceLevel: 'L2',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).not.toContain("'--tests'")
    })

    it('Rust: omits cargo --tests step at L1 even when hasDatabase=true', () => {
      generateCheckAll(
        makeConfig(dir, {
          language: 'rust',
          buildTool: 'cargo',
          hasDatabase: true,
          governanceLevel: 'L1',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).not.toContain("'--tests'")
    })

    // Go
    it('Go: includes go test -tags integration step at L2 when hasDatabase=true', () => {
      generateCheckAll(
        makeConfig(dir, {
          language: 'go',
          buildTool: 'go',
          hasDatabase: true,
          governanceLevel: 'L2',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).toContain("'-tags', 'integration'")
    })

    it('Go: omits go test -tags integration step at L2 when hasDatabase=false', () => {
      generateCheckAll(
        makeConfig(dir, {
          language: 'go',
          buildTool: 'go',
          hasDatabase: false,
          governanceLevel: 'L2',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).not.toContain("'-tags', 'integration'")
    })

    it('Go: omits go test -tags integration step at L1 even when hasDatabase=true', () => {
      generateCheckAll(
        makeConfig(dir, {
          language: 'go',
          buildTool: 'go',
          hasDatabase: true,
          governanceLevel: 'L1',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).not.toContain("'-tags', 'integration'")
    })

    // Python
    it('Python: includes pytest tests/integration/ step at L2 when hasDatabase=true', () => {
      generateCheckAll(
        makeConfig(dir, {
          language: 'python',
          buildTool: 'pip',
          hasDatabase: true,
          governanceLevel: 'L2',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).toContain("'tests/integration/'")
    })

    it('Python: omits pytest tests/integration/ step at L2 when hasDatabase=false', () => {
      generateCheckAll(
        makeConfig(dir, {
          language: 'python',
          buildTool: 'pip',
          hasDatabase: false,
          governanceLevel: 'L2',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).not.toContain("'tests/integration/'")
    })

    it('Python: omits pytest tests/integration/ step at L1 even when hasDatabase=true', () => {
      generateCheckAll(
        makeConfig(dir, {
          language: 'python',
          buildTool: 'pip',
          hasDatabase: true,
          governanceLevel: 'L1',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).not.toContain("'tests/integration/'")
    })
  })

  // ── #1330: per-lane frontend gate (subtree lane, non-frontend-spa archetype) ──
  // The dead-FE-gate bug only manifests when the primary language is NOT typescript:
  // the L1/L2 _isFE blocks are TS-gated, so a Go-primary repo with a `frontend` lane
  // gets ZERO FE gating. These tests pin a Go-primary config to reproduce-red.
  describe('frontend lane gate (#1330)', () => {
    it('emits scripts/check-frontend-lane.mjs for a Go-primary subtree frontend lane', () => {
      const result = generateCheckAll(
        makeConfig(dir, { language: 'go', archetype: 'library', lanes: ['frontend'] }),
      )
      const paths = result.files.map((f) => f.path)
      expect(paths.some((p) => p.endsWith('scripts/check-frontend-lane.mjs'))).toBe(true)
    })

    it('wires runCheck for the frontend lane into check-all.mjs (Go-primary subtree)', () => {
      generateCheckAll(
        makeConfig(dir, { language: 'go', archetype: 'library', lanes: ['frontend'] }),
      )
      const checkAll = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(checkAll).toContain('check-frontend-lane.mjs')
    })

    it('does NOT emit check-frontend-lane.mjs for the frontend-spa archetype (root-level wiring already exists)', () => {
      const result = generateCheckAll(
        makeConfig(dir, {
          language: 'typescript',
          archetype: 'frontend-spa',
          lanes: ['frontend'],
        }),
      )
      const paths = result.files.map((f) => f.path)
      expect(paths.some((p) => p.endsWith('scripts/check-frontend-lane.mjs'))).toBe(false)
    })

    it('does NOT emit check-frontend-lane.mjs when no frontend lane is declared', () => {
      const result = generateCheckAll(
        makeConfig(dir, { language: 'go', archetype: 'library', lanes: ['docs'] }),
      )
      const paths = result.files.map((f) => f.path)
      expect(paths.some((p) => p.endsWith('scripts/check-frontend-lane.mjs'))).toBe(false)
    })

    it('does NOT emit check-frontend-lane.mjs when archetype is undefined (matches needsFrontendQuality convention)', () => {
      // Model a pre-classification config: archetype present-but-undefined (the key
      // stays on the object so template rendering sees it; the predicate must treat
      // an undefined archetype as "no subtree lane", mirroring needsFrontendQuality).
      const cfg: ProjectConfig = {
        ...makeConfig(dir, { language: 'go', lanes: ['frontend'] }),
        archetype: undefined as unknown as ProjectConfig['archetype'],
      }
      const result = generateCheckAll(cfg)
      const paths = result.files.map((f) => f.path)
      expect(paths.some((p) => p.endsWith('scripts/check-frontend-lane.mjs'))).toBe(false)
    })

    it('re-run over an existing file is a brownfield skip, not an overwrite (CANON-11, skipIfExists)', () => {
      const cfg = makeConfig(dir, {
        language: 'go',
        archetype: 'library',
        lanes: ['frontend'],
      })
      generateCheckAll(cfg)
      const second = generateCheckAll(cfg)
      const laneFile = second.files.find((f) => f.path.endsWith('scripts/check-frontend-lane.mjs'))
      expect(laneFile?.action).toBe('skipped')
    })

    it('emitted check-frontend-lane.mjs runs tsc/vitest in cwd:frontend and is gate-on-present', () => {
      generateCheckAll(
        makeConfig(dir, { language: 'go', archetype: 'library', lanes: ['frontend'] }),
      )
      const script = readFileSync(join(dir, 'scripts', 'check-frontend-lane.mjs'), 'utf-8')
      // gate-on-present: skip cleanly when the subtree or its deps are absent
      expect(script).toContain("existsSync('frontend/package.json')")
      expect(script).toContain("cwd: 'frontend'")
      // build runs only in full mode
      expect(script).toContain("mode === 'full'")
    })
  })

  describe('domain-api surface gate (#1367, INV-125)', () => {
    it('emits scripts/check-domain-api-surface.mjs and domain-api-surface.json when hasPublicApi=true', () => {
      const result = generateCheckAll(makeConfig(dir, { hasPublicApi: true }))
      const paths = result.files.map((f) => f.path)
      expect(paths.some((p) => p.endsWith('scripts/check-domain-api-surface.mjs'))).toBe(true)
      expect(paths.some((p) => p.endsWith('domain-api-surface.json'))).toBe(true)
    })

    it('does NOT emit domain-api surface files when hasPublicApi is false', () => {
      const result = generateCheckAll(makeConfig(dir, { hasPublicApi: false }))
      const paths = result.files.map((f) => f.path)
      expect(paths.some((p) => p.endsWith('scripts/check-domain-api-surface.mjs'))).toBe(false)
      expect(paths.some((p) => p.endsWith('domain-api-surface.json'))).toBe(false)
    })
  })

  describe('consumer audit gate (#1737, CANON-01 Track-B counterpart of arbiter-self #1718)', () => {
    it('emits scripts/check-consumer-audit.mjs for a published TypeScript library at L2', () => {
      const result = generateCheckAll(
        makeConfig(dir, { archetype: 'library', language: 'typescript', governanceLevel: 'L2' }),
      )
      const paths = result.files.map((f) => f.path)
      expect(paths.some((p) => p.endsWith('scripts/check-consumer-audit.mjs'))).toBe(true)
    })

    it('does NOT emit the consumer audit gate for a non-library archetype', () => {
      const result = generateCheckAll(
        makeConfig(dir, { archetype: 'cli', language: 'typescript', governanceLevel: 'L2' }),
      )
      const paths = result.files.map((f) => f.path)
      expect(paths.some((p) => p.endsWith('scripts/check-consumer-audit.mjs'))).toBe(false)
    })

    it('does NOT emit the consumer audit gate for a non-TypeScript library', () => {
      const result = generateCheckAll(
        makeConfig(dir, { archetype: 'library', language: 'python', governanceLevel: 'L2' }),
      )
      const paths = result.files.map((f) => f.path)
      expect(paths.some((p) => p.endsWith('scripts/check-consumer-audit.mjs'))).toBe(false)
    })

    it('does NOT emit the consumer audit gate at L1 for a TypeScript library', () => {
      const result = generateCheckAll(
        makeConfig(dir, { archetype: 'library', language: 'typescript', governanceLevel: 'L1' }),
      )
      const paths = result.files.map((f) => f.path)
      expect(paths.some((p) => p.endsWith('scripts/check-consumer-audit.mjs'))).toBe(false)
    })
  })

  describe('oracle-discrimination guard (#2160) — conditional on an E2E harness', () => {
    it('emits the guard + seeded-empty baseline for a frontend-spa archetype', () => {
      const result = generateCheckAll(makeConfig(dir, { archetype: 'frontend-spa' }))
      const paths = result.files.map((f) => f.path)
      expect(paths.some((p) => p.endsWith('scripts/check-oracle-discrimination.mjs'))).toBe(true)
      expect(paths.some((p) => p.endsWith('oracle-discrimination-baseline.json'))).toBe(true)
      const seeded = JSON.parse(
        readFileSync(
          result.files.find((f) => f.path.endsWith('oracle-discrimination-baseline.json'))!.path,
          'utf-8',
        ),
      )
      expect(seeded.count).toBe(0)
      expect(seeded.sites).toEqual([])
    })

    it('emits the guard for a backend-web-db archetype', () => {
      const result = generateCheckAll(makeConfig(dir, { archetype: 'backend-web-db' }))
      const paths = result.files.map((f) => f.path)
      expect(paths.some((p) => p.endsWith('scripts/check-oracle-discrimination.mjs'))).toBe(true)
    })

    it('does NOT emit the guard for a library archetype (no E2E harness applicable)', () => {
      const result = generateCheckAll(makeConfig(dir, { archetype: 'library' }))
      const paths = result.files.map((f) => f.path)
      expect(paths.some((p) => p.endsWith('scripts/check-oracle-discrimination.mjs'))).toBe(false)
      expect(paths.some((p) => p.endsWith('oracle-discrimination-baseline.json'))).toBe(false)
    })

    it('does NOT emit the guard for a cli archetype', () => {
      const result = generateCheckAll(makeConfig(dir, { archetype: 'cli' }))
      const paths = result.files.map((f) => f.path)
      expect(paths.some((p) => p.endsWith('scripts/check-oracle-discrimination.mjs'))).toBe(false)
    })
  })

  describe('assertion-delta guard (#2161) — unconditional (any test stack)', () => {
    it('emits the guard for a library archetype', () => {
      const result = generateCheckAll(makeConfig(dir, { archetype: 'library' }))
      const paths = result.files.map((f) => f.path)
      expect(paths.some((p) => p.endsWith('scripts/check-assertion-delta.mjs'))).toBe(true)
    })

    it('emits the guard for a frontend-spa archetype too', () => {
      const result = generateCheckAll(makeConfig(dir, { archetype: 'frontend-spa' }))
      const paths = result.files.map((f) => f.path)
      expect(paths.some((p) => p.endsWith('scripts/check-assertion-delta.mjs'))).toBe(true)
    })
  })
})
