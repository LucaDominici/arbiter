import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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
