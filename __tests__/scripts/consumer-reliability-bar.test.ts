import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { makeConfig, renderCheckAll } from '../helpers.js'
import {
  assessGateSpine,
  assessGateSurface,
  parseGateSurfaceOutput,
  assertCredentialFreeEnvironment,
  buildVerifierEnvironment,
  classifyAdvisoryHookResult,
  classifyHookResult,
  classifyUpdateResult,
  commandOutcomeKind,
  extractCheckNames,
  extractHardCheckNames,
  extractWorkflowRun,
  redactSecrets,
  resultExitCode,
  scrubOwnCredentials,
  summarizeProbeFailures,
  formatFailureLines,
  pinnedHeadMatches,
  summarizeRoutingFailures,
} from '../../scripts/lib/consumer-reliability-bar.mjs'

describe('consumer reliability bar oracles (#2135)', () => {
  it('AC-2 extracts every gate-result call family', () => {
    const source = [
      "runCheck('unit tests', 'npm', ['test'])",
      "runWarnCheck('docs', 'node', ['docs.mjs'])",
      "runToolCheck('lint', 'eslint', ['.'])",
      "pushResult('dep audit', 'PASS', 12)",
    ].join('\n')
    expect([...extractCheckNames(source)]).toEqual(['dep audit', 'docs', 'lint', 'unit tests'])
  })

  it('accepts an exact workflow run only from its declared job', () => {
    const workflow = [
      'jobs:',
      '  gate:',
      '    steps:',
      '      - run: npm run test:coverage',
      '  other:',
      '    steps:',
      '      - run: npm run test:other',
    ].join('\n')
    expect(extractWorkflowRun(workflow, { job: 'gate', run: 'npm run test:coverage' }).ok).toBe(
      true,
    )
    expect(extractWorkflowRun(workflow, { job: 'gate', run: 'npm run test:other' }).ok).toBe(false)
  })

  it('rejects an update that changes the prepared consumer commit', () => {
    expect(pinnedHeadMatches({ ok: true, stdout: 'abc\n' }, 'abc')).toBe(true)
    expect(pinnedHeadMatches({ ok: true, stdout: 'def\n' }, 'abc')).toBe(false)
  })

  it('AC-2 fails when a pre-existing check disappears', () => {
    const result = assessGateSpine({
      before: "runCheck('unit', 'npm', ['test'])\nrunCheck('security', 'node', ['sec.mjs'])\n",
      after: "runCheck('unit', 'npm', ['test'])\n",
      existed: true,
    })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('security')
  })

  // #2290 §4: the byte-identity branch is deleted. Reformatting a consumer-owned spine
  // is not a regression in the set of checks it runs, and the old branch fired on all
  // three rows because `recordedRenderHash === null` collapsed three distinct causes.
  it('AC-2 does not redden a consumer-owned spine for byte churn alone', () => {
    const before = "runCheck('project check', 'node', ['custom.mjs'])\n"
    const after = `${before.replace(', ', ',  ')}runCheck('new', 'node', ['new.mjs'])\n`
    const result = assessGateSpine({ before, after, existed: true })
    expect(result.ok).toBe(true)
  })

  it('AC-2 permits an additive template refresh for a pristine gate spine', async () => {
    const before = "runCheck('unit', 'npm', ['test'])\n"
    const recordedRenderHash = await crypto.subtle
      .digest('SHA-256', new TextEncoder().encode(before))
      .then((bytes) => Buffer.from(bytes).toString('hex'))
    const result = assessGateSpine({
      before,
      after: `${before}runCheck('new', 'node', ['new.mjs'])\n`,
      recordedRenderHash,
      existed: true,
    })
    expect(recordedRenderHash).toMatch(/^[0-9a-f]{64}$/)
    expect(result.ok).toBe(true)
  })

  // #2135: the java consumer has no scripts/check-all.mjs, so this branch decided its
  // AC-2 verdict. It used to return `ok: checks.size > 0` — a tautology that reported
  // PASS for a before/after diff the bar never performed.
  it('AC-2 cannot pass when there is no pre-existing gate spine to diff', () => {
    const result = assessGateSpine({
      before: '',
      after: "runCheck('unit', 'npm', ['test'])\nrunCheck('lint', 'eslint', ['.'])\n",
      existed: false,
    })
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/UNPROVEN/)
  })

  // Fail-closed: a caller that omits `existed` must not inherit a passing baseline.
  it('AC-2 treats a missing `existed` flag as UNPROVEN, never as a pass', () => {
    const source = "runCheck('unit', 'npm', ['test'])\n"
    const result = assessGateSpine({ before: source, after: source })
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/UNPROVEN/)
  })

  // ── AC-2 (#2135, decided on #2290): emitted-vs-executed reconciliation ─────────
  // The oracle is no longer "did a name disappear between two renders of a file the
  // consumer never runs". It is: every check name a FRESH render emits for this
  // consumer is either mapped to a gate the consumer really executes, declined with a
  // written reason, or carried in a decreasing-ratchet debt register whose issues are
  // machine-verified OPEN. Anything else is unaccounted, and unaccounted is FAIL.
  const surfaceCase = (overrides = {}) => ({
    freshRender: ['unit tests', 'PII scan'],
    declared: ['be-test', 'pii'],
    mapping: { 'unit tests': 'WIRED:be-test', 'PII scan': 'WIRED:pii' },
    debtRegister: { ceiling: 0, openIssues: [] },
    ...overrides,
  })

  it('AC-2 reconciles a fully wired surface', () => {
    const result = assessGateSurface(surfaceCase())
    expect(result.ok).toBe(true)
  })

  // #2591: a name found only via runWarnCheck cannot back a bare WIRED claim — that call
  // family can never return non-zero, so "WIRED" would assert a build-failing gate that
  // structurally cannot fail the build.
  it('#2591 fails a WIRED mapping whose consumer gate is only warn-wired', () => {
    const source = "runWarnCheck('acceptance anchor (INV-138)', 'node', ['check-acceptance.mjs'])"
    const result = assessGateSurface(
      surfaceCase({
        freshRender: ['acceptance anchor (INV-138)'],
        declared: [...extractCheckNames(source)],
        declaredHard: [...extractHardCheckNames(source)],
        mapping: { 'acceptance anchor (INV-138)': 'WIRED:acceptance anchor (INV-138)' },
      }),
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/only found in the executed surface via a call family/)
  })

  // The escape hatch: declare the warn-level match explicitly rather than silently.
  it('#2591 passes when the same warn-wired gate uses WIRED:warn:', () => {
    const source = "runWarnCheck('acceptance anchor (INV-138)', 'node', ['check-acceptance.mjs'])"
    const result = assessGateSurface(
      surfaceCase({
        freshRender: ['acceptance anchor (INV-138)'],
        declared: [...extractCheckNames(source)],
        declaredHard: [...extractHardCheckNames(source)],
        mapping: { 'acceptance anchor (INV-138)': 'WIRED:warn:acceptance anchor (INV-138)' },
      }),
    )
    expect(result.ok).toBe(true)
  })

  // A hard runCheck match still resolves as a plain WIRED claim.
  it('#2591 passes a bare WIRED mapping whose consumer gate is hard (runCheck)', () => {
    const source = "runCheck('acceptance anchor (INV-138)', 'node', ['check-acceptance.mjs'])"
    const result = assessGateSurface(
      surfaceCase({
        freshRender: ['acceptance anchor (INV-138)'],
        declared: [...extractCheckNames(source)],
        declaredHard: [...extractHardCheckNames(source)],
        mapping: { 'acceptance anchor (INV-138)': 'WIRED:acceptance anchor (INV-138)' },
      }),
    )
    expect(result.ok).toBe(true)
  })

  // #2591 round 2: run-helpers.mjs only counts pushResult toward `failed` when the status
  // argument is the literal 'FAIL' — a gate that only ever pushes WARN/SKIP/PASS can never
  // fail the build, the same non-hard shape as runWarnCheck.
  it('#2591 round 2: pushResult with a non-FAIL status is not hard evidence', () => {
    const source = "pushResult('acceptance anchor (INV-138)', 'WARN', 12)"
    expect(extractHardCheckNames(source).has('acceptance anchor (INV-138)')).toBe(false)
    const result = assessGateSurface(
      surfaceCase({
        freshRender: ['acceptance anchor (INV-138)'],
        declared: [...extractCheckNames(source)],
        declaredHard: [...extractHardCheckNames(source)],
        mapping: { 'acceptance anchor (INV-138)': 'WIRED:acceptance anchor (INV-138)' },
      }),
    )
    expect(result.ok).toBe(false)
  })

  // A pushResult call that actually pushes FAIL is hard evidence.
  it('#2591 round 2: pushResult with a literal FAIL status is hard evidence', () => {
    const source = "pushResult('acceptance anchor (INV-138)', 'FAIL', 12)"
    expect(extractHardCheckNames(source).has('acceptance anchor (INV-138)')).toBe(true)
    const result = assessGateSurface(
      surfaceCase({
        freshRender: ['acceptance anchor (INV-138)'],
        declared: [...extractCheckNames(source)],
        declaredHard: [...extractHardCheckNames(source)],
        mapping: { 'acceptance anchor (INV-138)': 'WIRED:acceptance anchor (INV-138)' },
      }),
    )
    expect(result.ok).toBe(true)
  })

  // #2591 round 3 (orchestrator decision): a `command`/dry-run surface (java's
  // `run.sh ci --dry-run`) scrapes a ROSTER of gates that would run, never a per-gate
  // pass/fail result — no `declaredHard` is derivable from it. That limitation predates
  // #2591 and stays out of this issue's scope to close; assessGateSurface falls back to
  // `declared` (unchanged pre-#2591 behavior) rather than inferring hardness from the
  // roster or failing every WIRED entry closed — but it must say so explicitly, not
  // silently pass a presence-only match off as proven-hard evidence.
  it('presence-only evidence accepted for command surfaces (pre-#2591 contract, see follow-up)', () => {
    const result = assessGateSurface(surfaceCase({ declaredHard: undefined }))
    expect(result.ok).toBe(true)
    expect(result.detail).toMatch(/WIRED \(presence-only evidence: dry-run roster\)/)
  })

  it('AC-2 fails on an emitted name that is neither mapped, declined, nor in debt', () => {
    const result = assessGateSurface(
      surfaceCase({ freshRender: ['unit tests', 'PII scan', 'brand new gate'] }),
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('brand new gate')
  })

  // Mutation (a): remove an entry from the DECLARED surface. The consumer stopped
  // running a gate, so the emitted name it accounted for is covered by nothing.
  it('AC-2 fails when a mapped gate leaves the executed surface', () => {
    const result = assessGateSurface(surfaceCase({ declared: ['be-test'] }))
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('pii')
  })

  // Mutation (b): whitespace-only churn in a spine must NOT redden the row. This is the
  // regression guard for the byte-identity false red the old `customized` branch caused.
  it('AC-2 passes on a whitespace-only change to the executed spine', () => {
    const spine = "runCheck('be-test', 'npm', ['test'])\nrunCheck('pii', 'node', ['pii.mjs'])\n"
    const reformatted = spine.replace(/\n/g, '\n\n').replace(/, /g, ',  ')
    const result = assessGateSurface(surfaceCase({ declared: [...extractCheckNames(reformatted)] }))
    expect(result.ok).toBe(true)
  })

  it('AC-2 fails on a mapping entry for a name the render no longer emits', () => {
    const result = assessGateSurface(surfaceCase({ freshRender: ['unit tests'] }))
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/stale/i)
  })

  it('AC-2 refuses a DECLINED entry with no written reason', () => {
    const result = assessGateSurface(
      surfaceCase({
        declared: ['be-test'],
        mapping: { 'unit tests': 'WIRED:be-test', 'PII scan': 'DECLINED:' },
      }),
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/reason/i)
  })

  it('AC-2 accepts a DECLINED entry that carries a reason', () => {
    const result = assessGateSurface(
      surfaceCase({
        declared: ['be-test'],
        mapping: {
          'unit tests': 'WIRED:be-test',
          'PII scan': 'DECLINED:this consumer stores no personal data',
        },
      }),
    )
    expect(result.ok).toBe(true)
  })

  it('records why the Java consumer has no BDD ignore surface (#2631)', () => {
    const gateMap = JSON.parse(
      readFileSync(resolve('scripts/data/consumer-gate-map.json'), 'utf-8'),
    )
    expect(gateMap.consumers.java.mapping['BDD @ignore check']).toMatch(/^DECLINED:.+\.feature/)
  })

  it('records Coach post-merge L2 as exact CI-alignment evidence (#2631)', () => {
    const gateMap = JSON.parse(
      readFileSync(resolve('scripts/data/consumer-gate-map.json'), 'utf-8'),
    )
    expect(gateMap.consumers.typescript.mapping['ci alignment']).toMatchObject({
      verdict: 'WIRED',
      caller: 'post-merge-gate (L2)',
      evidence: {
        kind: 'workflow-run',
        workflow: '.github/workflows/01-pr-fast.yml',
        job: 'post-merge-gate',
        run: 'node scripts/check-all.mjs L2 --json gate-result.json',
      },
    })
  })

  it('records Coach BDD @ignore as the existing hard L2 guard (#2631)', () => {
    const gateMap = JSON.parse(
      readFileSync(resolve('scripts/data/consumer-gate-map.json'), 'utf-8'),
    )
    expect(gateMap.consumers.typescript.mapping['BDD @ignore check']).toBe(
      'WIRED:anti-fake-green (INV-135)',
    )
  })

  it('records Go reuse registry as its hard L2 caller (#2631)', () => {
    const gateMap = JSON.parse(
      readFileSync(resolve('scripts/data/consumer-gate-map.json'), 'utf-8'),
    )
    expect(gateMap.consumers.go.mapping['reuse registry']).toBe('WIRED:reuse registry')
  })

  it('records Coach db integration tests as its hard L2 caller (#2631)', () => {
    const gateMap = JSON.parse(
      readFileSync(resolve('scripts/data/consumer-gate-map.json'), 'utf-8'),
    )
    expect(gateMap.consumers.typescript.mapping['db integration tests']).toBe(
      'WIRED:db integration tests',
    )
  })

  it('records Coach npm-ci drift as its hard L2 caller (#2631)', () => {
    const gateMap = JSON.parse(
      readFileSync(resolve('scripts/data/consumer-gate-map.json'), 'utf-8'),
    )
    expect(gateMap.consumers.typescript.mapping['npm-ci drift']).toBe('WIRED:npm-ci drift')
  })

  it('pins the Go consumer at the revision whose reuse registry rejects unnamed rows (#2631)', () => {
    const bar = JSON.parse(
      readFileSync(resolve('scripts/data/consumer-reliability-bar.json'), 'utf-8'),
    )
    const go = bar.consumers.find((consumer: { id: string }) => consumer.id === 'go')
    expect(go.sha).toBe('eccc532f16f38f8233cd3b5a0e71d8bb02b00cdf')
  })

  it('records Coach reuse registry as its hard L2 caller (#2631)', () => {
    const gateMap = JSON.parse(
      readFileSync(resolve('scripts/data/consumer-gate-map.json'), 'utf-8'),
    )
    expect(gateMap.consumers.typescript.mapping['reuse registry']).toBe('WIRED:reuse registry')
  })

  it('records Coach domain-api surface as its hard L1 caller (#2631)', () => {
    const gateMap = JSON.parse(
      readFileSync(resolve('scripts/data/consumer-gate-map.json'), 'utf-8'),
    )
    expect(gateMap.consumers.typescript.mapping['domain-api surface (INV-125)']).toBe(
      'WIRED:domain-api surface (INV-125)',
    )
  })

  it('declines Coach frontend lane with the subtree artifact reason (#2631)', () => {
    const gateMap = JSON.parse(
      readFileSync(resolve('scripts/data/consumer-gate-map.json'), 'utf-8'),
    )
    expect(gateMap.consumers.typescript.mapping['frontend lane']).toMatch(
      /^DECLINED:.*frontend\/package\.json.*build \(vite\)/s,
    )
  })

  // #2663 added the unconditional emitted gate `no-orphan-todo` ('orphan TODOs
  // (INV-21)', scripts/check-no-orphan-todo.mjs, INV-21) but left it out of every
  // pinned consumer's gate-surface map, so a fresh render emitted a name none of the
  // three mappings accounted for and the live bar failed closed with "1 emitted
  // check(s) unaccounted: orphan TODOs (INV-21)". Asserts both the exact recorded
  // verdict per consumer (so a drift to WIRED or a wrong issue number fails here, not
  // just a generic "still not unaccounted") and that the real map reconciles clean
  // end-to-end through the same pure oracle the live bar calls.
  it('accounts for the #2663 orphan-todo gate in every pinned consumer surface', () => {
    const gateMap = JSON.parse(
      readFileSync(resolve('scripts/data/consumer-gate-map.json'), 'utf-8'),
    )
    // The expected verdict is pinned by name here, independent of whatever the file
    // currently says: a mapping that drifted to WIRED (nothing in these consumers runs
    // an orphan-todo scan) or a bogus/wrong issue number must fail this, not just the
    // generic "not unaccounted" shape below.
    const expectedVerdict = { go: 'DEBT:#2291', typescript: 'DEBT:#2291', java: 'DEBT:#2310' }
    for (const id of ['go', 'typescript', 'java']) {
      const entry = gateMap.consumers[id]
      expect(entry.mapping['orphan TODOs (INV-21)']).toBe(expectedVerdict[id])
      // Mirrors resolveMappingEntry() in scripts/consumer-reliability-bar.mjs: structured
      // workflow-run evidence entries (e.g. "ci alignment") resolve to a plain
      // "WIRED:<caller>" string before reaching this oracle. This test targets the
      // pure oracle in isolation, so it does that same resolution inline.
      const mapping = Object.fromEntries(
        Object.entries(entry.mapping).map(([name, verdict]) => [
          name,
          typeof verdict === 'string' ? verdict : `WIRED:${verdict.caller}`,
        ]),
      )
      const declared = Object.values(mapping)
        .filter((verdict) => verdict.startsWith('WIRED:'))
        .map((verdict) => verdict.slice('WIRED:'.length))
        // #2591: a WIRED:warn:<id> value's "declared" gate id is <id>, not "warn:<id>" —
        // mirrors the WIRED_WARN stripping judgeMappingEntry does in the real oracle.
        .map((value) => (value.startsWith('warn:') ? value.slice('warn:'.length) : value))
      const result = assessGateSurface({
        freshRender: Object.keys(mapping),
        declared,
        mapping,
        debtRegister: { ceiling: entry.debtCeiling, openIssues: ['#2291', '#2310'] },
      })
      expect(result.ok, result.detail).toBe(true)
    }
  })

  // #2666 added the local extension slot to check-all.mjs.ejs; #2591 made WIRED evidence
  // kind-aware. Both regressions are reproduced against a REAL render (renderCheckAll),
  // never a hand-copied fixture, sliced to the relevant block by the template's own
  // section comments so an edit to the template re-runs against the same generator output.
  function renderedSpine(): string {
    return renderCheckAll(
      makeConfig('/tmp/consumer-bar-2666', {
        language: 'typescript',
        governanceLevel: 'L2',
        coverageEnabled: false,
      }) as unknown as Record<string, unknown>,
    )
  }

  function sliceBetween(source: string, startMarker: string, endMarker: string): string {
    const start = source.indexOf(startMarker)
    if (start === -1) throw new Error(`template start marker moved: ${startMarker}`)
    const end = source.indexOf(endMarker, start)
    if (end === -1) throw new Error(`template end marker moved: ${endMarker}`)
    return source.slice(start, end)
  }

  const localSlotBlock = () =>
    sliceBetween(renderedSpine(), '// ─── Local extension slot (#2666)', '// ─── Summary')

  // Its dispatch line is a template literal, `runCheck(\`[local] ${_lc.name}\`, ...)` —
  // RUNNER_CALL scraped the literal source text verbatim, `${_lc.name}` and all, so
  // extractCheckNames emitted a DATA-DRIVEN name no fixed mapping entry could ever cover.
  // The block's static wrapper name, `local checks` (a real pushResult('local checks',
  // 'FAIL', 0) call — hard evidence), was ALSO unconditionally emitted with no mapping
  // entry at all. The live bar failed closed on all three pinned consumers with "2 emitted
  // check(s) unaccounted: [local] ${_lc.name}, local checks".
  it('#2666 excludes only the local-slot dispatch shape, not every interpolated name', () => {
    const emitted = [...extractCheckNames(localSlotBlock())]
    expect(emitted).not.toContain('[local] ${_lc.name}')
    expect(emitted).toContain('local checks')
    expect([...extractHardCheckNames(localSlotBlock())]).toContain('local checks')

    // Negative case (Codex review): the exemption must NOT be "any name containing
    // ${" — a real gate interpolating a policy id outside the local-slot's exact
    // `[local] ${` dispatch shape is still reported as unaccounted, never dropped.
    const arbitraryInterpolation = "runCheck(`security scan ${policy}`, 'node', ['scan.mjs']);"
    expect([...extractCheckNames(arbitraryInterpolation)]).toContain('security scan ${policy}')
  })

  // CI run 34739909865: on all three pinned consumers, `local checks` mapped to
  // `WIRED:local checks` and failed — "absent from the executed surface" — because the
  // executed surface is each consumer's PINNED spine (baseline.before), and every pin
  // predates the local extension slot (#2666)/java has no check-all spine at all. A bare
  // WIRED claim needs the name present in the executed surface; DECLINED needs only a
  // written reason and never consults `declared`/`executed`, so it is the correct verdict
  // regardless of whether the template renders the slot this run.
  it('#2666 every pinned consumer mapping declines the local extension slot with a reason', () => {
    const gateMap = JSON.parse(
      readFileSync(resolve('scripts/data/consumer-gate-map.json'), 'utf-8'),
    )
    const rendered = localSlotBlock()
    const emitted = [...extractCheckNames(rendered)]
    const emittedHard = [...extractHardCheckNames(rendered)]
    for (const id of ['go', 'typescript', 'java']) {
      const localEntry = gateMap.consumers[id].mapping['local checks']
      expect(typeof localEntry).toBe('string')
      expect(localEntry).toMatch(/^DECLINED:\S/)
      // No pinned consumer's own gate id is declared executed here — the point of DECLINED
      // is that it does not depend on `declared`/`executed` matching at all.
      const result = assessGateSurface({
        freshRender: emitted,
        declared: [],
        declaredHard: emittedHard,
        mapping: { 'local checks': localEntry },
        debtRegister: { ceiling: 0, openIssues: [] },
      })
      expect(result.ok, result.detail).toBe(true)
    }
  })

  // The `bdd-ignore-check` gate is emitted once per tier lane (L1/L2/L3), so its section
  // comment and `pushResult` call each appear 3 times in the full render — `sliceBetween`'s
  // first-start/first-end pairing would straddle unrelated lanes in between. Take exactly
  // one lane's copy: the block from its section comment through the end of its own
  // `pushResult(...)` statement, which is where the assignment(s) this test cares about
  // (`_bddIgnoreStatus = 'FAIL'`) live.
  const bddIgnoreBlock = () => {
    const rendered = renderCheckAll(
      makeConfig('/tmp/consumer-bar-2666-go', {
        language: 'go',
        governanceLevel: 'L2',
        coverageEnabled: false,
      }) as unknown as Record<string, unknown>,
    )
    const start = rendered.indexOf('// ─── L2: BDD gate (INV-40)')
    if (start === -1) throw new Error('template start marker moved: BDD gate (INV-40)')
    const callIdx = rendered.indexOf("pushResult('BDD @ignore check'", start)
    if (callIdx === -1) throw new Error('template BDD @ignore pushResult call moved')
    const end = rendered.indexOf(';', callIdx) + 1
    return rendered.slice(start, end)
  }

  // #2591 kind-aware WIRED evidence, applied to go's own BDD @ignore check (Codex review):
  // the gate pushes a VARIABLE status, `pushResult('BDD @ignore check', _bddIgnoreStatus,
  // ...)`, but the SAME source assigns the literal 'FAIL' to that identifier on every
  // violation branch — extractHardCheckNames now recognizes that shape as hard, so go's
  // row stays a bare `WIRED:BDD @ignore check`, not a downgrade to `WIRED:warn:`.
  it('#2591/#2666 go BDD @ignore check stays a bare WIRED claim (variable status assigns literal FAIL)', () => {
    const rendered = bddIgnoreBlock()
    expect(extractCheckNames(rendered).has('BDD @ignore check')).toBe(true)
    expect(extractHardCheckNames(rendered).has('BDD @ignore check')).toBe(true)
    const gateMap = JSON.parse(
      readFileSync(resolve('scripts/data/consumer-gate-map.json'), 'utf-8'),
    )
    const goEntry = gateMap.consumers.go.mapping['BDD @ignore check']
    expect(goEntry).toBe('WIRED:BDD @ignore check')
    const declared = [String(goEntry).slice('WIRED:'.length)]
    const result = assessGateSurface({
      freshRender: [...extractCheckNames(rendered)],
      declared,
      declaredHard: [...extractHardCheckNames(rendered)],
      mapping: { 'BDD @ignore check': goEntry },
      debtRegister: { ceiling: 0, openIssues: [] },
    })
    expect(result.ok, result.detail).toBe(true)
  })

  // #2591/#2666 (CI run 34739909865): the Bar's executed surface for a spine consumer is
  // the PINNED on-disk gate spine (`baseline.before` / `extractCheckNames`), never the
  // freshly rendered template — go, typescript and java are all pinned to a revision that
  // predates the template refactor that later dropped this issue suffix. The pinned go
  // spine still dispatches `doc-set (#1428)`; the map's value tracks that pinned dispatch,
  // not whatever the CURRENT template emits. This test still renders the template (so it
  // has a real dispatch shape to assert against, per #2591's "no hand-copied fixture"
  // rule), but treats that as the pre-#1428-suffix-drop template era and reconciles the
  // map against the suffixed id CI actually measured, not the bare fresh-render name.
  const docSetDispatchLine = () => {
    const rendered = renderCheckAll(
      makeConfig('/tmp/consumer-bar-2591-doc-set-go', {
        language: 'go',
        governanceLevel: 'L2',
        coverageEnabled: false,
      }) as unknown as Record<string, unknown>,
    )
    const callIdx = rendered.indexOf("runWarnCheck('doc-set'")
    if (callIdx === -1) throw new Error("template runWarnCheck('doc-set', ...) call moved")
    const end = rendered.indexOf(';', callIdx) + 1
    return rendered.slice(callIdx, end)
  }

  it("#2591 go doc-set is dispatched bare via runWarnCheck, matching the map's WIRED:warn: row", () => {
    const dispatch = docSetDispatchLine()
    expect(dispatch).toBe(
      "runWarnCheck('doc-set', 'node', ['scripts/check-doc-set.mjs', '--check']);",
    )
    expect(extractCheckNames(dispatch).has('doc-set')).toBe(true)
    expect(extractHardCheckNames(dispatch).has('doc-set')).toBe(false)
    const gateMap = JSON.parse(
      readFileSync(resolve('scripts/data/consumer-gate-map.json'), 'utf-8'),
    )
    const goEntry = gateMap.consumers.go.mapping['doc-set']
    expect(goEntry).toBe('WIRED:warn:doc-set (#1428)')
    const result = assessGateSurface({
      freshRender: [...extractCheckNames(dispatch)],
      declared: ['doc-set (#1428)'],
      mapping: { 'doc-set': goEntry },
      debtRegister: { ceiling: 0, openIssues: [] },
    })
    expect(result.ok, result.detail).toBe(true)
  })

  // Regression guard for a variable status that is NEVER assigned the literal 'FAIL' —
  // must stay soft evidence (unlike BDD @ignore check above), same as runWarnCheck.
  it('#2591 round 2: a variable status only ever assigned WARN/PASS is not hard evidence', () => {
    const source = [
      "let _status = 'PASS';",
      "if (x) { _status = 'WARN'; }",
      "pushResult('soft check', _status, 12);",
    ].join('\n')
    expect(extractHardCheckNames(source).has('soft check')).toBe(false)
    expect(extractCheckNames(source).has('soft check')).toBe(true)
  })

  // Mutation (d): the debt register GROWS. A ratchet that only ever appends is a
  // free-text escape hatch, so cardinality is pinned to a committed integer.
  it('AC-2 fails when the debt register grows past its ceiling', () => {
    const result = assessGateSurface(
      surfaceCase({
        declared: ['be-test'],
        mapping: { 'unit tests': 'WIRED:be-test', 'PII scan': 'DEBT:#2295' },
        debtRegister: { ceiling: 0, openIssues: ['#2295'] },
      }),
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/ratchet/i)
  })

  // The ratchet bites in BOTH directions: resolving debt forces re-tightening the
  // committed integer, so the slack can never be silently re-spent later.
  it('AC-2 fails when resolved debt leaves the ceiling untightened', () => {
    const result = assessGateSurface(surfaceCase({ debtRegister: { ceiling: 1, openIssues: [] } }))
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/ratchet/i)
  })

  // Mutation (e): a debt entry whose issue is closed or was never real. Without this,
  // `DEBT:#9999` zeroes the criterion — the same disease one floor up.
  it('AC-2 fails on a debt entry whose issue is not verified OPEN', () => {
    const result = assessGateSurface(
      surfaceCase({
        declared: ['be-test'],
        mapping: { 'unit tests': 'WIRED:be-test', 'PII scan': 'DEBT:#9999' },
        debtRegister: { ceiling: 1, openIssues: ['#2295'] },
      }),
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('#9999')
  })

  it('AC-2 rejects a mapping verdict outside WIRED / DECLINED / DEBT', () => {
    const result = assessGateSurface(
      surfaceCase({
        declared: ['be-test'],
        mapping: { 'unit tests': 'WIRED:be-test', 'PII scan': 'SKIP' },
      }),
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/SKIP/)
  })

  // Mutation (c): failing to OBTAIN the executed surface is an ERROR, never a FAIL and
  // never a PASS. A contended mutex and a genuinely missing gate must not look alike.
  it('AC-2 reports a non-zero dry-run as an acquisition error, never a verdict', () => {
    const parsed = parseGateSurfaceOutput({
      result: { ok: false, status: 1, signal: null, stdout: '', stderr: 'boom' },
      pattern: '^\\[DRY-RUN\\] GATES: (.*)$',
      separator: ',',
    })
    expect(parsed.ok).toBe(false)
    expect(parsed.detail).toMatch(/could not be obtained/i)
  })

  it('AC-2 reports a dry-run without a GATES line as an acquisition error', () => {
    const parsed = parseGateSurfaceOutput({
      result: { ok: true, status: 0, signal: null, stdout: 'nothing to see\n', stderr: '' },
      pattern: '^\\[DRY-RUN\\] GATES: (.*)$',
      separator: ',',
    })
    expect(parsed.ok).toBe(false)
    expect(parsed.detail).toMatch(/could not be obtained/i)
  })

  it('AC-2 names mutex contention distinctly so it never reads as a missing gate', () => {
    const parsed = parseGateSurfaceOutput({
      result: {
        ok: false,
        status: null,
        signal: 'SIGTERM',
        stdout: '',
        stderr: 'gate-exec: mutex /run/user/1000/arbiter/ci-gate.lock (blocking until free)',
      },
      pattern: '^\\[DRY-RUN\\] GATES: (.*)$',
      separator: ',',
      contentionMarker: 'ci-gate.lock',
    })
    expect(parsed.ok).toBe(false)
    expect(parsed.detail).toMatch(/contention/i)
  })

  it('AC-2 unions the gate ids of every surface command', () => {
    const parsed = parseGateSurfaceOutput({
      result: {
        ok: true,
        status: 0,
        signal: null,
        stdout: 'noise\n[DRY-RUN] GATES: a,b\n',
        stderr: '',
      },
      pattern: '^\\[DRY-RUN\\] GATES: (.*)$',
      separator: ',',
    })
    expect(parsed.ok).toBe(true)
    expect(parsed.gates).toEqual(['a', 'b'])
  })

  it('AC-3 counts only exit 2 as BLOCKS', () => {
    expect(
      classifyHookResult({ exitCode: 2, hardness: 'HARD', applicable: true, rationale: '' }),
    ).toBe('BLOCKS')
    expect(
      classifyHookResult({ exitCode: 1, hardness: 'HARD', applicable: true, rationale: '' }),
    ).toBe('INERT')
  })

  it('AC-3 classifies missing and signalled HARD hook executions as operational errors', () => {
    expect(
      classifyHookResult({
        exitCode: null,
        signal: null,
        hardness: 'HARD',
        applicable: true,
        rationale: '',
      }),
    ).toBe('PROBE-ERROR')
    expect(
      classifyHookResult({
        exitCode: null,
        signal: 'SIGTERM',
        hardness: 'HARD',
        applicable: true,
        rationale: '',
      }),
    ).toBe('PROBE-ERROR')
  })

  it('AC-3 requires adjacent rationale for ADVISORY classifications', () => {
    expect(
      classifyHookResult({
        exitCode: 0,
        hardness: 'ADVISORY',
        applicable: true,
        rationale: '',
      }),
    ).toBe('INVALID-ADVISORY')
    expect(
      classifyHookResult({
        exitCode: 0,
        hardness: 'ADVISORY',
        applicable: true,
        rationale: 'Records diagnostic context and intentionally never blocks.',
      }),
    ).toBe('ADVISORY')
  })

  it('AC-3 treats crashed, missing, and blocking advisory hooks as unhealthy', () => {
    const rationale = 'Diagnostic-only hook.'
    expect(classifyAdvisoryHookResult({ exitCode: 0, signal: null, rationale })).toBe('ADVISORY')
    expect(classifyAdvisoryHookResult({ exitCode: 1, signal: null, rationale })).toBe('PROBE-ERROR')
    expect(classifyAdvisoryHookResult({ exitCode: null, signal: null, rationale })).toBe(
      'PROBE-ERROR',
    )
    expect(classifyAdvisoryHookResult({ exitCode: 0, signal: 'SIGTERM', rationale })).toBe(
      'PROBE-ERROR',
    )
    expect(classifyAdvisoryHookResult({ exitCode: 2, signal: null, rationale })).toBe(
      'UNEXPECTED-BLOCK',
    )
  })

  it('AC-5 refuses verifier processes that still carry private clone credentials', () => {
    expect(() =>
      assertCredentialFreeEnvironment({
        ARBITER_CONSUMER_REPOS_TOKEN: 'secret-canary',
      }),
    ).toThrow(/credential/i)
  })

  // #2679 round 2: run-consumer-reliability.mjs (the local `npm run test:consumer-reliability`
  // entry point) spawns prepare then verify as two children of ONE credentialed parent
  // process — that parent's OWN process.env/proc-environ still carries the credentials while
  // the verify child (running consumer-controlled code) executes. A filtered child env is not
  // enough; the wrapper must scrub its OWN environment before spawning verify, so the verify
  // child's parent environment contains none of them either.
  it('#2679 scrubs a wrapper process env of every consumer credential before verify spawns', () => {
    const env = {
      PATH: '/usr/bin',
      ARBITER_CONSUMER_GO_DEPLOY_KEY: 'secret-canary',
      ARBITER_CONSUMER_GO_REPO: 'owner/go',
      GH_TOKEN: 'secret-canary',
      GITHUB_TOKEN: 'secret-canary',
    }
    scrubOwnCredentials(env)
    expect(env).toEqual({ PATH: '/usr/bin' })
    expect(() => assertCredentialFreeEnvironment(env)).not.toThrow()
  })

  it('#2679 refuses a verifier process that still carries a GitHub token', () => {
    expect(() => assertCredentialFreeEnvironment({ GH_TOKEN: 'secret-canary' })).toThrow(
      /credential/i,
    )
    expect(() => assertCredentialFreeEnvironment({ GITHUB_TOKEN: 'secret-canary' })).toThrow(
      /credential/i,
    )
    expect(() => assertCredentialFreeEnvironment({ PATH: '/usr/bin' })).not.toThrow()
  })

  // #2679 round 3 (MAJOR): matched case-insensitively, and widened to the exact env names
  // GitHub Actions itself would inject under a misconfiguration — none of these have any
  // reason to exist in a job declaring `permissions: {}` (no id-token scope requested).
  it.each([
    ['gh_token', 'lowercase gh_token'],
    ['Gh_Token', 'mixed-case Gh_Token'],
    ['INPUT_SOME-ACTION-INPUT'.replace('-', '_'), 'an action input mapped to INPUT_*'],
    ['ACTIONS_RUNTIME_TOKEN', 'the Actions runtime token'],
    ['ACTIONS_ID_TOKEN_REQUEST_TOKEN', 'the OIDC request token'],
    ['ACTIONS_ID_TOKEN_REQUEST_URL', 'the OIDC request URL'],
    ['arbiter_consumer_go_deploy_key', 'a lowercase consumer deploy key'],
  ])('#2679 refuses a verifier process carrying %s (%s)', (key: string) => {
    expect(() => assertCredentialFreeEnvironment({ [key]: 'secret-canary' })).toThrow(/credential/i)
  })

  it('AC-5 builds a strict verifier environment without runner or cloud credentials', () => {
    const clean = buildVerifierEnvironment(
      {
        PATH: '/usr/bin',
        HOME: '/home/real-user',
        AWS_SECRET_ACCESS_KEY: 'secret-canary',
        HTTPS_PROXY: 'https://credential.invalid',
        GITHUB_TOKEN: 'secret-canary',
        ARBITER_CONSUMER_GO_DEPLOY_KEY: 'secret-canary',
      },
      '/tmp/fresh-verifier-home',
    )
    expect(clean.PATH).toBe('/usr/bin')
    expect(clean.GIT_CONFIG_GLOBAL).toBe('/dev/null')
    expect(clean).not.toHaveProperty('AWS_SECRET_ACCESS_KEY')
    expect(clean).not.toHaveProperty('HTTPS_PROXY')
    expect(clean).not.toHaveProperty('GITHUB_TOKEN')
    expect(clean).not.toHaveProperty('ARBITER_CONSUMER_GO_DEPLOY_KEY')
  })

  // #2679 round 3 (CRITICAL): the real HOME can hold ~/.ssh and ~/.git-credentials that
  // consumer-controlled code (check-hook-routing.mjs, dry-run commands) could read — the
  // allowlist must never pass the caller's real HOME through, only the fresh directory the
  // caller supplies.
  it('#2679 forces a fresh HOME and never passes the real one through', () => {
    const clean = buildVerifierEnvironment(
      { PATH: '/usr/bin', HOME: '/home/real-user' },
      '/tmp/fresh-verifier-home',
    )
    expect(clean.HOME).toBe('/tmp/fresh-verifier-home')
    expect(clean.HOME).not.toBe('/home/real-user')
  })

  it('AC-5 redacts tokens, private slugs, and URLs from diagnostics', () => {
    const raw = 'clone https://host.invalid/private/repo with secret-canary failed'
    expect(redactSecrets(raw, ['secret-canary', 'private/repo'])).toBe(
      'clone [REDACTED_URL] with [REDACTED] failed',
    )
  })

  it('AC-5 maps regressions to 1 and operational errors to 2', () => {
    expect(resultExitCode([{ kind: 'pass' }])).toBe(0)
    expect(resultExitCode([{ kind: 'fail' }])).toBe(1)
    expect(resultExitCode([{ kind: 'fail' }, { kind: 'error' }])).toBe(2)
    expect(commandOutcomeKind({ status: 1, signal: null })).toBe('fail')
    expect(commandOutcomeKind({ status: 2, signal: null })).toBe('error')
    expect(commandOutcomeKind({ status: null, signal: 'SIGTERM' })).toBe('error')
  })

  it('AC-5 summarizes probe failures without retaining raw hook output', () => {
    const summary = summarizeProbeFailures(
      JSON.stringify({
        failures: [
          {
            hook: 'owned.mjs',
            state: 'PRIMED',
            verdict: 'PROBE-ERROR',
            diagnostic: 'private output must not survive',
          },
        ],
      }),
    )
    expect(summary).toBe('owned.mjs@PRIMED:PROBE-ERROR')
    expect(summary).not.toContain('private output')
  })

  it('AC-5 keeps stable routing findings while discarding arbitrary child output', () => {
    const summary = summarizeRoutingFailures(
      [
        '[hook-routing] DEAD Arbiter-owned hook owned.mjs',
        '[hook-routing] UNROUTED event PreToolUse:Bash',
        'private child output must not survive',
      ].join('\n'),
    )
    expect(summary).toBe('DEAD Arbiter-owned hook owned.mjs, UNROUTED event PreToolUse:Bash')
    expect(summary).not.toContain('private child output')
  })

  it('AC-1 accepts only Arbiter-declared recoverable update warnings for further inspection', () => {
    const warning = JSON.stringify({
      command: 'update',
      version: '1',
      status: 'warning',
      warnings: ['customized gate spine was withheld'],
      errorClass: 'recoverable',
    })
    expect(classifyUpdateResult({ status: 1, signal: null, stdout: `log\n${warning}\n` })).toEqual({
      acceptable: true,
      status: 'WARN',
      warningCount: 1,
    })
    expect(
      classifyUpdateResult({ status: 1, signal: null, stdout: 'unstructured failure' }),
    ).toEqual({
      acceptable: false,
      status: 'FAIL',
      warningCount: 0,
    })
  })
})

// #2479: the bar has been red on every push to main since 2026-08-28, and the CI log
// says only `[consumer-reliability] FAIL — 3 pinned consumers verified`. Every check
// already carries a redacted `detail`, but it is written ONLY to the summary.json
// artifact, so diagnosing a red run requires downloading a zip — which is exactly the
// friction that let a multi-day red streak go unread. A bar nobody can read from the
// log is a bar nobody reads.
describe('failure reporting (#2479)', () => {
  const consumer = (id: string, checks: Record<string, { status: string; detail: string }>) => ({
    id,
    language: 'go',
    sha: 'abc123',
    kind: 'fail',
    checks,
  })

  it('names the consumer, the check and the recorded detail for a failing row', () => {
    const lines = formatFailureLines([
      consumer('consumer-go', {
        originFree: { status: 'PASS', detail: 'no remotes remain' },
        gateSpine: { status: 'FAIL', detail: 'check "security" disappeared from the spine' },
      }),
    ])
    const text = lines.join('\n')
    expect(text).toContain('consumer-go')
    expect(text).toContain('gateSpine')
    expect(text).toContain('check "security" disappeared from the spine')
  })

  it('stays silent when every check passes — a green run adds no noise', () => {
    expect(
      formatFailureLines([
        consumer('consumer-go', { originFree: { status: 'PASS', detail: 'no remotes remain' } }),
      ]),
    ).toEqual([])
  })

  it('reports ERROR and WARN rows too, not only FAIL', () => {
    const text = formatFailureLines([
      consumer('consumer-java', {
        update: { status: 'ERROR', detail: 'dry-run exited 2' },
        hookLiveness: { status: 'WARN', detail: 'advisory probe skipped' },
      }),
    ]).join('\n')
    expect(text).toContain('dry-run exited 2')
    expect(text).toContain('advisory probe skipped')
  })

  // The details are redacted at the point they are recorded (safeDiagnostic → redactSecrets
  // + root masking). The formatter must pass them through verbatim rather than re-deriving
  // anything, so printing can never widen what the artifact already contains.
  it('passes the recorded detail through verbatim', () => {
    const detail = 'gate surface mismatch: [ARBITER_ROOT]/scripts/check-all.mjs'
    expect(
      formatFailureLines([consumer('c', { gateSurface: { status: 'FAIL', detail } })]).join('\n'),
    ).toContain(detail)
  })
})
