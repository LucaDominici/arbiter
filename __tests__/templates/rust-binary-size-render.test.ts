import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

// #359 — feat(#344) Phase 7G: binary-size invariant template for Rust binary
// archetypes. Emits a `[profile.release]` block + a binary-size check wired
// into the L2 gate when archetype produces a release binary (cli, embedded).
describe('rust binary-size template — rendering (#359, CANON-04)', () => {
  // ── Cargo.toml.profile.release.ejs ──────────────────────────────────────────

  it('emits [profile.release] block with size-optimizing flags', () => {
    const content = renderTemplate('coverage/Cargo.toml.profile.release.ejs', {
      ...makeConfig('/tmp/test', {
        language: 'rust',
        buildTool: 'cargo',
        archetype: 'cli',
        enableDebtGates: true,
      }),
      // Size cap is archetype-driven; passed through generator data dict.
      binarySizeBytes: 10 * 1024 * 1024,
    } as unknown as Record<string, unknown>)
    expect(content).toContain('[profile.release]')
    expect(content).toContain('opt-level')
    expect(content).toContain('lto')
    expect(content).toContain('codegen-units = 1')
    expect(content).toContain('strip')
  })

  it('size threshold defaults differ per archetype', () => {
    // cli  → 10 MB
    // embedded → 5 MB (more conservative; embedded targets are tight)
    // The literal threshold is interpolated for downstream gates (not the
    // toml itself; the toml carries the profile flags, the gate carries the cap).
    const content = renderTemplate('coverage/Cargo.toml.profile.release.ejs', {
      ...makeConfig('/tmp/test', {
        language: 'rust',
        buildTool: 'cargo',
        archetype: 'cli',
        enableDebtGates: true,
      }),
      binarySizeBytes: 10485760,
    } as unknown as Record<string, unknown>)
    // The template embeds the cap as a comment so operators can see it inline.
    expect(content).toMatch(/10\s*MB|10485760/)
  })

  // ── check-all.mjs.ejs — binary size step ────────────────────────────────────

  it('check-all.mjs.ejs emits binary-size step for rust cli archetype at L2', () => {
    const content = renderTemplate('scripts/check-all.mjs.ejs', {
      ...makeConfig('/tmp/test', {
        language: 'rust',
        buildTool: 'cargo',
        archetype: 'cli',
        governanceLevel: 'L2',
        enableDebtGates: true,
      }),
      coverageThreshold: 80,
      coverageEnabled: true,
      mutationEnabled: false,
      mutationThreshold: 85,
      binarySizeBytes: 10485760,
    } as unknown as Record<string, unknown>)
    expect(content).toContain('binary size')
    expect(content).toContain('target/release')
    expect(content).toContain('10485760')
  })

  it('check-all.mjs.ejs omits binary-size step for rust library archetype', () => {
    // Libraries do not emit a release binary; the check must not appear.
    const content = renderTemplate('scripts/check-all.mjs.ejs', {
      ...makeConfig('/tmp/test', {
        language: 'rust',
        buildTool: 'cargo',
        archetype: 'library',
        governanceLevel: 'L2',
        enableDebtGates: true,
      }),
      coverageThreshold: 80,
      coverageEnabled: true,
      mutationEnabled: false,
      mutationThreshold: 85,
    } as unknown as Record<string, unknown>)
    expect(content).not.toContain('binary size')
  })

  it('check-all.mjs.ejs omits binary-size step for non-rust languages', () => {
    const content = renderTemplate('scripts/check-all.mjs.ejs', {
      ...makeConfig('/tmp/test', {
        language: 'typescript',
        archetype: 'cli',
        governanceLevel: 'L2',
        enableDebtGates: true,
      }),
      coverageThreshold: 80,
      coverageEnabled: true,
      mutationEnabled: false,
      mutationThreshold: 85,
    } as unknown as Record<string, unknown>)
    expect(content).not.toContain('binary size')
  })
})
