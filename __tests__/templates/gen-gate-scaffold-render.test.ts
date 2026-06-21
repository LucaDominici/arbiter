// SPDX-License-Identifier: Apache-2.0
// B4 (#1491): a fresh `arbiter init` TypeScript project must pass its OWN generated
// `check-all.mjs L1` gate on first run. This guards the gate-essential TS scaffold
// the fix introduced — the flat ESLint configs, the .prettierignore that scopes the
// format gate to user source, and the static-analysis command rewired to the flat
// config — so the first-run-green property cannot silently regress.
//
// CANON-04: render tests for the new templates (also satisfies the INV-48
// template-tests ratchet, which keys "tested" on the template path/stem appearing
// in a test under __tests__/templates).
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { generateCheckAll } from '../../src/generators/check-all.js'
import { makeConfig } from '../helpers.js'

function render(template: string, overrides: Record<string, unknown> = {}): string {
  const data = makeConfig('/tmp/test', overrides as never) as unknown as Record<string, unknown>
  return renderTemplate(template, data)
}

// Render check-all.mjs through the generator (it supplies the coverage/debt locals
// the template needs) and return the emitted script body.
function renderCheckAll(overrides: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'gate-scaffold-'))
  try {
    generateCheckAll(makeConfig(dir, { language: 'typescript', ...overrides }))
    return readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('static-analysis/prettierignore.ejs (B4 #1491)', () => {
  const out = render('static-analysis/prettierignore.ejs', { language: 'typescript' })

  it('ignores arbiter-generated scaffold so the format gate stays scoped to user source', () => {
    for (const dir of ['scripts/', 'docs/', '.claude/', '.arbiter/', 'standards/']) {
      expect(out).toContain(dir)
    }
  })

  it('does NOT ignore the user source tree (src/** must remain format-gated)', () => {
    // A bare `src/` ignore would disable formatting of the user's own code.
    expect(out.split('\n').some((l) => l.trim() === 'src/' || l.trim() === 'src')).toBe(false)
  })
})

describe('static-analysis/eslint.config.mjs.ejs (B4 #1491)', () => {
  const out = render('static-analysis/eslint.config.mjs.ejs', { language: 'typescript' })

  it('renders a flat config (ESLint v9+) that exports a config array', () => {
    expect(out).toContain('export default')
    expect(out).toContain('typescript-eslint')
  })

  it('forbids the prohibitions arbiter enforces (any/var)', () => {
    expect(out).toContain("'@typescript-eslint/no-explicit-any': 'error'")
    expect(out).toContain("'no-var': 'error'")
  })
})

describe('static-analysis/eslint.config.static.mjs.ejs (B4 #1491)', () => {
  it('renders the M29 static-analysis ruleset as a flat config', () => {
    const out = render('static-analysis/eslint.config.static.mjs.ejs', { language: 'typescript' })
    expect(out).toContain('export default')
    expect(out).toContain("'no-console': 'error'")
    expect(out).toContain('complexity')
    // Threshold is injected from config (falls back to 15 when absent).
    expect(out).toMatch(/complexity:\s*\['error',\s*\d+\]/)
  })

  it('honours the configured cyclomatic-complexity threshold', () => {
    const out = render('static-analysis/eslint.config.static.mjs.ejs', {
      language: 'typescript',
      thresholds: { cyclomaticComplexity: 8, maxParams: 5, methodLength: 40 },
    })
    expect(out).toContain("complexity: ['error', 8]")
  })
})

describe('static-analysis/requirements-dev.txt.ejs (B4 #1491)', () => {
  const out = render('static-analysis/requirements-dev.txt.ejs', { language: 'python' })

  it('declares the Python gate toolchain the generated gate invokes', () => {
    for (const dep of ['ruff', 'pytest', 'pytest-bdd', 'pytest-cov']) {
      expect(out).toContain(dep)
    }
  })
})

describe('behavioral-tests/bdd/test_example_bdd.py.ejs (B4 #1491)', () => {
  const out = render('behavioral-tests/bdd/test_example_bdd.py.ejs', { language: 'python' })

  it('guards the pytest-bdd import with importorskip so L1 pytest skips it cleanly', () => {
    expect(out).toContain('pytest.importorskip("pytest_bdd")')
    // No bare unused import — `import pytest` is consumed by importorskip (no F401).
    expect(out.indexOf('pytest.importorskip')).toBeLessThan(out.indexOf('from pytest_bdd import'))
  })
})

describe('check-all.mjs.ejs static-analysis command (B4 #1491)', () => {
  const out = renderCheckAll()

  it('runs static analysis via the flat config in isolation (no legacy eslintrc flag)', () => {
    expect(out).toContain("'--config', 'eslint.config.static.mjs'")
    expect(out).toContain("'--no-config-lookup'")
    expect(out).not.toContain("'--no-eslintrc'")
  })
})
