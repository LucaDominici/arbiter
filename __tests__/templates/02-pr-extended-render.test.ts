import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderExt(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'github/workflows/02-pr-extended.yml.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

// ─── CANON-18: structural invariants ─────────────────────────────────────────

describe('02-pr-extended.yml.ejs — structural invariants (CANON-18)', () => {
  const STACKS = [
    { language: 'typescript', buildTool: 'npm' },
    { language: 'java', buildTool: 'gradle' },
    { language: 'go', buildTool: 'go' },
    { language: 'python', buildTool: 'pip' },
    { language: 'rust', buildTool: 'cargo' },
  ] as const

  const LEVELS = ['L1', 'L2', 'L3'] as const

  it.each(STACKS)('$language: workflow name is "PR Extended (T2)"', ({ language, buildTool }) => {
    const rendered = renderExt({ language, buildTool })
    expect(rendered).toContain('name: PR Extended (T2)')
  })

  it.each(STACKS)(
    '$language: top-level permissions sets contents: read',
    ({ language, buildTool }) => {
      const rendered = renderExt({ language, buildTool })
      expect(rendered).toContain('permissions:')
      expect(rendered).toContain('contents: read')
    },
  )

  it.each(STACKS)('$language: concurrency group uses head_ref', ({ language, buildTool }) => {
    const rendered = renderExt({ language, buildTool })
    expect(rendered).toContain('group: pr-extended-${{ github.head_ref || github.ref }}')
  })

  it.each(STACKS)('$language: check-trigger job present', ({ language, buildTool }) => {
    const rendered = renderExt({ language, buildTool })
    expect(rendered).toContain('check-trigger:')
    expect(rendered).toContain('should_run')
    expect(rendered).toContain('extended-ci')
  })

  it.each(STACKS)('$language: integration-tests job present', ({ language, buildTool }) => {
    const rendered = renderExt({ language, buildTool })
    expect(rendered).toContain('integration-tests:')
    expect(rendered).toContain("needs.check-trigger.outputs.should_run == 'true'")
  })

  it.each(STACKS)('$language: license-scan job present', ({ language, buildTool }) => {
    const rendered = renderExt({ language, buildTool })
    expect(rendered).toContain('license-scan:')
  })

  it.each(STACKS)('$language: behavioral-tests job present', ({ language, buildTool }) => {
    const rendered = renderExt({ language, buildTool })
    expect(rendered).toContain('behavioral-tests:')
  })

  it.each(STACKS)('$language: extended-required aggregator present', ({ language, buildTool }) => {
    const rendered = renderExt({ language, buildTool })
    expect(rendered).toContain('extended-required:')
    expect(rendered).toContain('if: always()')
  })

  it.each(LEVELS)('governance %s: no EJS tag leaks', (level) => {
    const rendered = renderExt({ governanceLevel: level })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it.each(LEVELS)(
    'governance %s: extended-required uses == "failure" not != "success"',
    (level) => {
      const rendered = renderExt({ governanceLevel: level })
      // aggregator must pass when jobs are skipped (== "failure" not != "success")
      expect(rendered).toContain('== "failure"')
      expect(rendered).not.toContain('!= "success"')
    },
  )
})

// ─── Per-language integration-tests steps ────────────────────────────────────

describe('02-pr-extended.yml.ejs — per-language integration steps', () => {
  it('TypeScript: setup-node-pnpm composite + npm run test:integration', () => {
    const rendered = renderExt({ language: 'typescript', buildTool: 'npm' })
    // #1131: setup-node + `npm ci` consolidated into the setup-node-pnpm composite.
    expect(rendered).toContain('./.github/actions/setup-node-pnpm')
    expect(rendered).toContain('test:integration')
  })

  it('Java Gradle: setup-java + setup-gradle + gradlew integrationTest', () => {
    const rendered = renderExt({ language: 'java', buildTool: 'gradle' })
    expect(rendered).toContain('setup-java')
    expect(rendered).toContain('setup-gradle')
    expect(rendered).toContain('integrationTest')
  })

  it('Java Maven: setup-java + mvn test -Pintegration', () => {
    const rendered = renderExt({ language: 'java', buildTool: 'maven' })
    expect(rendered).toContain('setup-java')
    expect(rendered).toContain('mvn test -Pintegration')
  })

  it('Go: setup-go + go test -tags integration', () => {
    const rendered = renderExt({ language: 'go', buildTool: 'go' })
    expect(rendered).toContain('setup-go')
    expect(rendered).toContain('go test -tags integration')
  })

  it('Python: setup-python + pytest -m integration', () => {
    const rendered = renderExt({ language: 'python', buildTool: 'pip' })
    expect(rendered).toContain('setup-python')
    expect(rendered).toContain('pytest -m integration')
  })

  it('Rust: rust-toolchain + cargo test --test integration', () => {
    const rendered = renderExt({ language: 'rust', buildTool: 'cargo' })
    expect(rendered).toContain('rust-toolchain')
    expect(rendered).toContain('cargo test --test integration')
  })
})

// ─── Service archetype gating ─────────────────────────────────────────────────

describe('02-pr-extended.yml.ejs — service archetype gating', () => {
  it('service archetype: container-scan, dast-baseline, load-smoke present', () => {
    const rendered = renderExt({ archetype: 'backend-web-db' })
    expect(rendered).toContain('container-scan:')
    expect(rendered).toContain('dast-baseline:')
    expect(rendered).toContain('load-smoke:')
  })

  it('service archetype: Trivy HIGH,CRITICAL exit-code 1', () => {
    const rendered = renderExt({ archetype: 'backend-web-db' })
    expect(rendered).toContain("severity: 'HIGH,CRITICAL'")
    expect(rendered).toContain("exit-code: '1'")
  })

  it('service archetype: OWASP ZAP baseline present', () => {
    const rendered = renderExt({ archetype: 'backend-web-db' })
    expect(rendered).toContain('zaproxy/action-baseline')
    expect(rendered).toContain('fail_action: true')
  })

  it('service archetype: k6 smoke test 60s present', () => {
    const rendered = renderExt({ archetype: 'backend-web-db' })
    expect(rendered).toContain('k6 run')
    expect(rendered).toContain('60s')
  })

  it('service archetype: Toxiproxy step in integration-tests', () => {
    const rendered = renderExt({ archetype: 'backend-web-db', language: 'typescript' })
    expect(rendered).toContain('Toxiproxy resilience test')
    expect(rendered).toContain('test:resilience')
  })

  it('service archetype: service jobs listed in extended-required needs', () => {
    const rendered = renderExt({ archetype: 'backend-web-db' })
    const aggregator = rendered.split('extended-required:')[1] ?? ''
    expect(aggregator).toContain('container-scan')
    expect(aggregator).toContain('dast-baseline')
    expect(aggregator).toContain('load-smoke')
  })

  it('library archetype: no container-scan, dast-baseline, load-smoke', () => {
    const rendered = renderExt({ archetype: 'library' })
    expect(rendered).not.toContain('container-scan:')
    expect(rendered).not.toContain('dast-baseline:')
    expect(rendered).not.toContain('load-smoke:')
  })

  it('cli archetype: no container-scan, dast-baseline, load-smoke', () => {
    const rendered = renderExt({ archetype: 'cli' })
    expect(rendered).not.toContain('container-scan:')
    expect(rendered).not.toContain('dast-baseline:')
    expect(rendered).not.toContain('load-smoke:')
  })

  it('library archetype: no Toxiproxy step', () => {
    const rendered = renderExt({ archetype: 'library', language: 'typescript' })
    expect(rendered).not.toContain('Toxiproxy')
  })
})

// ─── Contract gating ─────────────────────────────────────────────────────────

describe('02-pr-extended.yml.ejs — contract-extended gating', () => {
  it('contractType=none: no contract-extended job', () => {
    const rendered = renderExt({ contractType: 'none' })
    expect(rendered).not.toContain('contract-extended:')
  })

  it('contractType=rest-owned: contract-extended present', () => {
    const rendered = renderExt({ contractType: 'rest-owned', language: 'typescript' })
    expect(rendered).toContain('contract-extended:')
    expect(rendered).toContain('can-i-deploy')
  })

  it('contractType=graphql: GraphQL schema diff step present', () => {
    const rendered = renderExt({ contractType: 'graphql', language: 'typescript' })
    expect(rendered).toContain('contract-extended:')
    expect(rendered).toContain('schema diff')
  })

  it('contractType=grpc: protobuf breaking check present', () => {
    const rendered = renderExt({ contractType: 'grpc', language: 'typescript' })
    expect(rendered).toContain('contract-extended:')
    expect(rendered).toContain('breaking')
  })

  it('contractType=rest-owned: contract-extended listed in extended-required needs', () => {
    const rendered = renderExt({ contractType: 'rest-owned', language: 'typescript' })
    const aggregator = rendered.split('extended-required:')[1] ?? ''
    expect(aggregator).toContain('contract-extended')
  })

  it('contractType=none: contract-extended NOT in extended-required needs', () => {
    const rendered = renderExt({ contractType: 'none' })
    const aggregator = rendered.split('extended-required:')[1] ?? ''
    expect(aggregator).not.toContain('contract-extended')
  })
})

// ─── License-scan per-language tools ─────────────────────────────────────────

describe('02-pr-extended.yml.ejs — license-scan per-language tools', () => {
  it('TypeScript: license-checker with allowed list', () => {
    const rendered = renderExt({ language: 'typescript' })
    expect(rendered).toContain('license-checker')
    expect(rendered).toContain('MIT')
  })

  it('Java Gradle: generateLicenseReport', () => {
    const rendered = renderExt({ language: 'java', buildTool: 'gradle' })
    expect(rendered).toContain('generateLicenseReport')
  })

  it('Java Maven: license:third-party-report', () => {
    const rendered = renderExt({ language: 'java', buildTool: 'maven' })
    expect(rendered).toContain('license:third-party-report')
  })

  it('Go: go-licenses check', () => {
    const rendered = renderExt({ language: 'go', buildTool: 'go' })
    expect(rendered).toContain('go-licenses')
    expect(rendered).toContain('forbidden,restricted')
  })

  it('Python: pip-licenses with allow-only list', () => {
    const rendered = renderExt({ language: 'python', buildTool: 'pip' })
    expect(rendered).toContain('pip-licenses')
    expect(rendered).toContain('--allow-only')
  })

  it('Rust: cargo-deny check licenses', () => {
    const rendered = renderExt({ language: 'rust', buildTool: 'cargo' })
    expect(rendered).toContain('cargo-deny')
    expect(rendered).toContain('check licenses')
  })
})

// ─── Build-cache wiring (E2, #1500/#1502) ────────────────────────────────────
//
// The node-workspace build-cache composite is wired into the build/test graph:
// a single build-workspace `save` job builds dist once; behavioral-tests and
// bake-e2e-tests `restore` it (non-blocking rebuild fallback) instead of each
// re-running `npm run build`. This generalises the Maven-only reactor handoff.

describe('02-pr-extended.yml.ejs — build-cache wiring (E2, #1500)', () => {
  it('TypeScript: a build-workspace job saves the workspace via the build-cache action', () => {
    const rendered = renderExt({ language: 'typescript', buildTool: 'npm' })
    expect(rendered).toContain('build-workspace:')
    expect(rendered).toContain('uses: ./.github/actions/build-cache')
    expect(rendered).toContain('op: save')
    expect(rendered).toContain('op: restore')
  })

  it('TypeScript: behavioral + bake jobs restore instead of re-running npm run build', () => {
    const rendered = renderExt({ language: 'typescript', buildTool: 'npm' })
    // the always-on inline `npm run build` in behavioral/bake is replaced by restore
    expect(rendered).not.toContain('- run: npm run build\n')
    // behavioral-tests now depends on build-workspace
    expect(rendered).toMatch(
      /behavioral-tests:[\s\S]{0,200}?needs:\s*\[check-trigger, build-workspace\]/,
    )
  })

  it('TypeScript: extended-required closes the false-green hole for build-workspace', () => {
    const rendered = renderExt({ language: 'typescript', buildTool: 'npm' })
    const aggregator = rendered.split('extended-required:')[1] ?? ''
    expect(aggregator).toContain('build-workspace')
    expect(aggregator).toContain('needs.build-workspace.result')
  })

  it('adversarial: non-node languages get no build-workspace job', () => {
    for (const language of ['go', 'rust', 'python'] as const) {
      const rendered = renderExt({ language, buildTool: language })
      expect(rendered).not.toContain('build-workspace:')
    }
  })
})

// ─── Check-trigger logic ─────────────────────────────────────────────────────

describe('02-pr-extended.yml.ejs — check-trigger trigger conditions', () => {
  it('uses contains() expression for label detection (not grep on JSON)', () => {
    const rendered = renderExt({})
    expect(rendered).toContain('contains(github.event.pull_request.labels.*.name')
    expect(rendered).toContain('extended-ci')
  })

  it('triggers on ready_for_review event action', () => {
    const rendered = renderExt({})
    expect(rendered).toContain('ready_for_review')
  })

  // C2 (#1497): the sensitive-path list is no longer inlined in the workflow —
  // the check-trigger job reads the version-controlled SSOT via `grep -E -f`.
  it('reads the sensitive-path SSOT file (not inlined regexes)', () => {
    const rendered = renderExt({})
    expect(rendered).toContain('.github/extended-ci-paths.txt')
    expect(rendered).toContain('grep -qE -f')
    // The old inlined directory regex must be gone (proves the SSOT drives it).
    expect(rendered).not.toContain("grep -qE '^(migrations/|infra/|openapi/|schemas/)'")
  })

  it('parameterizes the LOC threshold via EXTENDED_CI_LOC_THRESHOLD var (default 100)', () => {
    const rendered = renderExt({})
    expect(rendered).toContain("vars.EXTENDED_CI_LOC_THRESHOLD || '100'")
    expect(rendered).toContain('THRESHOLD="${LOC_THRESHOLD:-100}"')
    expect(rendered).toContain('LOC >= THRESHOLD')
    // No bare hardcoded threshold comparison remains.
    expect(rendered).not.toContain('(( LOC >= 100 ))')
  })

  it('writes should_run to GITHUB_OUTPUT', () => {
    const rendered = renderExt({})
    expect(rendered).toContain('should_run=${SHOULD_RUN}')
    expect(rendered).toContain('GITHUB_OUTPUT')
  })
})
