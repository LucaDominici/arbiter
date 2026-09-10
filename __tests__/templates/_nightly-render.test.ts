import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'
import { extractGoInstallPins, MIN_GO_FOR_PINNED_TOOL } from '../helpers/go-pinned-tool-minimums.js'

function renderNightlyPartial(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'github/workflows/_nightly.yml.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

type NightlyJob = {
  needs?: string[]
  if?: string
  steps?: Array<{
    run?: string
    uses?: string
    if?: string
    'continue-on-error'?: boolean
    with?: { name?: string; path?: string; 'retention-days'?: number }
  }>
}

describe('#2628 — self Nightly uses required L2 coverage once', () => {
  const fixture = JSON.parse(
    readFileSync(resolve('__tests__/fixtures/ci-tier-render-context.json'), 'utf8'),
  )
  const sources = [
    ['self render', renderTemplate('github/workflows/_nightly.yml.ejs', fixture)],
    [
      'self L3 render',
      renderTemplate('github/workflows/_nightly.yml.ejs', { ...fixture, governanceLevel: 'L3' }),
    ],
    [
      'self L4 render',
      renderTemplate('github/workflows/_nightly.yml.ejs', { ...fixture, governanceLevel: 'L4' }),
    ],
    ['live workflow', readFileSync(resolve('.github/workflows/_nightly.yml'), 'utf8')],
  ] as const

  describe.each(sources)('%s', (_name, source) => {
    const { jobs } = parseYaml(source) as { jobs: Record<string, NightlyJob> }

    it('runs the full L2 gate once without a standalone coverage corpus', () => {
      expect(jobs).not.toHaveProperty('coverage-report')
      const gateSteps = jobs['gate-full-nightly'].steps ?? []
      const gateRuns = gateSteps.filter((step) => step.run?.includes('scripts/check-all.mjs'))
      expect(gateRuns).toHaveLength(1)
      expect(gateRuns[0].run).toBe('node scripts/check-all.mjs L2 --json gate-result-nightly.json')
      expect(gateRuns[0]['continue-on-error']).not.toBe(true)
      expect(source).not.toMatch(/vitest run --coverage/)
    })

    it('uploads the L2 coverage directory once, including when the gate fails', () => {
      const uploads = Object.entries(jobs).flatMap(([job, definition]) =>
        (definition.steps ?? [])
          .filter((step) => step.with?.name === 'coverage-${{ github.run_id }}')
          .map((step) => ({ job, step })),
      )
      expect(uploads).toHaveLength(1)
      expect(uploads[0].job).toBe('gate-full-nightly')
      expect(uploads[0].step.uses).toMatch(/^actions\/upload-artifact@[a-f0-9]{40}$/)
      expect(uploads[0].step.if).toBe('always()')
      expect(uploads[0].step['continue-on-error']).toBe(true)
      expect(uploads[0].step.with).toMatchObject({ path: 'coverage/', 'retention-days': 30 })
    })

    it('waits for L2 in both the aggregate and evidence collector', () => {
      for (const job of ['nightly-required', 'evidence-collect']) {
        expect(jobs[job].needs).toContain('gate-full-nightly')
        expect(jobs[job].needs).not.toContain('coverage-report')
        expect(jobs[job].if).toBe('always()')
      }
    })

    it.each([
      ['success', 'success', 0],
      ['failure', 'success', 1],
      ['cancelled', 'success', 1],
      ['skipped', 'success', 1],
      ['', 'success', 1],
      ['success', 'failure', 1],
      ['success', 'cancelled', 0],
      ['success', 'skipped', 0],
    ])(
      'returns the required outcome for L2 %j and peer jobs %j',
      (gateResult, peerResult, exitCode) => {
        const script = jobs['nightly-required'].steps?.[0].run
        expect(script).toBeDefined()
        const expanded = script!.replace(
          /\$\{\{ needs\.([\w-]+)\.result \}\}/g,
          (_expression, job: string) => (job === 'gate-full-nightly' ? gateResult : peerResult),
        )
        const result = spawnSync('bash', ['-e', '-c', expanded], { encoding: 'utf8' })
        expect(result.status, result.stderr + result.stdout).toBe(exitCode)
      },
    )
  })

  it.each(['L1', 'L2', 'L3', 'L4'])('%s preserves generated consumer coverage lanes', (level) => {
    const stacks = [
      { language: 'typescript', buildTool: 'npm', command: 'npx vitest run --coverage' },
      {
        language: 'java',
        buildTool: 'gradle',
        command: './gradlew jacocoTestCoverageVerification',
      },
      { language: 'go', buildTool: 'go', command: 'go test -coverprofile=coverage.out' },
      { language: 'python', buildTool: 'pip', command: 'pytest --cov' },
      { language: 'rust', buildTool: 'cargo', command: 'cargo tarpaulin --fail-under' },
    ]
    for (const stack of stacks) {
      const source = renderNightlyPartial({ ...stack, governanceLevel: level })
      const { jobs } = parseYaml(source) as { jobs: Record<string, NightlyJob> }
      const steps = jobs['coverage-report'].steps ?? []
      expect(
        steps.some((step) => step.run?.includes(stack.command)),
        stack.language,
      ).toBe(true)
      expect(
        steps.some((step) => step.with?.path === 'coverage/'),
        stack.language,
      ).toBe(true)
      for (const job of ['nightly-required', 'evidence-collect']) {
        expect(jobs[job].needs, stack.language).toContain('coverage-report')
      }
      if (stack.language === 'typescript') {
        expect(source).toContain(
          `--coverage.thresholds.lines=${level === 'L1' || level === 'L2' ? 80 : 85}`,
        )
      }
    }
  })

  it('retains standalone coverage when the self harness is rendered without an L2 gate', () => {
    const source = renderTemplate('github/workflows/_nightly.yml.ejs', {
      ...fixture,
      governanceLevel: 'L1',
    })
    const { jobs } = parseYaml(source) as { jobs: Record<string, NightlyJob> }
    expect(jobs).not.toHaveProperty('gate-full-nightly')
    expect(jobs).toHaveProperty('coverage-report')
    expect(jobs['nightly-required'].needs).toContain('coverage-report')
  })
})

// ─── CANON-18: structural invariants ─────────────────────────────────────────

describe('_nightly.yml.ejs — structural invariants (CANON-18)', () => {
  const STACKS = [
    { language: 'typescript', buildTool: 'npm' },
    { language: 'java', buildTool: 'gradle' },
    { language: 'go', buildTool: 'go' },
    { language: 'python', buildTool: 'pip' },
    { language: 'rust', buildTool: 'cargo' },
  ] as const

  const LEVELS = ['L1', 'L2', 'L3'] as const

  it('has explicit reusable workflow display name', () => {
    const rendered = renderNightlyPartial({ language: 'typescript', governanceLevel: 'L3' })
    expect(rendered).toMatch(/^name: Nightly jobs \(reusable\)$/m)
  })

  it('has workflow_call trigger', () => {
    const rendered = renderNightlyPartial({ language: 'typescript', governanceLevel: 'L3' })
    expect(rendered).toContain('workflow_call:')
  })

  it('does NOT have schedule trigger (that stays in caller)', () => {
    const rendered = renderNightlyPartial({ language: 'typescript', governanceLevel: 'L3' })
    expect(rendered).not.toContain('schedule:')
  })

  it('does NOT have workflow_dispatch trigger (that stays in caller)', () => {
    const rendered = renderNightlyPartial({ language: 'typescript', governanceLevel: 'L3' })
    expect(rendered).not.toContain('workflow_dispatch:')
  })

  it('does NOT have concurrency block (that stays in caller)', () => {
    const rendered = renderNightlyPartial({ language: 'typescript', governanceLevel: 'L3' })
    expect(rendered).not.toContain('concurrency:')
  })

  it('nightly does not define a mutation-deep job (#1692)', () => {
    const rendered = renderNightlyPartial({ language: 'typescript', buildTool: 'npm' })
    expect(rendered).not.toContain('mutation-deep')
  })

  it('nightly delegates to shared-security partial with no inputs (#1694, R-07)', () => {
    const rendered = renderNightlyPartial({ language: 'typescript', buildTool: 'npm' })
    expect(rendered).toContain('shared-security:')
    expect(rendered).not.toContain('nvd-cache-namespace')
  })

  it('nightly does NOT define inline dep-cve-refresh job (#1694)', () => {
    const rendered = renderNightlyPartial({ language: 'typescript', buildTool: 'npm' })
    expect(rendered).not.toContain('dep-cve-refresh:')
  })

  it('nightly does NOT define inline dast-full job (#1694)', () => {
    const rendered = renderNightlyPartial({ language: 'typescript', buildTool: 'npm' })
    expect(rendered).not.toContain('dast-full:')
  })

  it.each(STACKS)('$language: fuzz job present', ({ language, buildTool }) => {
    const rendered = renderNightlyPartial({ language, buildTool })
    expect(rendered).toContain('fuzz:')
  })

  it.each(STACKS)('$language: soak-e2e job present', ({ language, buildTool }) => {
    const rendered = renderNightlyPartial({ language, buildTool })
    expect(rendered).toContain('soak-e2e:')
  })

  it.each(STACKS)('$language: gitleaks-history job present', ({ language, buildTool }) => {
    const rendered = renderNightlyPartial({ language, buildTool })
    expect(rendered).toContain('gitleaks-history:')
  })

  it.each(STACKS)('$language: evidence-collect job present', ({ language, buildTool }) => {
    const rendered = renderNightlyPartial({ language, buildTool })
    expect(rendered).toContain('evidence-collect:')
    expect(rendered).toContain('retention-days: 90')
  })

  it('keeps the optional evidence scrubber manifest-aware (#2018)', () => {
    const rendered = renderNightlyPartial({ language: 'typescript', buildTool: 'npm' })
    const evidenceJob = rendered.slice(
      rendered.indexOf('evidence-collect:'),
      rendered.indexOf('nightly-required:'),
    )
    expect(evidenceJob).toContain('scripts/publish-evidence-snapshot.mjs')
    expect(evidenceJob).toContain('.arbiter-generated-manifest.json')
    expect(evidenceJob).toContain('was emitted by arbiter but is now missing')
  })

  // #2256: the scrub step invokes `node` unconditionally — even its own
  // manifest-check fallback (`elif node --input-type=module -e '...'`) shells out
  // to node — but the job carried no setup-node step, so the runner's ancient
  // system node throws `SyntaxError: Unexpected token {` on the modern script
  // every night. Gated to typescript, matching the literal siblings: fuzz/soak-e2e
  // resolve to setup-node-pnpm only on the typescript branch of
  // scheduled-heavy-jobs.ejs, and bake-e2e-native only renders for arbiter's own
  // typescript self-render. Non-typescript projects never emit a .nvmrc or
  // package-lock.json (confirmed against a real `arbiter init --language python`
  // tree), so an UNCONDITIONAL setup-node-pnpm step here would trade today's
  // node-version SyntaxError for a "Dependencies lock file is not found" hard
  // fail — a different red, not a fix. Slice ends at the next job key
  // (cleanup-expired-artifacts), not the #2018 test's nightly-required bound,
  // so this assertion can't accidentally match a later job's unrelated
  // actions/setup-node step.
  it('typescript: evidence-collect job carries setup-node-pnpm (#2256)', () => {
    const rendered = renderNightlyPartial({ language: 'typescript', buildTool: 'npm' })
    const evidenceJob = rendered.slice(
      rendered.indexOf('evidence-collect:'),
      rendered.indexOf('cleanup-expired-artifacts:'),
    )
    expect(evidenceJob).toContain('./.github/actions/setup-node-pnpm')
  })

  // This pins a KNOWN GAP, not an endorsement: evidence-collect's scrub step needs
  // `node` for every language (see the #2256 comment above), but non-typescript
  // projects get no setup step at all here. Tracked as a finding (arbiter note
  // fingerprint 8da674a014533c4806dc05fd340cb65baae9a6bf, severity high) — fixing
  // it needs a universal .nvmrc/tooling-package.json emission or a no-cache/
  // no-nvmrc-required input on setup-node-pnpm, both out of #2256's Files
  // manifest. Whoever closes that finding should delete/replace this test, not
  // work around it.
  it.each(STACKS.filter((s) => s.language !== 'typescript'))(
    '$language: evidence-collect job stays without setup-node-pnpm (no .nvmrc/lockfile emitted — #2256)',
    ({ language, buildTool }) => {
      const rendered = renderNightlyPartial({ language, buildTool })
      const evidenceJob = rendered.slice(
        rendered.indexOf('evidence-collect:'),
        rendered.indexOf('cleanup-expired-artifacts:'),
      )
      expect(evidenceJob).not.toContain('./.github/actions/setup-node-pnpm')
    },
  )

  it.each(STACKS)('$language: nightly-required aggregator present', ({ language, buildTool }) => {
    const rendered = renderNightlyPartial({ language, buildTool })
    expect(rendered).toContain('nightly-required:')
    expect(rendered).toContain('if: always()')
  })

  it.each(LEVELS)('governance %s: no EJS tag leaks', (level) => {
    const rendered = renderNightlyPartial({ governanceLevel: level })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it('service archetype: toxiproxy-resilience job present with pinned binary', () => {
    const rendered = renderNightlyPartial({ archetype: 'backend-web-db' })
    expect(rendered).toContain('toxiproxy-resilience:')
    expect(rendered).not.toContain('shopify/toxiproxy-github-action')
    expect(rendered).toContain('releases/download/v2.12.0/toxiproxy-server-linux-amd64')
  })
})

// #1693 (ADR-101): runnerProfile axis. 'fleet' (default) keeps fuzz+soak-e2e at
// nightly cadence (byte-behavior-identical to pre-#1693). 'solo' moves them to
// the weekly partial (see _weekly-render.test.ts) — nightly must drop both the
// job definitions AND every dangling needs:/RESULTS reference to them.
describe('_nightly.yml.ejs — runnerProfile axis (#1693, ADR-101)', () => {
  const STACKS = [
    { language: 'typescript', buildTool: 'npm' },
    { language: 'java', buildTool: 'gradle' },
    { language: 'go', buildTool: 'go' },
    { language: 'python', buildTool: 'pip' },
    { language: 'rust', buildTool: 'cargo' },
  ] as const

  it.each(STACKS)(
    '$language: fleet (default) keeps fuzz + soak-e2e nightly',
    ({ language, buildTool }) => {
      const rendered = renderNightlyPartial({ language, buildTool })
      expect(rendered).toContain('fuzz:')
      expect(rendered).toContain('soak-e2e:')
      expect(rendered).toContain('- fuzz')
      expect(rendered).toContain('- soak-e2e')
      expect(rendered).toContain('needs.fuzz.result')
      expect(rendered).toContain('needs.soak-e2e.result')
    },
  )

  it.each(STACKS)(
    '$language: runnerProfile=solo removes fuzz + soak-e2e from nightly entirely',
    ({ language, buildTool }) => {
      const rendered = renderNightlyPartial({ language, buildTool, runnerProfile: 'solo' })
      expect(rendered).not.toContain('fuzz:')
      expect(rendered).not.toContain('soak-e2e:')
      expect(rendered).not.toContain('- fuzz')
      expect(rendered).not.toContain('- soak-e2e')
      expect(rendered).not.toContain('needs.fuzz.result')
      expect(rendered).not.toContain('needs.soak-e2e.result')
    },
  )

  it('runnerProfile=solo leaves no EJS tag leaks', () => {
    const rendered = renderNightlyPartial({ runnerProfile: 'solo' })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  // #1693 INV-48: direct path-string render of the extracted partial (not merely
  // transitive coverage via the parent) — satisfies check-template-tests.mjs's
  // literal relPath/stem match without bumping the baseline.
  it('scheduled-heavy-jobs.ejs partial renders fuzz + soak-e2e directly', () => {
    const rendered = renderTemplate(
      'github/workflows/_partials/scheduled-heavy-jobs.ejs',
      makeConfig('/tmp/test', { language: 'typescript', buildTool: 'npm' }),
    )
    expect(rendered).toContain('fuzz:')
    expect(rendered).toContain('soak-e2e:')
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })
})

// #1803: kotlin fell through every language branch in the fuzz job (no
// dedicated kotlin arm, and `language === 'java'` is a strict-equality check
// that never matches 'kotlin') — the job rendered checkout-only, silently
// running no fuzzer at all despite the cross-language-matrix claiming
// coverage. jqwik operates on JVM bytecode, so kotlin now shares the java arm.
describe('_nightly.yml.ejs — kotlin fuzz coverage (#1803)', () => {
  it.each(['gradle', 'maven'] as const)(
    'kotlin/%s: fuzz job runs jqwik via the java/JVM branch, not checkout-only',
    (buildTool) => {
      const rendered = renderNightlyPartial({ language: 'kotlin', buildTool })
      const jobStart = rendered.indexOf('fuzz:')
      const jobEnd = rendered.indexOf('soak-e2e:')
      const fuzzSection = rendered.slice(jobStart, jobEnd)
      expect(fuzzSection).toContain('actions/setup-java')
      expect(fuzzSection).toContain('jqwik property-based tests')
      expect(fuzzSection).toContain(buildTool === 'gradle' ? './gradlew test' : 'mvn test')
      expect(fuzzSection).toContain('-Djqwik.database=false')
    },
  )

  it('kotlin leaves no EJS tag leaks', () => {
    const rendered = renderNightlyPartial({ language: 'kotlin', buildTool: 'gradle' })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })
})

// #1854/#1856 — the `generated-gate-e2e` job (arbiter-self-render only)
// installs globally pinned Go tools onto whatever Go toolchain
// `go-version-file` resolves from the go-library fixture's own go.mod.
// actions/setup-go v6 pins GOTOOLCHAIN=local right after installing that
// toolchain (v5 never touched GOTOOLCHAIN at all), so the `go` tool can no
// longer silently self-upgrade to satisfy a newer requirement the way it used
// to under GOTOOLCHAIN=auto. That makes EVERY pinned tool's minimum-go a hard
// constraint on the fixture's go directive, not just golangci-lint's:
// round 1 (#1854, run 28991350328) golangci-lint v2.5.0 needed go >= 1.24 vs
// fixture 1.22; round 2 (#1856, run 29002271128) govulncheck v1.5.0 needed
// go >= 1.25 vs fixture 1.24. This guard enumerates all pinned `go install`
// lines and fails when any pin outgrows the fixture.
describe('_nightly.yml.ejs — generated-gate-e2e Go toolchain satisfies every pinned tool (#1854/#1856)', () => {
  // MIN_GO_FOR_PINNED_TOOL is now shared with the generator-matrix.yml literal-file
  // guard (__tests__/scripts/generator-matrix-workflow.test.ts) — see
  // __tests__/helpers/go-pinned-tool-minimums.ts. Bump it there alongside any tool
  // pin bump in either surface.

  function renderSelfProfile() {
    // Mirrors __tests__/fixtures/ci-tier-render-context.json's shape: this job
    // block only renders for arbiter's own typescript self-render.
    return renderNightlyPartial({
      language: 'typescript',
      buildTool: 'npm',
      enableNativeBakeE2E: true,
    } as Record<string, unknown>)
  }

  it('go-version-file fixture declares a go directive >= every pinned tool minimum', () => {
    const rendered = renderSelfProfile()

    const pins = extractGoInstallPins(rendered)
    expect(pins.length, 'expected pinned go install lines in generated-gate-e2e').toBeGreaterThan(0)

    const fileMatch = rendered.match(/go-version-file:\s*(\S+go-library\/go\.mod)/)
    expect(fileMatch, 'expected go-version-file to point at the go-library fixture').not.toBeNull()
    const goModPath = resolve(fileMatch![1])
    const goModContent = readFileSync(goModPath, 'utf-8')
    const directiveMatch = goModContent.match(/^go (\d+\.\d+)/m)
    expect(directiveMatch, `expected a \`go X.Y\` directive in ${goModPath}`).not.toBeNull()
    const [fixMajor, fixMinor] = directiveMatch![1].split('.').map(Number)

    for (const { tool, version } of pins) {
      const minGo = MIN_GO_FOR_PINNED_TOOL[tool]?.[version]
      expect(
        minGo,
        `no known minimum Go version recorded for ${tool}@${version} — ` +
          'add it to MIN_GO_FOR_PINNED_TOOL in this test (read the module go directive from ' +
          'proxy.golang.org)',
      ).toBeDefined()

      const [minMajor, minMinor] = (minGo as string).split('.').map(Number)
      const satisfies = fixMajor > minMajor || (fixMajor === minMajor && fixMinor >= minMinor)
      expect(
        satisfies,
        `go-library fixture pins go ${directiveMatch![1]} but ${tool}@${version} requires ` +
          `go >= ${minGo} — actions/setup-go v6 pins GOTOOLCHAIN=local so this fails hard in CI ` +
          '(#1854/#1856)',
      ).toBe(true)
    }
  })

  it('go setup steps set cache-dependency-path for the go-library fixture (not at repo root)', () => {
    const rendered = renderSelfProfile()
    const goVersionFileCount = (
      rendered.match(/go-version-file: __tests__\/fixtures\/real-projects\/go-library\/go\.mod/g) ??
      []
    ).length
    const cacheDepCount = (
      rendered.match(
        /cache-dependency-path: __tests__\/fixtures\/real-projects\/go-library\/go\.mod/g,
      ) ?? []
    ).length
    expect(goVersionFileCount).toBeGreaterThan(0)
    expect(cacheDepCount).toBe(goVersionFileCount)
  })
})

// #2314 — the nightly went red the day the greenfield generated-gate job landed.
// `greenfield-first-run.test.ts`'s useGitHub cell drives `arbiter init --github`, and
// src/detectors/github.ts honours `--github` only when it finds an AUTHENTICATED gh.
// The job's env carried VITEST_L2 alone, so on CI `permitGitHub` resolved false, init
// emitted no .github/workflows at all (silently — that half is the separate product
// defect #2315), and the cell's workflow-gate assertions failed. Green on a dev box
// whose gh is logged in, red in CI, for want of one env line.
describe('_nightly.yml.ejs — gh-dependent e2e steps carry a token (#2314)', () => {
  it('the greenfield generated-gate step passes GH_TOKEN to the suite that runs init --github', () => {
    const rendered = renderNightlyPartial({
      language: 'typescript',
      buildTool: 'npm',
      enableNativeBakeE2E: true,
    } as Record<string, unknown>)

    // The step block: from its `- name:` line to the start of the next step OR the
    // next job key — the greenfield step is its job's last, so the job boundary is
    // what actually terminates it.
    const step = rendered
      .split(/^ {6}- (?=name:|uses:)|^ {2}(?=[a-z0-9-]+:$)/m)
      .find((s) => s.includes('greenfield-first-run.test.ts'))
    expect(step, 'expected a nightly step running greenfield-first-run.test.ts').toBeDefined()
    expect(
      step,
      'the greenfield e2e step must carry a gh token: its useGitHub cell needs an ' +
        'authenticated gh or `init --github` emits no workflows and the cell fails (#2314)',
    ).toContain('GH_TOKEN: ${{ github.token }}')
  })
})
