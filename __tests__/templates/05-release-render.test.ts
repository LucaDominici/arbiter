import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderRelease(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'github/workflows/05-release.yml.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

// ─── CANON-18: structural invariants ─────────────────────────────────────────

describe('05-release.yml.ejs — structural invariants (CANON-18)', () => {
  const STACKS = [
    { language: 'typescript', buildTool: 'npm' },
    { language: 'java', buildTool: 'gradle' },
    { language: 'go', buildTool: 'go' },
    { language: 'python', buildTool: 'pip' },
    { language: 'rust', buildTool: 'cargo' },
  ] as const

  const LEVELS = ['L1', 'L2', 'L3'] as const

  it.each(STACKS)('$language: workflow name is "Release (T3)"', ({ language, buildTool }) => {
    const rendered = renderRelease({ language, buildTool })
    expect(rendered).toContain('name: Release (T3)')
  })

  it.each(STACKS)(
    '$language: top-level permissions is contents: read only',
    ({ language, buildTool }) => {
      const rendered = renderRelease({ language, buildTool })
      expect(rendered).toContain('contents: read')
    },
  )

  it.each(STACKS)('$language: build-superset job present', ({ language, buildTool }) => {
    const rendered = renderRelease({ language, buildTool })
    expect(rendered).toContain('build-superset:')
    expect(rendered).toContain('hashes:')
  })

  it.each(STACKS)('$language: mutation-blocking job present', ({ language, buildTool }) => {
    const rendered = renderRelease({ language, buildTool })
    expect(rendered).toContain('mutation-blocking:')
  })

  it.each(STACKS)('$language: secret-scan-history job present', ({ language, buildTool }) => {
    const rendered = renderRelease({ language, buildTool })
    expect(rendered).toContain('secret-scan-history:')
    expect(rendered).toContain('fetch-depth: 0')
  })

  it.each(STACKS)(
    '$language: sbom job present with 90-day retention',
    ({ language, buildTool }) => {
      const rendered = renderRelease({ language, buildTool })
      expect(rendered).toContain('sbom:')
      expect(rendered).toContain('retention-days: 90')
    },
  )

  it.each(STACKS)('$language: cosign-sign job present', ({ language, buildTool }) => {
    const rendered = renderRelease({ language, buildTool })
    expect(rendered).toContain('cosign-sign:')
    expect(rendered).toContain('cosign sign-blob')
    expect(rendered).toContain('sigstore/cosign-installer')
  })

  it.each(STACKS)('$language: slsa-provenance job present', ({ language, buildTool }) => {
    const rendered = renderRelease({ language, buildTool })
    expect(rendered).toContain('slsa-provenance:')
    expect(rendered).toContain('slsa-framework/slsa-github-generator')
    expect(rendered).toContain('id-token: write')
  })

  it.each(STACKS)('$language: attest-build-provenance job present', ({ language, buildTool }) => {
    const rendered = renderRelease({ language, buildTool })
    expect(rendered).toContain('attest-build-provenance:')
    expect(rendered).toContain('actions/attest-build-provenance')
  })

  it.each(STACKS)('$language: release-required aggregator present', ({ language, buildTool }) => {
    const rendered = renderRelease({ language, buildTool })
    expect(rendered).toContain('release-required:')
    expect(rendered).toContain('if: always()')
  })

  it.each(LEVELS)('governance %s: no EJS tag leaks', (level) => {
    const rendered = renderRelease({ governanceLevel: level })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })
})

// ─── Triggers and concurrency ─────────────────────────────────────────────────

describe('05-release.yml.ejs — triggers and concurrency', () => {
  it('tag trigger present', () => {
    const rendered = renderRelease({})
    expect(rendered).toContain("- 'v*'")
    expect(rendered).toContain("- '!v0.0.0-verify-*'")
  })

  // E3: the release workflow is PROD-only. A `pull_request` trigger caused the
  // entire sign/SBOM/SLSA/attest/trivy-strict machinery to run on every PR to
  // main (the build-superset/mutation/secret-history/sbom jobs had no event
  // guard). The trigger is removed so release machinery runs only on tag push.
  it('no pull_request trigger (release machinery is PROD-only)', () => {
    const rendered = renderRelease({})
    expect(rendered).not.toContain('pull_request:')
  })

  it('no PR branch filter (the only branches: filter was the PR trigger)', () => {
    const rendered = renderRelease({})
    expect(rendered).not.toContain('branches: [main]')
  })

  it('concurrency cancel-in-progress is false', () => {
    const rendered = renderRelease({})
    expect(rendered).toContain('cancel-in-progress: false')
  })

  // Defense-in-depth: the signing chain keeps its non-PR event guards so that
  // if a future edit re-introduces a PR/dispatch trigger, signing stays PROD-only.
  it('signing jobs keep non-PR event guards (defense-in-depth)', () => {
    const rendered = renderRelease({})
    expect(rendered).toContain("github.event_name != 'pull_request'")
  })
})

// ─── Governance level branching ───────────────────────────────────────────────

describe('05-release.yml.ejs — governance level branching', () => {
  // #1505 gold-align: mutation testing is BLOCKING at every level the release workflow emits at,
  // including L1 — the prior `continue-on-error: <level === L1>` left a fake-green window where a
  // red (or empty) mutation run silently passed at L1.
  it('L1: mutation-blocking is continue-on-error: false (blocking, #1505)', () => {
    const rendered = renderRelease({ governanceLevel: 'L1' })
    const mutSection = (rendered.split('mutation-blocking:')[1] ?? '').split(
      'secret-scan-history:',
    )[0]
    expect(mutSection).toContain('continue-on-error: false')
    expect(mutSection).not.toContain('continue-on-error: true')
  })

  it('L2: mutation-blocking is continue-on-error: false (blocking)', () => {
    const rendered = renderRelease({ governanceLevel: 'L2' })
    const mutSection = rendered.split('mutation-blocking:')[1] ?? ''
    expect(mutSection).toContain('continue-on-error: false')
  })

  it('L3: mutation-blocking is continue-on-error: false (blocking)', () => {
    const rendered = renderRelease({ governanceLevel: 'L3' })
    const mutSection = rendered.split('mutation-blocking:')[1] ?? ''
    expect(mutSection).toContain('continue-on-error: false')
  })

  it('L3: slsa-provenance name mentions L3 hermetic', () => {
    const rendered = renderRelease({ governanceLevel: 'L3' })
    expect(rendered).toContain('L3 hermetic')
  })

  // E4 (#1502): the release gate consumes the latest nightly mutation-deep result
  // instead of re-running the full mutation suite synchronously — release latency is
  // decoupled from mutation runtime. A level-gated fallback runs mutation only when
  // no fresh nightly result exists.
  describe('E4: mutation-blocking consumes nightly mutation-deep (#1502)', () => {
    it('reads the latest nightly mutation result via gh (no synchronous re-run by default)', () => {
      const rendered = renderRelease({})
      const mutSection = rendered.split('mutation-blocking:')[1] ?? ''
      expect(mutSection).toContain('Consume latest nightly mutation-deep result')
      expect(mutSection).toContain('gh run list')
      expect(mutSection).toContain('06-nightly.yml')
      expect(mutSection).toContain('Deep mutation testing')
    })

    it('fallback mutation run is guarded by the no-fresh-nightly condition', () => {
      const rendered = renderRelease({ language: 'typescript' })
      const mutSection = rendered.split('mutation-blocking:')[1] ?? ''
      expect(mutSection).toContain("if: steps.nightly.outputs.fresh != 'true'")
      expect(mutSection).toContain('npx stryker run')
    })

    it('job has actions: read permission to read the nightly run status', () => {
      const rendered = renderRelease({})
      const mutSection = (rendered.split('mutation-blocking:')[1] ?? '').split(
        'secret-scan-history:',
      )[0]
      expect(mutSection).toContain('actions: read')
    })

    it('freshness window is parameterized (MUTATION_NIGHTLY_MAX_AGE_DAYS)', () => {
      const rendered = renderRelease({})
      expect(rendered).toContain('MUTATION_NIGHTLY_MAX_AGE_DAYS')
    })
  })

  it('L2: slsa-provenance name mentions L2 signed', () => {
    const rendered = renderRelease({ governanceLevel: 'L2' })
    expect(rendered).toContain('L2 signed')
  })

  it('L1: slsa-provenance name mentions L2 signed (same as L2)', () => {
    const rendered = renderRelease({ governanceLevel: 'L1' })
    expect(rendered).toContain('L2 signed')
  })

  it('L2: cosign verify-blob step present in cosign-sign job (INV-101)', () => {
    const rendered = renderRelease({ governanceLevel: 'L2' })
    expect(rendered).toContain('cosign verify-blob')
    expect(rendered).toContain('token.actions.githubusercontent.com')
  })

  it('L3: cosign verify-blob step present in cosign-sign job (INV-101)', () => {
    const rendered = renderRelease({ governanceLevel: 'L3' })
    expect(rendered).toContain('cosign verify-blob')
    expect(rendered).toContain('token.actions.githubusercontent.com')
  })

  it('L1: no cosign verify-blob step (L1 stays lightweight)', () => {
    const rendered = renderRelease({ governanceLevel: 'L1' })
    expect(rendered).not.toContain('cosign verify-blob')
  })
})

// ─── Archetype gating ─────────────────────────────────────────────────────────

describe('05-release.yml.ejs — archetype gating', () => {
  it('library archetype: publish-package job present', () => {
    const rendered = renderRelease({ archetype: 'library' })
    expect(rendered).toContain('publish-package:')
    expect(rendered).not.toContain('build-container:')
    expect(rendered).not.toContain('build-binaries:')
    expect(rendered).not.toContain('bundle-artifact:')
  })

  it('backend-web-db archetype: build-container job present', () => {
    const rendered = renderRelease({ archetype: 'backend-web-db' })
    expect(rendered).toContain('build-container:')
    expect(rendered).not.toContain('publish-package:')
    expect(rendered).not.toContain('build-binaries:')
  })

  it('cli archetype: build-binaries job present', () => {
    const rendered = renderRelease({ archetype: 'cli' })
    expect(rendered).toContain('build-binaries:')
    expect(rendered).not.toContain('publish-package:')
    expect(rendered).not.toContain('build-container:')
  })

  it('data-pipeline archetype: bundle-artifact job present', () => {
    const rendered = renderRelease({ archetype: 'data-pipeline' })
    expect(rendered).toContain('bundle-artifact:')
    expect(rendered).not.toContain('publish-package:')
    expect(rendered).not.toContain('build-container:')
  })

  it('library archetype: release-required needs publish-package', () => {
    const rendered = renderRelease({ archetype: 'library' })
    const aggregator = rendered.split('release-required:')[1] ?? ''
    expect(aggregator).toContain('publish-package')
  })

  it('backend-web-db archetype: release-required needs build-container', () => {
    const rendered = renderRelease({ archetype: 'backend-web-db' })
    const aggregator = rendered.split('release-required:')[1] ?? ''
    expect(aggregator).toContain('build-container')
  })

  it('cli archetype: release-required needs build-binaries', () => {
    const rendered = renderRelease({ archetype: 'cli' })
    const aggregator = rendered.split('release-required:')[1] ?? ''
    expect(aggregator).toContain('build-binaries')
  })
})

// ─── Per-language mutation tools ──────────────────────────────────────────────

describe('05-release.yml.ejs — per-language mutation tools', () => {
  it('TypeScript: stryker run', () => {
    const rendered = renderRelease({ language: 'typescript', buildTool: 'npm' })
    expect(rendered).toContain('stryker run')
  })

  it('Java Gradle: pitest', () => {
    const rendered = renderRelease({ language: 'java', buildTool: 'gradle' })
    expect(rendered).toContain('pitest')
  })

  it('Java Maven: pitest:mutationCoverage', () => {
    const rendered = renderRelease({ language: 'java', buildTool: 'maven' })
    expect(rendered).toContain('pitest:mutationCoverage')
  })

  it('Go: go-mutesting', () => {
    const rendered = renderRelease({ language: 'go', buildTool: 'go' })
    expect(rendered).toContain('go-mutesting')
  })

  it('Python: mutmut run', () => {
    const rendered = renderRelease({ language: 'python', buildTool: 'pip' })
    expect(rendered).toContain('mutmut run')
  })

  it('Rust: cargo mutants', () => {
    const rendered = renderRelease({ language: 'rust', buildTool: 'cargo' })
    expect(rendered).toContain('cargo mutants')
  })
})

// ─── #1505: mutation testing is blocking with fail-on-empty, no swallow ───────

describe('05-release.yml.ejs — mutation is blocking + fail-on-empty (#1505)', () => {
  const STACKS = [
    { language: 'typescript', buildTool: 'npm' },
    { language: 'java', buildTool: 'gradle' },
    { language: 'java', buildTool: 'maven' },
    { language: 'go', buildTool: 'go' },
    { language: 'python', buildTool: 'pip' },
    { language: 'rust', buildTool: 'cargo' },
  ] as const

  const LEVELS = ['L1', 'L2', 'L3'] as const

  function mutSection(overrides: Record<string, unknown>): string {
    const rendered = renderRelease(overrides)
    return (rendered.split('mutation-blocking:')[1] ?? '').split('secret-scan-history:')[0]
  }

  it.each(LEVELS)('governance %s: mutation-blocking job is NOT advisory', (governanceLevel) => {
    const section = mutSection({ governanceLevel })
    // The only continue-on-error in the job is the explicit blocking marker.
    expect(section).toContain('continue-on-error: false')
    expect(section).not.toContain('continue-on-error: true')
  })

  it.each(STACKS)(
    '$language/$buildTool: fail-on-empty guard step is present and gated on no-fresh-nightly',
    ({ language, buildTool }) => {
      const section = mutSection({ language, buildTool })
      expect(section).toContain('Fail when the mutation run produced no mutants')
      expect(section).toContain('an empty run is not a pass')
      // The guard runs in the same no-fresh-nightly fallback window as the tool.
      expect(section).toContain("if: steps.nightly.outputs.fresh != 'true'")
    },
  )

  it.each(STACKS)(
    '$language/$buildTool: mutation output is captured to mutation-fallback.log',
    ({ language, buildTool }) => {
      const section = mutSection({ language, buildTool })
      expect(section).toContain('tee mutation-fallback.log')
    },
  )

  // The Go fallback previously swallowed every failure (`continue-on-error: true` + `|| true`).
  it('Go: no `|| true` swallow on the go-mutesting fallback', () => {
    const section = mutSection({ language: 'go', buildTool: 'go' })
    expect(section).toContain('go-mutesting ./... 2>&1 | tee mutation-fallback.log')
    expect(section).not.toContain('go-mutesting ./... || true')
  })

  it.each(LEVELS)(
    'governance %s: no unconditional `|| true` swallows any mutation tool',
    (governanceLevel) => {
      for (const { language, buildTool } of STACKS) {
        const section = mutSection({ governanceLevel, language, buildTool })
        expect(section).not.toMatch(/mutesting \.\/\.\.\. \|\| true/)
        expect(section).not.toMatch(/cargo mutants --all-features\s*\|\| true/)
        expect(section).not.toMatch(/mutmut run\s*\|\| true/)
      }
    },
  )
})

// ─── Per-language SBOM tools ──────────────────────────────────────────────────

describe('05-release.yml.ejs — per-language SBOM', () => {
  it('TypeScript: npm sbom with cyclonedx', () => {
    const rendered = renderRelease({ language: 'typescript', buildTool: 'npm' })
    expect(rendered).toContain('npm sbom')
    expect(rendered).toContain('cyclonedx')
  })

  it('Java Gradle: cyclonedxBom', () => {
    const rendered = renderRelease({ language: 'java', buildTool: 'gradle' })
    expect(rendered).toContain('cyclonedxBom')
  })

  it('Java Maven: cyclonedx:makeAggregateBom', () => {
    const rendered = renderRelease({ language: 'java', buildTool: 'maven' })
    expect(rendered).toContain('cyclonedx:makeAggregateBom')
  })

  it('Go: syft/sbom-action', () => {
    const rendered = renderRelease({ language: 'go', buildTool: 'go' })
    expect(rendered).toContain('sbom-action')
  })

  it('Python: cyclonedx-bom', () => {
    const rendered = renderRelease({ language: 'python', buildTool: 'pip' })
    expect(rendered).toContain('cyclonedx-bom')
  })

  it('Rust: cargo-cyclonedx', () => {
    const rendered = renderRelease({ language: 'rust', buildTool: 'cargo' })
    expect(rendered).toContain('cargo-cyclonedx')
  })
})

// ─── SLSA reusable workflow pattern ───────────────────────────────────────────

describe('05-release.yml.ejs — SLSA reusable workflow', () => {
  it('slsa-provenance uses reusable workflow (uses: at job level)', () => {
    const rendered = renderRelease({})
    expect(rendered).toContain(
      'uses: slsa-framework/slsa-github-generator/.github/workflows/generator_generic_slsa3.yml',
    )
  })

  it('slsa-provenance has id-token: write permission', () => {
    const rendered = renderRelease({})
    const slsaSection = rendered.split('slsa-provenance:')[1] ?? ''
    expect(slsaSection).toContain('id-token: write')
  })

  it('slsa-provenance has actions: read permission', () => {
    const rendered = renderRelease({})
    const slsaSection = rendered.split('slsa-provenance:')[1] ?? ''
    expect(slsaSection).toContain('actions: read')
  })

  it('slsa-provenance passes base64-subjects from build-superset output', () => {
    const rendered = renderRelease({})
    expect(rendered).toContain('base64-subjects')
    expect(rendered).toContain('build-superset.outputs.hashes')
  })
})

// ─── Service archetype: container build ───────────────────────────────────────

describe('05-release.yml.ejs — service archetype container build', () => {
  it('build-container: docker build-push-action present', () => {
    const rendered = renderRelease({ archetype: 'backend-web-db' })
    expect(rendered).toContain('docker/build-push-action')
  })

  it('build-container: cosign sign (image, not sign-blob)', () => {
    const rendered = renderRelease({ archetype: 'backend-web-db' })
    const containerSection = rendered.split('build-container:')[1] ?? ''
    expect(containerSection).toContain('cosign sign --yes')
  })

  it('build-container: trivy vulnerability scan present', () => {
    const rendered = renderRelease({ archetype: 'backend-web-db' })
    expect(rendered).toContain('trivy-action')
  })

  it('build-container: packages: write permission present', () => {
    const rendered = renderRelease({ archetype: 'backend-web-db' })
    const containerSection = rendered.split('build-container:')[1] ?? ''
    expect(containerSection).toContain('packages: write')
  })

  it('build-container: pushes to ghcr.io', () => {
    const rendered = renderRelease({ archetype: 'backend-web-db' })
    expect(rendered).toContain('ghcr.io')
  })
})

// ─── CLI archetype: multi-arch binaries ───────────────────────────────────────

describe('05-release.yml.ejs — cli archetype binary builds', () => {
  it('Go: goreleaser-action present', () => {
    const rendered = renderRelease({ archetype: 'cli', language: 'go', buildTool: 'go' })
    expect(rendered).toContain('goreleaser/goreleaser-action')
  })

  it('Rust: cargo-dist present', () => {
    const rendered = renderRelease({ archetype: 'cli', language: 'rust', buildTool: 'cargo' })
    expect(rendered).toContain('cargo-dist')
  })

  it('Python: pyinstaller present', () => {
    const rendered = renderRelease({ archetype: 'cli', language: 'python', buildTool: 'pip' })
    expect(rendered).toContain('pyinstaller')
  })

  it('Java: graalvm native compilation present', () => {
    const rendered = renderRelease({ archetype: 'cli', language: 'java', buildTool: 'gradle' })
    expect(rendered).toContain('graalvm/setup-graalvm')
  })

  it('TypeScript: ncc bundle present', () => {
    const rendered = renderRelease({ archetype: 'cli', language: 'typescript', buildTool: 'npm' })
    expect(rendered).toContain('@vercel/ncc')
  })
})

// ─── Batch archetype: artifact bundle ────────────────────────────────────────

describe('05-release.yml.ejs — batch archetype artifact bundle', () => {
  it('bundle-artifact: manifest.json created', () => {
    const rendered = renderRelease({ archetype: 'data-pipeline' })
    expect(rendered).toContain('manifest.json')
  })

  it('bundle-artifact: tar bundle created', () => {
    const rendered = renderRelease({ archetype: 'data-pipeline' })
    expect(rendered).toContain('batch-bundle.tar.gz')
  })

  it('bundle-artifact: cosign sign-blob on bundle', () => {
    const rendered = renderRelease({ archetype: 'data-pipeline' })
    const bundleSection = rendered.split('bundle-artifact:')[1] ?? ''
    expect(bundleSection).toContain('cosign sign-blob --yes batch-bundle.tar.gz')
  })

  it('bundle-artifact: 90-day artifact retention', () => {
    const rendered = renderRelease({ archetype: 'data-pipeline' })
    const bundleSection = rendered.split('bundle-artifact:')[1] ?? ''
    expect(bundleSection).toContain('retention-days: 90')
  })
})

// ─── Lib archetype: per-language publish ─────────────────────────────────────

describe('05-release.yml.ejs — lib archetype per-language publish', () => {
  it('TypeScript: npm publish --provenance', () => {
    const rendered = renderRelease({
      archetype: 'library',
      language: 'typescript',
      buildTool: 'npm',
    })
    expect(rendered).toContain('npm publish --provenance')
  })

  it('TypeScript: publish-package job has id-token: write for OIDC provenance', () => {
    const rendered = renderRelease({
      archetype: 'library',
      language: 'typescript',
      buildTool: 'npm',
    })
    const publishSection = rendered.split('publish-package:')[1] ?? ''
    expect(publishSection).toContain('id-token: write')
  })

  it('Java Gradle: ./gradlew publish', () => {
    const rendered = renderRelease({ archetype: 'library', language: 'java', buildTool: 'gradle' })
    const publishSection = rendered.split('publish-package:')[1] ?? ''
    expect(publishSection).toContain('./gradlew publish')
  })

  it('Java Maven: mvn --batch-mode deploy', () => {
    const rendered = renderRelease({ archetype: 'library', language: 'java', buildTool: 'maven' })
    const publishSection = rendered.split('publish-package:')[1] ?? ''
    expect(publishSection).toContain('mvn --batch-mode deploy')
  })

  it('Go: gh release create with artifact', () => {
    const rendered = renderRelease({ archetype: 'library', language: 'go', buildTool: 'go' })
    const publishSection = rendered.split('publish-package:')[1] ?? ''
    expect(publishSection).toContain('gh release create')
  })

  it('Python: twine upload present', () => {
    const rendered = renderRelease({ archetype: 'library', language: 'python', buildTool: 'pip' })
    expect(rendered).toContain('twine upload')
  })

  it('Rust: cargo publish present', () => {
    const rendered = renderRelease({ archetype: 'library', language: 'rust', buildTool: 'cargo' })
    const publishSection = rendered.split('publish-package:')[1] ?? ''
    expect(publishSection).toContain('cargo publish')
  })
})
