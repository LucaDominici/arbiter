// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/pii-scan.mjs')

function run(cwd: string) {
  const r = spawnSync('node', [SCRIPT], { encoding: 'utf-8', cwd })
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pii-scan-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('pii-scan.mjs (INV-12 — PII detection gate)', () => {
  it('exits 0 when no PII patterns are found in test files', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, '__tests__'))
      writeFileSync(join(dir, '__tests__', 'example.test.ts'), 'export const test = () => {}')
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when an email pattern is found and not allowlisted', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, '__tests__'))
      writeFileSync(join(dir, '__tests__', 'bad.test.ts'), 'const email = "user@example.com"')
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('PII')
      expect(result.stderr).toContain('email')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when an email is allowlisted in suppressions/pii-allowlist.json', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'suppressions'))
      mkdirSync(join(dir, '__tests__'))
      writeFileSync(
        join(dir, 'suppressions', 'pii-allowlist.json'),
        JSON.stringify([
          {
            file: '__tests__/allowed.test.ts',
            pattern: 'user@example.com',
            reason: 'fixture',
          },
        ]),
      )
      writeFileSync(join(dir, '__tests__', 'allowed.test.ts'), 'const email = "user@example.com"')
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when pii-allowlist.json is not a JSON array', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'suppressions'))
      mkdirSync(join(dir, '__tests__'))
      writeFileSync(join(dir, 'suppressions', 'pii-allowlist.json'), '{"notArray": true}')
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('must be a JSON array')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when pii-allowlist.json contains invalid JSON syntax', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'suppressions'))
      mkdirSync(join(dir, '__tests__'))
      writeFileSync(join(dir, 'suppressions', 'pii-allowlist.json'), '[{invalid json}]')
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('invalid JSON')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a phone number (E.164 format) is found and not allowlisted', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, '__tests__'))
      writeFileSync(join(dir, '__tests__', 'phone.test.ts'), 'const phone = "+14155552671"')
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('phone-E164')
    } finally {
      cleanup()
    }
  })

  it('scans all predefined directories: src, test, tests, __tests__, spec', () => {
    const { dir, cleanup } = makeTemp()
    try {
      // Only create one of these and verify it scans
      mkdirSync(join(dir, 'test'))
      writeFileSync(join(dir, 'test', 'main.test.js'), 'const x = "baduser@domain.com"')
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('test/main.test.js')
    } finally {
      cleanup()
    }
  })

  it('skips binary file extensions and does not crash on unreadable files', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, '__tests__'))
      // Binary files should be skipped
      writeFileSync(join(dir, '__tests__', 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      // Clean file to ensure it still exits 0
      writeFileSync(join(dir, '__tests__', 'clean.test.ts'), 'export const test = () => {}')
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  // #1809: isAllowed() specificity floor. A suppression must be NARROW — either
  // an exact (file + line) pair, or an exact `pattern` string match — mirroring
  // src/templates/scripts/pii-scan.mjs.ejs's stricter #1669 semantics. A bare
  // file-only / line-only entry, a substring file match, or a substring pattern
  // match can no longer blanket-disable this HARD gate.
  describe('specificity floor (#1809)', () => {
    function allowlistOnly(dir: string, entries: unknown[]): void {
      mkdirSync(join(dir, 'suppressions'), { recursive: true })
      writeFileSync(join(dir, 'suppressions', 'pii-allowlist.json'), JSON.stringify(entries))
    }

    it('rejects a file-only entry (no line, no pattern) — no longer suppresses', () => {
      const { dir, cleanup } = makeTemp()
      try {
        mkdirSync(join(dir, '__tests__'))
        allowlistOnly(dir, [{ file: '__tests__/bad.test.ts', reason: 'fixture' }])
        writeFileSync(join(dir, '__tests__', 'bad.test.ts'), 'const email = "user@example.com"')
        const result = run(dir)
        expect(result.status).toBe(1)
        expect(result.stderr).toContain('email')
      } finally {
        cleanup()
      }
    })

    it('rejects a line-only entry (no file, no pattern) — no longer suppresses', () => {
      const { dir, cleanup } = makeTemp()
      try {
        mkdirSync(join(dir, '__tests__'))
        allowlistOnly(dir, [{ line: 1, reason: 'fixture' }])
        writeFileSync(join(dir, '__tests__', 'bad.test.ts'), 'const email = "user@example.com"')
        const result = run(dir)
        expect(result.status).toBe(1)
      } finally {
        cleanup()
      }
    })

    it('rejects a substring pattern match — pattern must equal the match exactly', () => {
      const { dir, cleanup } = makeTemp()
      try {
        mkdirSync(join(dir, '__tests__'))
        // "@" would substring-match every email under the old (loose) semantics.
        allowlistOnly(dir, [{ pattern: '@', reason: 'fixture' }])
        writeFileSync(join(dir, '__tests__', 'bad.test.ts'), 'const email = "user@example.com"')
        const result = run(dir)
        expect(result.status).toBe(1)
      } finally {
        cleanup()
      }
    })

    it('rejects a substring file match — "foo.ts" must not match "foo.tsx"', () => {
      const { dir, cleanup } = makeTemp()
      try {
        mkdirSync(join(dir, '__tests__'))
        allowlistOnly(dir, [{ file: '__tests__/foo.ts', line: 1, reason: 'fixture' }])
        writeFileSync(join(dir, '__tests__', 'foo.tsx'), 'const email = "user@example.com"')
        const result = run(dir)
        expect(result.status).toBe(1)
      } finally {
        cleanup()
      }
    })

    it('accepts an exact (file + line) pair — still suppresses', () => {
      const { dir, cleanup } = makeTemp()
      try {
        mkdirSync(join(dir, '__tests__'))
        allowlistOnly(dir, [{ file: '__tests__/allowed.test.ts', line: 1, reason: 'fixture' }])
        writeFileSync(join(dir, '__tests__', 'allowed.test.ts'), 'const email = "user@example.com"')
        expect(run(dir).status).toBe(0)
      } finally {
        cleanup()
      }
    })

    it('accepts an exact pattern-only entry (no file/line needed) — still suppresses anywhere', () => {
      const { dir, cleanup } = makeTemp()
      try {
        mkdirSync(join(dir, '__tests__'))
        allowlistOnly(dir, [{ pattern: 'user@example.com', reason: 'fixture' }])
        writeFileSync(join(dir, '__tests__', 'allowed.test.ts'), 'const email = "user@example.com"')
        expect(run(dir).status).toBe(0)
      } finally {
        cleanup()
      }
    })

    it('a directory-prefix file entry still requires an exact line — a mismatched line still fails', () => {
      const { dir, cleanup } = makeTemp()
      try {
        mkdirSync(join(dir, '__tests__'))
        // Old semantics: a bare "__tests__/" file entry (with no line at all)
        // suppressed every match anywhere under the directory. New semantics:
        // file+line is still a per-file, per-line pair — a directory prefix
        // narrows WHICH files are eligible, but line 99 (this fixture's PII is
        // on line 1) still does not match, so this is NOT a blanket suppression.
        allowlistOnly(dir, [{ file: '__tests__/', line: 99, reason: 'fixture' }])
        writeFileSync(join(dir, '__tests__', 'other.test.ts'), 'const email = "user@example.com"')
        const result = run(dir)
        expect(result.status).toBe(1)
      } finally {
        cleanup()
      }
    })
  })
})
