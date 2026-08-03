// SPDX-License-Identifier: Apache-2.0
// Red phase: all tests must FAIL until scripts/check-anti-proforma.mjs is implemented.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-anti-proforma.mjs')

function run(args: string[], cwd: string) {
  const r = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', cwd })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function fixture(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'anti-proforma-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function writeTest(dir: string, name: string, content: string): void {
  const testsDir = join(dir, '__tests__')
  mkdirSync(testsDir, { recursive: true })
  writeFileSync(join(testsDir, name), content)
}

describe('check-anti-proforma.mjs (INV-118) — warn-default mode', () => {
  it('exits 0 (warn-default) when test file has no assertion but emits warning to stderr', () => {
    const { dir, cleanup } = fixture()
    try {
      writeTest(
        dir,
        'foo.test.ts',
        `import { describe, it } from 'vitest'\n` +
          `describe('foo', () => {\n` +
          `  it('does nothing', () => {\n` +
          `    const x = 1\n` +
          `  })\n` +
          `})\n`,
      )
      const r = run(['--dir', dir], dir)
      expect(r.status).toBe(0)
      expect(r.stderr).toContain('PROFORMA')
    } finally {
      cleanup()
    }
  })

  it('exits 0 and emits no warning when test has expect() assertion', () => {
    const { dir, cleanup } = fixture()
    try {
      writeTest(
        dir,
        'good.test.ts',
        `import { describe, it, expect } from 'vitest'\n` +
          `describe('good', () => {\n` +
          `  it('has assertion', () => {\n` +
          `    expect(1 + 1).toBe(2)\n` +
          `  })\n` +
          `})\n`,
      )
      const r = run(['--dir', dir], dir)
      expect(r.status).toBe(0)
      expect(r.stderr).not.toContain('PROFORMA')
    } finally {
      cleanup()
    }
  })

  it('exits 0 and emits no warning when test has assert. pattern', () => {
    const { dir, cleanup } = fixture()
    try {
      writeTest(
        dir,
        'assert.test.ts',
        `import assert from 'node:assert'\n` +
          `describe('a', () => {\n` +
          `  it('uses assert', () => {\n` +
          `    assert.strictEqual(1, 1)\n` +
          `  })\n` +
          `})\n`,
      )
      const r = run(['--dir', dir], dir)
      expect(r.status).toBe(0)
      expect(r.stderr).not.toContain('PROFORMA')
    } finally {
      cleanup()
    }
  })

  it('respects anti-proforma-exempt comment — excluded test not counted as violation', () => {
    const { dir, cleanup } = fixture()
    try {
      writeTest(
        dir,
        'exempt.test.ts',
        `import { it } from 'vitest'\n` +
          `// anti-proforma-exempt: setup-only, no assertion needed\n` +
          `it('setup helper', () => {\n` +
          `  const x = 1\n` +
          `})\n`,
      )
      const r = run(['--dir', dir], dir)
      expect(r.status).toBe(0)
      // No PROFORMA violation (it's exempt), but may warn about high exempt ratio
      expect(r.stderr).not.toContain('PROFORMA: foo.test.ts')
    } finally {
      cleanup()
    }
  })

  it('warns when bypass ratio exceeds 5% threshold', () => {
    const { dir, cleanup } = fixture()
    try {
      // 3 exempt tests out of 3 total = 100% > 5%
      writeTest(
        dir,
        'all-exempt.test.ts',
        `import { it } from 'vitest'\n` +
          `// anti-proforma-exempt: reason 1\n` +
          `it('test1', () => { const a = 1 })\n` +
          `// anti-proforma-exempt: reason 2\n` +
          `it('test2', () => { const b = 2 })\n` +
          `// anti-proforma-exempt: reason 3\n` +
          `it('test3', () => { const c = 3 })\n`,
      )
      const r = run(['--dir', dir], dir)
      expect(r.status).toBe(0)
      expect(r.stderr).toContain('EXEMPT-THRESHOLD')
    } finally {
      cleanup()
    }
  })

  it('exits 1 under --enforce when violations found', () => {
    const { dir, cleanup } = fixture()
    try {
      writeTest(
        dir,
        'bad.test.ts',
        `import { it } from 'vitest'\n` +
          `it('no assertion', () => {\n` +
          `  const x = 1\n` +
          `})\n`,
      )
      const r = run(['--dir', dir, '--enforce'], dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('PROFORMA')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when no test files found in dir', () => {
    const { dir, cleanup } = fixture()
    try {
      // dir has no test files
      const r = run(['--dir', dir], dir)
      expect(r.status).toBe(0)
      expect(r.stderr).not.toContain('PROFORMA')
    } finally {
      cleanup()
    }
  })

  it('recognizes toBe() as valid assertion', () => {
    const { dir, cleanup } = fixture()
    try {
      writeTest(
        dir,
        'tobe.test.ts',
        `describe('t', () => {\n  it('x', () => { expect(true).toBe(true) })\n})\n`,
      )
      const r = run(['--dir', dir], dir)
      expect(r.status).toBe(0)
      expect(r.stderr).not.toContain('PROFORMA')
    } finally {
      cleanup()
    }
  })

  it('recognizes toEqual() as valid assertion', () => {
    const { dir, cleanup } = fixture()
    try {
      writeTest(
        dir,
        'toequal.test.ts',
        `describe('t', () => {\n  it('x', () => { expect([1]).toEqual([1]) })\n})\n`,
      )
      const r = run(['--dir', dir], dir)
      expect(r.status).toBe(0)
      expect(r.stderr).not.toContain('PROFORMA')
    } finally {
      cleanup()
    }
  })

  it('handles --help flag without error', () => {
    const r = spawnSync('node', [SCRIPT, '--help'], { encoding: 'utf-8' })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('anti-proforma')
  })
})

// #2031 — one regression fixture per structural false-positive class found in run #2000,
// each extracted from the real construct that tripped the old line/brace heuristic, plus
// the masked-tautology false negative. The fixtures live in string literals on purpose:
// when the scanner walks THIS file it must not see them as test blocks (class 3).
describe('check-anti-proforma.mjs — #2031 false-positive classes', () => {
  it('class 1a: it(name, { timeout }, fn) — the option object must not close the block', () => {
    const { dir, cleanup } = fixture()
    try {
      writeTest(
        dir,
        'options.test.ts',
        // The options literal on its own line drove brace depth back to 0 before the
        // arrow body ever opened, so the old scanner closed the block after two lines
        // and never saw the assertion. Verified RED against the pre-#2031 scanner.
        `describe('render', () => {\n` +
          `  it('renders byte-identically on repeated render',\n` +
          `    { timeout: 30_000 },\n` +
          `    () => {\n` +
          `      expect(second).toBe(first)\n` +
          `    })\n` +
          `})\n`,
      )
      const r = run(['--dir', dir], dir)
      expect(r.stderr).not.toContain('PROFORMA')
    } finally {
      cleanup()
    }
  })

  it('class 1b: unbalanced braces inside strings and comments must not truncate the block', () => {
    const { dir, cleanup } = fixture()
    try {
      writeTest(
        dir,
        'braces.test.ts',
        // The surplus `}` inside the string literal closed the block one line early on
        // the old scanner. Verified RED against the pre-#2031 scanner.
        `describe('audit', () => {\n` +
          `  it('does NOT flag a swallow inside a string', () => {\n` +
          `    const doc = 'a catch { } that is just text}'\n` +
          `    expect(doc).toContain('catch')\n` +
          `  })\n` +
          `})\n`,
      )
      const r = run(['--dir', dir], dir)
      expect(r.stderr).not.toContain('PROFORMA')
    } finally {
      cleanup()
    }
  })

  it('class 2: an expect reached only through a same-file helper counts as an assertion', () => {
    const { dir, cleanup } = fixture()
    try {
      writeTest(
        dir,
        'helper.test.ts',
        `function expectEnvelope(payload) {\n` +
          `  expect(payload.contractVersion).toBe('1')\n` +
          `}\n` +
          `describe('envelope', () => {\n` +
          `  it('is enveloped', () => {\n` +
          `    expectEnvelope(envelopeOf(run()))\n` +
          `  })\n` +
          `})\n`,
      )
      const r = run(['--dir', dir], dir)
      expect(r.stderr).not.toContain('PROFORMA')
    } finally {
      cleanup()
    }
  })

  it('class 3: an it( inside a fixture template string is not a test block', () => {
    const { dir, cleanup } = fixture()
    try {
      writeTest(
        dir,
        'fixtures.test.ts',
        'const SAMPLE = `\n' +
          "describe('inner', () => {\n" +
          "it('this one lives inside a string', () => {})\n" +
          '})\n' +
          '`\n' +
          `describe('builders', () => {\n` +
          `  it('extracts refs from tagged titles', () => {\n` +
          `    expect(SAMPLE).toContain('inner')\n` +
          `  })\n` +
          `})\n`,
      )
      const r = run(['--dir', dir], dir)
      expect(r.stderr).not.toContain('PROFORMA')
    } finally {
      cleanup()
    }
  })

  it('false negative: expect(<module-scope const>).toBeDefined() is reported as a tautology', () => {
    const { dir, cleanup } = fixture()
    try {
      writeTest(
        dir,
        'tautology.test.ts',
        `const DIM_TO_TOOL = { a: /x/ }\n` +
          `describe('drift', () => {\n` +
          `  it('residual blind spots are documented', () => {\n` +
          `    expect(DIM_TO_TOOL).toBeDefined()\n` +
          `  })\n` +
          `})\n`,
      )
      const r = run(['--dir', dir], dir)
      expect(r.stderr).toContain('TAUTOLOGY')
    } finally {
      cleanup()
    }
  })

  it('does not call a locally-produced value a tautology', () => {
    const { dir, cleanup } = fixture()
    try {
      writeTest(
        dir,
        'local.test.ts',
        `describe('local', () => {\n` +
          `  it('produces a result', () => {\n` +
          `    const result = doThing()\n` +
          `    expect(result).toBeDefined()\n` +
          `  })\n` +
          `})\n`,
      )
      const r = run(['--dir', dir], dir)
      expect(r.stderr).not.toContain('TAUTOLOGY')
    } finally {
      cleanup()
    }
  })

  it('still reports a genuinely assertion-less block (the gate has not gone blind)', () => {
    const { dir, cleanup } = fixture()
    try {
      writeTest(
        dir,
        'empty.test.ts',
        `describe('empty', () => {\n` +
          `  it('asserts nothing at all', { timeout: 1000 }, () => {\n` +
          `    const x = compute()\n` +
          `    console.log(x)\n` +
          `  })\n` +
          `})\n`,
      )
      const r = run(['--dir', dir], dir)
      expect(r.stderr).toContain('PROFORMA')
    } finally {
      cleanup()
    }
  })

  it('--enforce turns a real finding into exit 1', () => {
    const { dir, cleanup } = fixture()
    try {
      writeTest(dir, 'e.test.ts', `describe('d', () => {\n  it('x', () => {})\n})\n`)
      expect(run(['--dir', dir, '--enforce'], dir).status).toBe(1)
      expect(run(['--dir', dir], dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })
})
