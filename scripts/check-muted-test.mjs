#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: anti-fake-green #1 (muted-test, #1412). A GATE test silenced by a skip/disable marker
// CATALOG:   is a falso-green: the suite goes green because the test that would catch the
// CATALOG:   regression never runs. Greps gate test dirs for cross-stack skip markers
// CATALOG:   (it.skip/test.skip/describe.skip/xit/xdescribe — JS/TS; @Disabled/@Ignore — JVM;
// CATALOG:   #[ignore] — Rust; @pytest.mark.skip/@unittest.skip — Python; t.Skip( — Go) and
// CATALOG:   FAILS closed. NO-DATA (no test dir / no test files) is a SKIP at exit 0 — an explicit
// CATALOG:   no-data signal, NEVER a manufactured pass.
// CATALOG: Rejected fold-in into check-anti-proforma.mjs (INV-118): that guard parses TS/JS test
// CATALOG:   BLOCK BODIES for missing assertions (single-language, body analysis); muted-test is a
// CATALOG:   cross-stack skip-MARKER scan with NO-DATA-fail-closed semantics — folding multi-stack
// CATALOG:   marker detection into a TS-only no-assertion parser pollutes its responsibility and
// CATALOG:   breaks its --dir/exempt-ratio model. Rejected fold-in into check-no-passwithnotests.mjs
// CATALOG:   (INV-25): that detects --passWithNoTests in package.json/CI scripts, not in-file skips.
// selfOnly: this guard runs against the arbiter repo only for now; downstream consumer-project
//   generation is DEFERRED to #1419 (LU-1), which consolidates #1412/#1413/#1374 downstream gen.
// Exit codes per INV-53: 0=PASS / NO-DATA-skip, 1=FAIL (muted gate test found), 2=ERROR (self).
// Usage: node scripts/check-muted-test.mjs [--dir <path>] [--help]
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    'Usage: node scripts/check-muted-test.mjs [--dir <path>]\n' +
      '  Fails closed when a gate test is silenced by a skip/disable marker. NO-DATA (no test\n' +
      '  dir / no test files) is a SKIP at exit 0, never a pass.\n',
  )
  process.exit(0)
}
const dirArgIdx = args.indexOf('--dir')
const ROOT = dirArgIdx >= 0 && args[dirArgIdx + 1] ? resolve(args[dirArgIdx + 1]) : process.cwd()

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.coverage'])

// Directories that conventionally hold gate tests across the supported stacks.
const TEST_DIR_NAMES = new Set(['__tests__', 'test', 'tests', 'spec', 'specs'])

// A file is a gate test if its name matches one of these (JS/TS/JVM/Rust/Python/Go conventions).
function isTestFile(name) {
  return (
    /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name) ||
    /Test\.(java|kt)$/.test(name) ||
    /\.(java|kt)$/.test(name) /* JVM tests live under src/test → dir-gated below */ ||
    /_test\.(rs|go|py)$/.test(name) ||
    /^test_.*\.py$/.test(name) ||
    /_spec\.rb$/.test(name)
  )
}

// Cross-stack skip / disable markers, anchored to STATEMENT/ANNOTATION position so a string
// literal that merely mentions a marker (e.g. expect(x).toContain('it.skip(')) is NOT a violation.
// `lead` = the trimmed line must START with the construct (call-statement or annotation); this
// avoids the false-green of a guard that itself fires on its own test fixtures.
const MUTE_PATTERNS = [
  { re: /^(?:await\s+|return\s+)?(?:it|test|describe)\.skip\s*\(/, label: 'js/ts .skip()' },
  { re: /^(?:await\s+|return\s+)?x(?:it|test|describe)\s*\(/, label: 'js/ts xit/xtest/xdescribe' },
  {
    re: /^(?:await\s+|return\s+)?(?:it|test|describe)\.(?:todo|failing)\s*\(/,
    label: 'js/ts .todo/.failing()',
  },
  { re: /^@Disabled\b/, label: 'jvm @Disabled' },
  { re: /^@Ignore\b/, label: 'jvm @Ignore' },
  { re: /^#\[ignore\]/, label: 'rust #[ignore]' },
  { re: /^@(?:pytest\.mark\.skip|unittest\.skip)/, label: 'python skip' },
  { re: /^t\.Skip\s*\(/, label: 'go t.Skip()' },
]

// Inline opt-out for an intentionally-skipped test: a `// muted-test-exempt: <rationale>` comment
// on the marker line or the line above. Requires a rationale (non-empty after the colon).
const EXEMPT_RE = /muted-test-exempt:\s*\S/

/** Recursively collect gate-test file paths, gating JVM files to src/test/** dirs. */
function collectTestFiles(dir, acc, inJvmTestTree) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      const nextJvm = inJvmTestTree || entry === 'test' || entry === 'tests'
      collectTestFiles(full, acc, nextJvm)
    } else if (isTestFile(entry)) {
      // Bare .java/.kt only count when inside a test tree (src/test/**), to avoid main sources.
      if (/\.(java|kt)$/.test(entry) && !/Test\.(java|kt)$/.test(entry) && !inJvmTestTree) continue
      acc.push(full)
    }
  }
}

function main() {
  const files = []
  collectTestFiles(ROOT, files, false)

  if (files.length === 0) {
    // NO-DATA: no gate test files discovered. Explicit skip, never a manufactured pass.
    process.stdout.write('check-muted-test: SKIP — no gate test files found (NO-DATA)\n')
    return 0
  }

  const violations = []
  for (const file of files) {
    let content
    try {
      content = readFileSync(file, 'utf-8')
    } catch {
      continue
    }
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim()
      const prev = i > 0 ? lines[i - 1] : ''
      if (EXEMPT_RE.test(lines[i]) || EXEMPT_RE.test(prev)) continue
      for (const { re, label } of MUTE_PATTERNS) {
        if (re.test(trimmed)) {
          violations.push(`  ${file}:${i + 1}: ${label} — ${trimmed}`)
        }
      }
    }
  }

  if (violations.length > 0) {
    process.stderr.write(
      `check-muted-test: ${violations.length} muted gate test(s) — a silenced gate test is a falso-green:\n`,
    )
    for (const v of violations) process.stderr.write(v + '\n')
    return 1
  }
  process.stdout.write(
    `check-muted-test: OK — ${files.length} gate test file(s), no skip markers\n`,
  )
  return 0
}

try {
  process.exit(main())
} catch (e) {
  process.stderr.write(`check-muted-test: ERROR — ${e?.message ?? e}\n`)
  process.exit(2)
}
