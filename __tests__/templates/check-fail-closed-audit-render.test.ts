import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

const TEMPLATE = 'scripts/check-fail-closed-audit.mjs.ejs'

function renderAt(level: 'L1' | 'L2' | 'L3' | 'L4'): string {
  const data = makeConfig('/tmp/test', {
    governanceLevel: level,
    projectName: 'demo-app',
  }) as unknown as Record<string, unknown>
  return renderTemplate(TEMPLATE, data)
}

describe('check-fail-closed-audit.mjs.ejs — INV-96 audit gate scaffold', () => {
  it('emits nothing at L1 (governance-gated)', () => {
    expect(renderAt('L1').trim()).toBe('')
  })

  it('emits a node script with shebang at L2', () => {
    const out = renderAt('L2')
    expect(out).toContain('#!/usr/bin/env node')
    expect(out).toContain('INV-96')
    expect(out).toContain('demo-app')
  })

  it('emits the same shape at L3', () => {
    const out = renderAt('L3')
    expect(out).toContain('#!/usr/bin/env node')
    expect(out).toContain('INV-96')
  })

  // #1720 — gap 5: the guard was literal `=== 'L2' || === 'L3'`, so L4 silently
  // rendered EMPTY (no-op exits 0), violating INV-96 fail-closed doctrine.
  it('emits the same shape at L4 (gap 5 — was silently empty)', () => {
    const out = renderAt('L4')
    expect(out).toContain('#!/usr/bin/env node')
    expect(out).toContain('INV-96')
  })

  it('declares baseline path and update-baseline flag', () => {
    const out = renderAt('L2')
    expect(out).toContain('scripts/data/fail-closed-baseline.json')
    expect(out).toContain('--update-baseline')
  })

  it('includes the FAIL-OPEN-INTENT allowlist regex', () => {
    const out = renderAt('L2')
    expect(out).toContain('FAIL-OPEN-INTENT')
    expect(out).toContain('FAIL_OPEN_MARK')
  })

  // #2577 (Codex review round 1, MEDIUM): the emitted script is a maintained fork of
  // scripts/check-fail-closed-audit.mjs, not a byte-identical copy — render it into a
  // temp project and run the same quote-regex / desync fixtures against the ACTUAL emitted
  // file, not just assert on the .ejs source text.
  describe('emitted script — #2577 quote-regex and desync fixtures (executed)', () => {
    let root: string | undefined

    afterEach(() => {
      if (root) rmSync(root, { recursive: true, force: true })
      root = undefined
    })

    function renderInto(): string {
      root = mkdtempSync(join(tmpdir(), 'fail-closed-render-'))
      mkdirSync(join(root, 'scripts', 'data'), { recursive: true })
      writeFileSync(join(root, 'scripts', 'check-fail-closed-audit.mjs'), renderAt('L2'))
      return root
    }

    function runEmitted(dir: string): { status: number; stdout: string; stderr: string } {
      const result = spawnSync(
        'node',
        [join(dir, 'scripts', 'check-fail-closed-audit.mjs'), '--root', dir],
        { encoding: 'utf-8' },
      )
      return {
        status: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
      }
    }

    it('reports a catch{} planted after a quote-bearing regex (AC-1)', () => {
      const dir = renderInto()
      writeFileSync(
        join(dir, 'scripts', 'probe.mjs'),
        [
          '#!/usr/bin/env node',
          'const siteRe = /[\'"]/g',
          'const classRe = /[^\'"]+/g',
          'function after() {',
          '  try {',
          '    b()',
          '  } catch {',
          '  }',
          '}',
          'after()',
          '',
        ].join('\n'),
      )
      const r = runEmitted(dir)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('probe.mjs')
      expect(r.stdout).toContain('node-swallowed-catch')
    })

    it('fails closed (exit 2) on an unterminated string, regardless of file size (AC-3)', () => {
      const dir = renderInto()
      writeFileSync(
        join(dir, 'scripts', 'desynced.mjs'),
        ["const oops = 'never closed", 'try {', '  a()', '} catch {', '}', ''].join('\n'),
      )
      const r = runEmitted(dir)
      expect(r.status).toBe(2)
      expect(r.stderr).toContain('desynced.mjs')
    })
  })
})
