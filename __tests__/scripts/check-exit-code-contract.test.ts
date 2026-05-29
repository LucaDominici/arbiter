import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-exit-code-contract.mjs')

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
  const dir = mkdtempSync(join(tmpdir(), 'exit-contract-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-exit-code-contract scanner', () => {
  it('passes on a clean .mjs file with only exits 0, 1, 2', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(
        join(dir, 'clean.mjs'),
        [
          '#!/usr/bin/env node',
          'const ok = true;',
          'if (!ok) process.exit(1);',
          "if (process.argv.includes('--bad')) process.exit(2);",
          'process.exit(0);',
        ].join('\n'),
      )
      const result = runScanner(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('fails on process.exit(42) in a .mjs file', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'bad.mjs'), 'if (err) process.exit(42);\n')
      const result = runScanner(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('bad.mjs')
      expect(result.stdout).toContain('42')
    } finally {
      cleanup()
    }
  })

  it('fails on process.exit(99) in a .ejs template file', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'template.mjs.ejs'), 'process.exit(99);\n')
      const result = runScanner(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('template.mjs.ejs')
    } finally {
      cleanup()
    }
  })

  it('passes on process.exit(0), process.exit(1), process.exit(2)', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'ok.mjs'), 'process.exit(0);\nprocess.exit(1);\nprocess.exit(2);\n')
      const result = runScanner(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('passes on process.exit(78) — POSIX EX_CONFIG is allowed', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'config-error.mjs'), 'process.exit(78);\n')
      const result = runScanner(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('fails on process.exit(79) — only 0/1/2/78 are allowed', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'bad79.mjs'), 'process.exit(79);\n')
      const result = runScanner(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('79')
    } finally {
      cleanup()
    }
  })

  it('fails on negative exit code process.exit(-1)', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'neg.mjs'), 'process.exit(-1);\n')
      const result = runScanner(dir)
      expect(result.status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('skips files in node_modules subdirectory', () => {
    const { dir, cleanup } = makeDir()
    try {
      const nm = join(dir, 'node_modules', 'pkg')
      mkdirSync(nm, { recursive: true })
      writeFileSync(join(nm, 'index.mjs'), 'process.exit(99);\n')
      const result = runScanner(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('reports exact violation count (2 violations) in output', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'a.mjs'), 'process.exit(5);\n')
      writeFileSync(join(dir, 'b.mjs'), 'process.exit(7);\n')
      const result = runScanner(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toMatch(/Found 2 violation/)
    } finally {
      cleanup()
    }
  })

  it('does not flag process.exit(42) when inside a string literal', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(
        join(dir, 'ok.mjs'),
        'console.log("process.exit(42)");\nconsole.log(\'process.exit(99)\');\n',
      )
      const result = runScanner(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 2 when all provided paths are nonexistent (C-phase: bad args)', () => {
    const result = runScanner('--nonexistent-path-xyz-abc-999')
    expect(result.status).toBe(2)
  })
})
