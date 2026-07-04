import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function cfg(overrides = {}) {
  return makeConfig('/tmp/test', overrides) as unknown as Record<string, unknown>
}

const NO_UNWRAP = 'scripts/checks/check-rust-no-unwrap.mjs.ejs'
const NO_UNSAFE = 'scripts/checks/check-rust-no-unsafe.mjs.ejs'

describe('Rust context-aware checker templates (#360, CANON-02)', () => {
  for (const template of [NO_UNWRAP, NO_UNSAFE]) {
    describe(template, () => {
      it('renders without EJS leaks', () => {
        const out = renderTemplate(template, cfg({ language: 'rust' }))
        expect(out).not.toContain('<%')
        expect(out).not.toContain('%>')
      })

      it('starts with a Node shebang (cross-platform portability over awk)', () => {
        const out = renderTemplate(template, cfg({ language: 'rust' }))
        expect(out.trimStart()).toMatch(/^#!\/usr\/bin\/env node/)
      })

      it('uses process.exit for HARD-fail contract', () => {
        const out = renderTemplate(template, cfg({ language: 'rust' }))
        expect(out).toContain('process.exit(1)')
      })

      it('walks src/ recursively for .rs files', () => {
        const out = renderTemplate(template, cfg({ language: 'rust' }))
        expect(out).toContain("'src'")
        expect(out).toMatch(/\.rs/)
      })
    })
  }

  it('no-unwrap script skips lib.rs (re-export entrypoint per a prior internal project source)', () => {
    const out = renderTemplate(NO_UNWRAP, cfg({ language: 'rust' }))
    expect(out).toContain('lib.rs')
  })

  it('no-unwrap script slices production code before first #[cfg(test)]', () => {
    const out = renderTemplate(NO_UNWRAP, cfg({ language: 'rust' }))
    expect(out).toContain('#[cfg(test)]')
  })

  it('no-unwrap script matches both .unwrap() and .expect(', () => {
    const out = renderTemplate(NO_UNWRAP, cfg({ language: 'rust' }))
    expect(out).toContain('.unwrap()')
    expect(out).toContain('.expect(')
  })

  it('no-unsafe script honors forbid(unsafe_code) declarations (not a violation)', () => {
    const out = renderTemplate(NO_UNSAFE, cfg({ language: 'rust' }))
    expect(out).toContain('forbid(unsafe_code)')
  })

  it('no-unsafe script ignores comment-only lines', () => {
    const out = renderTemplate(NO_UNSAFE, cfg({ language: 'rust' }))
    // The script must show some comment-stripping logic (e.g. // anchor or trim)
    expect(out).toMatch(/\/\//)
  })
})
