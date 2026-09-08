import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const SCRIPT = resolve('scripts/check-no-placeholders.mjs')
// This very test file, resolved at runtime — used by the self-reference tests below.
const SELF_TEST_FILE = fileURLToPath(import.meta.url)

function runScanner(dir: string): {
  status: number
  stdout: string
  stderr: string
} {
  const result = spawnSync('node', [SCRIPT, dir], {
    encoding: 'utf-8',
    cwd: resolve('.'),
  })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function makeDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'placeholder-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-no-placeholders scanner', () => {
  it('passes on a clean file', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'clean.ts'), 'export function hello(): string { return "world"; }\n')
      const result = runScanner(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  // #2528: the three shouted-only markers below are built by concatenation so this
  // test file's own source never contains one as a contiguous string — otherwise
  // editing this very file would trip the checker it exercises.
  it('fails on a genuine shouted PLACE-HOLDER marker', () => {
    const { dir, cleanup } = makeDir()
    try {
      const marker = 'PLACE' + 'HOLDER'
      writeFileSync(join(dir, 'bad.ts'), `const x = ${marker};\n`)
      const result = runScanner(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain(marker)
    } finally {
      cleanup()
    }
  })

  it('does not fail on the ordinary lowercase English noun (CANON-24, #2528)', () => {
    const { dir, cleanup } = makeDir()
    try {
      const word = 'place' + 'holder'
      writeFileSync(join(dir, 'clean.ts'), `// this is a ${word} for the real value\n`)
      const result = runScanner(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('does not fail on a test name containing the ordinary lowercase noun (#2528)', () => {
    const { dir, cleanup } = makeDir()
    try {
      const word = 'place' + 'holder'
      writeFileSync(
        join(dir, 'clean.test.ts'),
        `it('interpolates single {var} ${word}', () => {})\n`,
      )
      const result = runScanner(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('does not fail on Title-Case form — only the shouted marker is a violation (#2528)', () => {
    const { dir, cleanup } = makeDir()
    try {
      const word = 'Place' + 'Holder'
      writeFileSync(join(dir, 'clean.ts'), `const x = "${word}";\n`)
      const result = runScanner(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('fails on FIXME', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'bad.ts'), '// FIXME: this is broken\n')
      const result = runScanner(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('FIXME')
    } finally {
      cleanup()
    }
  })

  it('fails on XXX', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'bad.ts'), '// XXX remove this\n')
      const result = runScanner(dir)
      expect(result.status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('fails on HACK', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'bad.ts'), '// HACK: workaround\n')
      const result = runScanner(dir)
      expect(result.status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('fails on standalone WIP', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'bad.ts'), '// WIP\n')
      const result = runScanner(dir)
      expect(result.status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('does not fail on WIP inside a longer word', () => {
    const { dir, cleanup } = makeDir()
    try {
      // "wikipedia" contains "wip" but should not trigger
      writeFileSync(join(dir, 'ok.ts'), 'const url = "https://wikipedia.org";\n')
      const result = runScanner(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('fails on a genuine shouted CHANGE-ME marker', () => {
    const { dir, cleanup } = makeDir()
    try {
      const marker = 'CHANGE' + 'ME'
      writeFileSync(join(dir, 'bad.ts'), `const token = "${marker}";\n`)
      const result = runScanner(dir)
      expect(result.status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('does not fail on the lowercase form of CHANGE-ME (#2528)', () => {
    const { dir, cleanup } = makeDir()
    try {
      const word = 'change' + 'me'
      writeFileSync(join(dir, 'clean.ts'), `const token = "${word}";\n`)
      const result = runScanner(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('fails on a genuine shouted REPLACE-ME marker', () => {
    const { dir, cleanup } = makeDir()
    try {
      const marker = 'REPLACE' + 'ME'
      writeFileSync(join(dir, 'bad.ts'), `const secret = "${marker}";\n`)
      const result = runScanner(dir)
      expect(result.status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('does not fail on the lowercase form of REPLACE-ME (#2528)', () => {
    const { dir, cleanup } = makeDir()
    try {
      const word = 'replace' + 'me'
      writeFileSync(join(dir, 'clean.ts'), `const secret = "${word}";\n`)
      const result = runScanner(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('fails on it.skip(', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'bad.test.ts'), "it.skip('broken test', () => {});\n")
      const result = runScanner(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('it.skip')
    } finally {
      cleanup()
    }
  })

  it('fails on describe.skip(', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'bad.test.ts'), "describe.skip('suite', () => {});\n")
      const result = runScanner(dir)
      expect(result.status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('fails on test.skip(', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'bad.test.ts'), "test.skip('broken', () => {});\n")
      const result = runScanner(dir)
      expect(result.status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('fails on xit(', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'bad.test.ts'), "xit('old test', () => {});\n")
      const result = runScanner(dir)
      expect(result.status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('reports file and line number in output', () => {
    const { dir, cleanup } = makeDir()
    try {
      const marker = 'PLACE' + 'HOLDER'
      writeFileSync(join(dir, 'bad.ts'), `// line 1\nconst x = ${marker};\n`)
      const result = runScanner(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('bad.ts:2')
    } finally {
      cleanup()
    }
  })

  it('scans nested subdirectories', () => {
    const { dir, cleanup } = makeDir()
    try {
      const subdir = join(dir, 'nested', 'deep')
      mkdirSync(subdir, { recursive: true })
      writeFileSync(join(subdir, 'bad.ts'), '// FIXME\n')
      const result = runScanner(dir)
      expect(result.status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('reports count of violations', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'bad.ts'), '// FIXME\n// HACK\n')
      const result = runScanner(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('violation')
    } finally {
      cleanup()
    }
  })

  // #2528: the checker's own source and its own test file must not self-block on
  // the shouted markers themselves — both are made of split-string literals, so
  // none of the three should ever appear in a scan of either file. (The OTHER
  // checker patterns are a separate, pre-existing self-reference in these two
  // files — out of scope here; see the note filed for #2528 — so this asserts
  // absence of the shouted-marker labels specifically, not a blanket clean exit.)
  it('finds no shouted-marker violation scanning its own source file — no self-block', () => {
    const { dir, cleanup } = makeDir()
    try {
      const selfSource = readFileSync(SCRIPT, 'utf-8')
      writeFileSync(join(dir, 'check-no-placeholders.mjs'), selfSource)
      const result = runScanner(dir)
      expect(result.stdout).not.toContain('PLACE' + 'HOLDER')
      expect(result.stdout).not.toContain('CHANGE' + 'ME')
      expect(result.stdout).not.toContain('REPLACE' + 'ME')
    } finally {
      cleanup()
    }
  })

  it('finds no shouted-marker violation scanning its own test file — no self-block', () => {
    const { dir, cleanup } = makeDir()
    try {
      const selfTest = readFileSync(SELF_TEST_FILE, 'utf-8')
      writeFileSync(join(dir, 'check-no-placeholders.test.ts'), selfTest)
      const result = runScanner(dir)
      expect(result.stdout).not.toContain('PLACE' + 'HOLDER')
      expect(result.stdout).not.toContain('CHANGE' + 'ME')
      expect(result.stdout).not.toContain('REPLACE' + 'ME')
    } finally {
      cleanup()
    }
  })
})
