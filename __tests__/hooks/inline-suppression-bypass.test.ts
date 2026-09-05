import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const REPO_ROOT = resolve(process.cwd())
const HOOKS_DIR = join(REPO_ROOT, '.claude/hooks')

function runHook(
  hookFile: string,
  filePath: string,
  cwd: string,
): { status: number; stderr: string; stdout: string } {
  const result = spawnSync('node', [join(HOOKS_DIR, hookFile)], {
    encoding: 'utf-8',
    cwd,
    env: { ...process.env, CLAUDE_TOOL_INPUT_PATH: filePath },
  })
  return {
    status: result.status ?? 1,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  }
}

function makeTmpDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-hook-bypass-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const VALID_ANY =
  '// arbiter-suppress(INV-04, until=2099-01-01, reason="DI field injected by Spring", owner=@luca)'
const VALID_TODO =
  '// arbiter-suppress(INV-21, until=2099-01-01, reason="Legacy code needs cleanup tracked externally", owner=@luca)'
const VALID_PII =
  '// arbiter-suppress(INV-12, until=2099-01-01, reason="Test fixture email address for integration tests", owner=@luca)'

// Bare marker split to prevent orphan-TODO scanner matching this source file.
const ORPHAN_MARKER = '//' + ' TODO: fix this later'

describe('inline-suppression bypass sentinel (INV-36)', () => {
  // ── check-no-any.mjs ────────────────────────────────────────────────────────
  describe('check-no-any.mjs', () => {
    it("BLOCKS: raw 'any' type with no directive", () => {
      const { dir, cleanup } = makeTmpDir()
      try {
        const f = join(dir, 'test.ts')
        writeFileSync(f, 'const x: any = 1;\n')
        expect(runHook('check-no-any.mjs', f, dir).status).toBe(2)
      } finally {
        cleanup()
      }
    })

    it('BLOCKS: expired directive does not suppress violation', () => {
      const { dir, cleanup } = makeTmpDir()
      try {
        const f = join(dir, 'test.ts')
        writeFileSync(
          f,
          '// arbiter-suppress(INV-04, until=2020-01-01, reason="DI field injected by Spring", owner=@luca)\nconst x: any = 1;\n',
        )
        expect(runHook('check-no-any.mjs', f, dir).status).toBe(2)
      } finally {
        cleanup()
      }
    })

    it('BLOCKS: wrong INV-NN does not suppress violation', () => {
      const { dir, cleanup } = makeTmpDir()
      try {
        const f = join(dir, 'test.ts')
        writeFileSync(
          f,
          '// arbiter-suppress(INV-99, until=2099-01-01, reason="DI field injected by Spring", owner=@luca)\nconst x: any = 1;\n',
        )
        expect(runHook('check-no-any.mjs', f, dir).status).toBe(2)
      } finally {
        cleanup()
      }
    })

    it('ALLOWS: valid INV-04 directive on previous line suppresses violation', () => {
      const { dir, cleanup } = makeTmpDir()
      try {
        const f = join(dir, 'test.ts')
        writeFileSync(f, `${VALID_ANY}\nconst x: any = 1;\n`)
        expect(runHook('check-no-any.mjs', f, dir).status).toBe(0)
      } finally {
        cleanup()
      }
    })

    it('ALLOWS: valid INV-04 directive on same line suppresses violation', () => {
      const { dir, cleanup } = makeTmpDir()
      try {
        const f = join(dir, 'test.ts')
        writeFileSync(f, `const x: any = 1; ${VALID_ANY}\n`)
        expect(runHook('check-no-any.mjs', f, dir).status).toBe(0)
      } finally {
        cleanup()
      }
    })
  })

  // ── check-no-orphan-todo.mjs ────────────────────────────────────────────────
  describe('check-no-orphan-todo.mjs', () => {
    it('BLOCKS: bare TODO with no directive', () => {
      const { dir, cleanup } = makeTmpDir()
      try {
        const f = join(dir, 'test.ts')
        writeFileSync(
          f,
          `${ORPHAN_MARKER}
`,
        )
        expect(runHook('check-no-orphan-todo.mjs', f, dir).status).toBe(2)
      } finally {
        cleanup()
      }
    })

    it('BLOCKS: expired suppression does not bypass orphan TODO check', () => {
      const { dir, cleanup } = makeTmpDir()
      try {
        const f = join(dir, 'test.ts')
        const expired =
          '// arbiter-suppress(INV-21, until=2020-01-01, reason="Legacy code needs cleanup", owner=@luca)'
        writeFileSync(f, `${expired}\n${ORPHAN_MARKER}\n`)
        expect(runHook('check-no-orphan-todo.mjs', f, dir).status).toBe(2)
      } finally {
        cleanup()
      }
    })

    it('BLOCKS: wrong INV-NN does not suppress orphan TODO', () => {
      const { dir, cleanup } = makeTmpDir()
      try {
        const f = join(dir, 'test.ts')
        const wrongInv =
          '// arbiter-suppress(INV-04, until=2099-01-01, reason="Wrong invariant used here for todo", owner=@luca)'
        writeFileSync(f, `${wrongInv}\n${ORPHAN_MARKER}\n`)
        expect(runHook('check-no-orphan-todo.mjs', f, dir).status).toBe(2)
      } finally {
        cleanup()
      }
    })

    it('ALLOWS: valid INV-21 directive suppresses orphan TODO', () => {
      const { dir, cleanup } = makeTmpDir()
      try {
        const f = join(dir, 'test.ts')
        writeFileSync(f, `${VALID_TODO}\n${ORPHAN_MARKER}\n`)
        expect(runHook('check-no-orphan-todo.mjs', f, dir).status).toBe(0)
      } finally {
        cleanup()
      }
    })

    it('ALLOWS: to-do(#NNN) format description inside a string literal (catalog.ts-style data, #1796/#1799)', () => {
      const { dir, cleanup } = makeTmpDir()
      try {
        const f = join(dir, 'test.ts')
        // Marker built by concatenation so this source file adds no countable to-do markers.
        const word = ['TO', 'DO'].join('')
        writeFileSync(
          f,
          `export const rule = { title: 'Every ${word} comment must reference a task ID: \`${word}(#NNN)\`' }\n`,
        )
        expect(runHook('check-no-orphan-todo.mjs', f, dir).status).toBe(0)
      } finally {
        cleanup()
      }
    })

    it('ALLOWS: bare to-do word in prose in a non-source file (.md is outside the extension allowlist, #1778)', () => {
      const { dir, cleanup } = makeTmpDir()
      try {
        const f = join(dir, 'NOTES.md')
        const word = ['TO', 'DO'].join('')
        writeFileSync(f, `This section lists ${word} items still open for the release.\n`)
        expect(runHook('check-no-orphan-todo.mjs', f, dir).status).toBe(0)
      } finally {
        cleanup()
      }
    })
  })

  // ── check-no-placeholders.mjs ───────────────────────────────────────────────
  // #2528: the shouted-only markers below are built by concatenation so this
  // test file's own source never contains one as a contiguous string —
  // otherwise editing this very file would trip the hook it exercises.
  describe('check-no-placeholders.mjs', () => {
    it('ALLOWS: a shouted marker mentioned in prose in a .md file (extension allowlist, #1778)', () => {
      const { dir, cleanup } = makeTmpDir()
      try {
        const marker = 'PLACE' + 'HOLDER'
        const f = join(dir, 'MILESTONES.md')
        writeFileSync(f, `This check flags the literal word [${marker}] left in source.\n`)
        expect(runHook('check-no-placeholders.mjs', f, dir).status).toBe(0)
      } finally {
        cleanup()
      }
    })

    it('BLOCKS: a real shouted marker left in a .ts source file (adversarial: extension filter must not weaken enforcement)', () => {
      const { dir, cleanup } = makeTmpDir()
      try {
        const marker = 'PLACE' + 'HOLDER'
        const f = join(dir, 'test.ts')
        writeFileSync(f, `const x = ${marker};\n`)
        expect(runHook('check-no-placeholders.mjs', f, dir).status).toBe(2)
      } finally {
        cleanup()
      }
    })

    it('ALLOWS: the ordinary lowercase English noun in a .ts source file (#2528)', () => {
      const { dir, cleanup } = makeTmpDir()
      try {
        const word = 'place' + 'holder'
        const f = join(dir, 'test.ts')
        writeFileSync(f, `// this is a ${word} for the real value\n`)
        expect(runHook('check-no-placeholders.mjs', f, dir).status).toBe(0)
      } finally {
        cleanup()
      }
    })

    it('ALLOWS: a test name containing the ordinary lowercase noun (#2528)', () => {
      const { dir, cleanup } = makeTmpDir()
      try {
        const word = 'place' + 'holder'
        const f = join(dir, 'test.ts')
        writeFileSync(f, `it('interpolates single {var} ${word}', () => {})\n`)
        expect(runHook('check-no-placeholders.mjs', f, dir).status).toBe(0)
      } finally {
        cleanup()
      }
    })

    it('BLOCKS: a real shouted CHANGE-ME marker, ALLOWS its lowercase form (#2528)', () => {
      const { dir: badDir, cleanup: cleanBad } = makeTmpDir()
      const { dir: okDir, cleanup: cleanOk } = makeTmpDir()
      try {
        const marker = 'CHANGE' + 'ME'
        const word = 'change' + 'me'
        const bad = join(badDir, 'test.ts')
        writeFileSync(bad, `const token = "${marker}";\n`)
        expect(runHook('check-no-placeholders.mjs', bad, badDir).status).toBe(2)

        const ok = join(okDir, 'test.ts')
        writeFileSync(ok, `const token = "${word}";\n`)
        expect(runHook('check-no-placeholders.mjs', ok, okDir).status).toBe(0)
      } finally {
        cleanBad()
        cleanOk()
      }
    })

    it('BLOCKS: a real shouted REPLACE-ME marker, ALLOWS its lowercase form (#2528)', () => {
      const { dir: badDir, cleanup: cleanBad } = makeTmpDir()
      const { dir: okDir, cleanup: cleanOk } = makeTmpDir()
      try {
        const marker = 'REPLACE' + 'ME'
        const word = 'replace' + 'me'
        const bad = join(badDir, 'test.ts')
        writeFileSync(bad, `const secret = "${marker}";\n`)
        expect(runHook('check-no-placeholders.mjs', bad, badDir).status).toBe(2)

        const ok = join(okDir, 'test.ts')
        writeFileSync(ok, `const secret = "${word}";\n`)
        expect(runHook('check-no-placeholders.mjs', ok, okDir).status).toBe(0)
      } finally {
        cleanBad()
        cleanOk()
      }
    })

    // The OTHER checker patterns (unfinished-code markers, disabled-test
    // syntax) are a separate, pre-existing self-reference in these two files
    // — out of scope for #2528 (see the note filed alongside this task) — so
    // these assert absence of the shouted-marker labels specifically, not a
    // blanket clean exit.
    it('finds no shouted-marker violation against its own source file — no self-block (#2528)', () => {
      const selfSource = readFileSync(join(HOOKS_DIR, 'check-no-placeholders.mjs'), 'utf-8')
      const { dir, cleanup } = makeTmpDir()
      try {
        const f = join(dir, 'check-no-placeholders.mjs')
        writeFileSync(f, selfSource)
        const result = runHook('check-no-placeholders.mjs', f, dir)
        expect(result.stderr).not.toContain('PLACE' + 'HOLDER')
        expect(result.stderr).not.toContain('CHANGE' + 'ME')
        expect(result.stderr).not.toContain('REPLACE' + 'ME')
      } finally {
        cleanup()
      }
    })

    it('finds no shouted-marker violation against the scanner test file — no self-block (#2528)', () => {
      const scannerTestPath = resolve(REPO_ROOT, '__tests__/scripts/check-no-placeholders.test.ts')
      const selfTest = readFileSync(scannerTestPath, 'utf-8')
      const { dir, cleanup } = makeTmpDir()
      try {
        const f = join(dir, 'check-no-placeholders.test.ts')
        writeFileSync(f, selfTest)
        const result = runHook('check-no-placeholders.mjs', f, dir)
        expect(result.stderr).not.toContain('PLACE' + 'HOLDER')
        expect(result.stderr).not.toContain('CHANGE' + 'ME')
        expect(result.stderr).not.toContain('REPLACE' + 'ME')
      } finally {
        cleanup()
      }
    })
  })

  // ── check-no-pii.mjs ────────────────────────────────────────────────────────
  describe('check-no-pii.mjs', () => {
    it('BLOCKS: email address with no directive', () => {
      const { dir, cleanup } = makeTmpDir()
      try {
        const f = join(dir, 'test.ts')
        writeFileSync(f, 'const email = "user@example.com";\n')
        expect(runHook('check-no-pii.mjs', f, dir).status).toBe(2)
      } finally {
        cleanup()
      }
    })

    it('BLOCKS: expired directive does not suppress PII detection', () => {
      const { dir, cleanup } = makeTmpDir()
      try {
        const f = join(dir, 'test.ts')
        writeFileSync(
          f,
          '// arbiter-suppress(INV-12, until=2020-01-01, reason="Test fixture email address for integration tests", owner=@luca)\nconst email = "user@example.com";\n',
        )
        expect(runHook('check-no-pii.mjs', f, dir).status).toBe(2)
      } finally {
        cleanup()
      }
    })

    it('BLOCKS: wrong INV-NN does not suppress PII detection', () => {
      const { dir, cleanup } = makeTmpDir()
      try {
        const f = join(dir, 'test.ts')
        writeFileSync(
          f,
          '// arbiter-suppress(INV-04, until=2099-01-01, reason="Test fixture email address for integration tests", owner=@luca)\nconst email = "user@example.com";\n',
        )
        expect(runHook('check-no-pii.mjs', f, dir).status).toBe(2)
      } finally {
        cleanup()
      }
    })

    it('BLOCKS: malformed directive (reason too short) does not suppress PII', () => {
      const { dir, cleanup } = makeTmpDir()
      try {
        const f = join(dir, 'test.ts')
        writeFileSync(
          f,
          '// arbiter-suppress(INV-12, until=2099-01-01, reason="short", owner=@luca)\nconst email = "user@example.com";\n',
        )
        expect(runHook('check-no-pii.mjs', f, dir).status).toBe(2)
      } finally {
        cleanup()
      }
    })

    it('ALLOWS: valid INV-12 directive suppresses PII detection', () => {
      const { dir, cleanup } = makeTmpDir()
      try {
        const f = join(dir, 'test.ts')
        writeFileSync(f, `${VALID_PII}\nconst email = "user@example.com";\n`)
        expect(runHook('check-no-pii.mjs', f, dir).status).toBe(0)
      } finally {
        cleanup()
      }
    })

    // #1809: a bare directory-only entry (no line/pattern) no longer suppresses
    // anything — the specificity floor requires an exact (file + line) pair (or
    // an exact pattern). Matches the fixture below at its exact line.
    const ALLOWLIST_ENTRY = [
      {
        file: '__tests__/integration/fixture.test.ts',
        line: 1,
        reason: 'Fixture emails under __tests__/ are fake test data, not real PII.',
        owner: 'core',
        expiresAt: '2099-01-01',
        scope: 'pii-allowlist',
      },
    ]

    it('ALLOWS: fixture email under a path covered by suppressions/pii-allowlist.json (#1779/#1780)', () => {
      const { dir, cleanup } = makeTmpDir()
      try {
        mkdirSync(join(dir, 'suppressions'), { recursive: true })
        writeFileSync(
          join(dir, 'suppressions', 'pii-allowlist.json'),
          JSON.stringify(ALLOWLIST_ENTRY),
        )
        mkdirSync(join(dir, '__tests__', 'integration'), { recursive: true })
        const f = join(dir, '__tests__', 'integration', 'fixture.test.ts')
        writeFileSync(f, 'const email = "e2e@arbiter.test";\n')
        expect(runHook('check-no-pii.mjs', f, dir).status).toBe(0)
      } finally {
        cleanup()
      }
    })

    it('BLOCKS: PII outside the allowlisted path even with an allowlist file present (adversarial: no scope leak)', () => {
      const { dir, cleanup } = makeTmpDir()
      try {
        mkdirSync(join(dir, 'suppressions'), { recursive: true })
        writeFileSync(
          join(dir, 'suppressions', 'pii-allowlist.json'),
          JSON.stringify(ALLOWLIST_ENTRY),
        )
        mkdirSync(join(dir, 'src'), { recursive: true })
        const f = join(dir, 'src', 'real.ts')
        writeFileSync(f, '// contact: real.person@company.com\n')
        expect(runHook('check-no-pii.mjs', f, dir).status).toBe(2)
      } finally {
        cleanup()
      }
    })

    it('BLOCKS: PII with no allowlist file present at all (adversarial: fail-closed)', () => {
      const { dir, cleanup } = makeTmpDir()
      try {
        mkdirSync(join(dir, '__tests__'), { recursive: true })
        const f = join(dir, '__tests__', 'no-allowlist.ts')
        writeFileSync(f, 'const email = "e2e@arbiter.test";\n')
        expect(runHook('check-no-pii.mjs', f, dir).status).toBe(2)
      } finally {
        cleanup()
      }
    })
  })
})
