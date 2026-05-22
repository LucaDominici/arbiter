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
  it('push to main trigger present', () => {
    const rendered = renderRelease({})
    expect(rendered).toContain('branches: [main]')
  })

  it('tag trigger present', () => {
    const rendered = renderRelease({})
    expect(rendered).toContain("- 'v*'")
    expect(rendered).toContain("- '!v0.0.0-verify-*'")
  })

  it('pull_request trigger present for dry-run', () => {
    const rendered = renderRelease({})
    expect(rendered).toContain('pull_request:')
  })

  it('concurrency cancel-in-progress is false', () => {
    const rendered = renderRelease({})
    expect(rendered).toContain('cancel-in-progress: false')
  })

  it('signing jobs gated on non-PR events', () => {
    const rendered = renderRelease({})
    expect(rendered).toContain("github.event_name != 'pull_request'")
  })
})

// ─── Governance level branching ───────────────────────────────────────────────

describe('05-release.yml.ejs — governance level branching', () => {
  it('L1: mutation-blocking is continue-on-error: true (informational)', () => {
    const rendered = renderRelease({ governanceLevel: 'L1' })
    const mutSection = rendered.split('mutation-blocking:')[1] ?? ''
    expect(mutSection).toContain('continue-on-error: true')
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

  it('L2: slsa-provenance name mentions L2 signed', () => {
    const rendered = renderRelease({ governanceLevel: 'L2' })
    expect(rendered).toContain('L2 signed')
  })

  it('L1: slsa-provenance name mentions L2 signed (same as L2)', () => {
    const rendered = renderRelease({ governanceLevel: 'L1' })
    expect(rendered).toContain('L2 signed')
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

  it('Go: go-mutesting (informational)', () => {
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
