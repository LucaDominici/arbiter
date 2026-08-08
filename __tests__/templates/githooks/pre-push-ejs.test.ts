/**
 * pre-push.ejs — evidence-freshness gate rendering tests (Port #4 Level-B).
 *
 * Asserts the scaffolded pre-push hook ships the same freshness-gate logic
 * as the host hook, parameterised under the ARBITER_ env prefix. Pairs with
 * `__tests__/githooks/pre-push.test.ts` which behaviourally exercises the
 * host hook.
 */
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../../src/utils/render.js'
import { makeConfig } from '../../helpers.js'

function tsConfig(): Record<string, unknown> {
  return makeConfig('/tmp/test-githooks', {
    language: 'typescript',
    buildTool: 'npm',
    projectName: 'test-project',
  }) as unknown as Record<string, unknown>
}

function rustConfig(): Record<string, unknown> {
  return makeConfig('/tmp/test-githooks', {
    language: 'rust',
    buildTool: 'cargo',
    projectName: 'test-project',
  }) as unknown as Record<string, unknown>
}

describe('githooks/pre-push.ejs — evidence-freshness gate', () => {
  for (const [name, cfg] of [
    ['typescript', tsConfig()],
    ['rust', rustConfig()],
  ] as const) {
    describe(`${name} stack`, () => {
      const out = renderTemplate('githooks/pre-push.ejs', cfg)

      it('renders without EJS tag leaks', () => {
        expect(out).not.toContain('<%')
        expect(out).not.toContain('%>')
      })

      it('declares the ARBITER_PREPUSH_MAX_AGE_MIN env with default 240', () => {
        expect(out).toContain('ARBITER_PREPUSH_MAX_AGE_MIN="${ARBITER_PREPUSH_MAX_AGE_MIN:-240}"')
      })

      it('reads ARBITER_PREPUSH_BYPASS with exact-string check', () => {
        expect(out).toContain('ARBITER_PREPUSH_BYPASS')
        expect(out).toMatch(/if \[ "\$BYPASS_RAW" = "true" \]/)
      })

      it('emits the loud arbiter-bypass stderr line on bypass', () => {
        expect(out).toContain('arbiter-bypass env=ARBITER_PREPUSH_BYPASS')
      })

      it('warns on ambiguous bypass values rather than honouring them', () => {
        expect(out).toContain('is ambiguous')
      })

      it('appends a JSONL entry to bypass-log.jsonl on bypass', () => {
        expect(out).toContain('bypass-log.jsonl')
      })

      it('hard-fails when stale and not bypassed and not low-risk', () => {
        expect(out).toMatch(/\.arbiter\/evidence\/ is \$\{AGE_MIN\} min old/)
        // explicit exit 1 inside the freshness block (not just the final gate).
        expect(out).toMatch(/exit 1/)
      })

      it('downgrades to warn-only when classifier reports docs-only or low-risk', () => {
        expect(out).toContain('Low-risk change set')
        expect(out).toContain('docs_only=true')
        expect(out).toContain('backend_changed=false')
        expect(out).toContain('high_risk=false')
      })

      it('uses find -printf %T@ to discover the newest evidence mtime', () => {
        expect(out).toContain('find "$ARBITER_PREPUSH_EVIDENCE_DIR" -type f')
        expect(out).toContain("-printf '%T@\\n'")
      })

      it('excludes bypass-log.jsonl from the freshness mtime scan', () => {
        // Otherwise a successful bypass would silently reset the freshness window.
        expect(out).toContain("-not -name 'bypass-log.jsonl'")
      })

      it('skips the gate when ARBITER_PREPUSH_SKIP=true', () => {
        expect(out).toContain('ARBITER_PREPUSH_SKIP')
      })

      it('preserves the working-tree porcelain check', () => {
        expect(out).toContain('git status --porcelain')
      })

      it('renders the chain-batching gate with its OWN push range, before gitleaks (#2102)', () => {
        // The gitleaks PUSH_RANGE lives inside `<% if (enableSecurityScanning) { %>` —
        // the chain check must compute its own range, unconditional (red-team note).
        expect(out).toContain('chain-batching gate (#2102)')
        expect(out).toContain('CHAIN_PUSH_RANGE')
        expect(out.indexOf('chain-batching gate (#2102)')).toBeLessThan(out.indexOf('gitleaks'))
        // The chain block must NOT be wrapped in the security-scanning conditional.
        const chainPos = out.indexOf('CHAIN_IDS')
        const guardPos = out.indexOf('enableSecurityScanning')
        expect(chainPos).toBeGreaterThan(-1)
        expect(guardPos).toBe(-1)
      })
    })
  }

  describe('chain-batching gate is unconditional (not gated on enableSecurityScanning, #2102)', () => {
    const out = renderTemplate('githooks/pre-push.ejs', {
      ...tsConfig(),
      enableSecurityScanning: false,
    })

    it('still renders the chain block when security scanning is disabled', () => {
      expect(out).toContain('chain-batching gate (#2102)')
      expect(out).toContain('CHAIN_PUSH_RANGE')
    })

    it('does not render the gitleaks block when security scanning is disabled', () => {
      expect(out).not.toContain('gitleaks')
    })
  })

  describe('typescript-only invariants', () => {
    const out = renderTemplate('githooks/pre-push.ejs', tsConfig())

    it("preserves the `pwd -P` symlink workaround for '#' in path", () => {
      expect(out).toContain('ORIG_DIR="$(pwd -P)"')
      expect(out).toContain('rsync -a')
      expect(out).toContain('mktemp')
    })

    it('still invokes the gate subcommand at the end', () => {
      expect(out).toContain('node scripts/check-all.mjs gate')
    })
  })

  describe('rust stack invariants', () => {
    const out = renderTemplate('githooks/pre-push.ejs', rustConfig())

    it('does NOT include the rsync workaround block', () => {
      expect(out).not.toContain('rsync')
      expect(out).not.toContain('mktemp')
    })

    it('still invokes the gate subcommand', () => {
      expect(out).toContain('node scripts/check-all.mjs gate')
    })
  })
})
