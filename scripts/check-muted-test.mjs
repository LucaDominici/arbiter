#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: anti-fake-green #1 (muted-test, #1412). A GATE test silenced by a skip/disable marker
// CATALOG:   is a falso-green: the suite goes green because the test that would catch the
// CATALOG:   regression never runs. Greps gate test dirs for cross-stack skip markers
// CATALOG:   (it.skip/test.skip/describe.skip/xit/xdescribe — JS/TS; @Disabled/@Ignore plus
// CATALOG:   assume-style aborts assumeTrue/assumeFalse/abort — JVM; #[ignore] — Rust;
// CATALOG:   @pytest.mark.skip/@unittest.skip — Python; t.Skip( — Go) and FAILS closed. An
// CATALOG:   AUDITED `// arbiter-allow-skip: <reason>` marker (line or line-above) makes a skip
// CATALOG:   explicit + greppable + reasoned and opts it out; an UNMARKED skip still fails.
// CATALOG:   NO-DATA (no test dir / no test files) is a SKIP at exit 0 — an explicit no-data
// CATALOG:   signal, NEVER a manufactured pass.
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
      '  Fails closed when a gate test is silenced by a skip/disable marker (incl. JVM assume-\n' +
      '  style aborts: assumeTrue/assumeFalse/abort). Add `// arbiter-allow-skip: <reason>` on\n' +
      '  the marker line or the line above to audit-exempt a legitimate skip. NO-DATA (no test\n' +
      '  dir / no test files) is a SKIP at exit 0, never a pass.\n',
  )
  process.exit(0)
}
const dirArgIdx = args.indexOf('--dir')
const ROOT = dirArgIdx >= 0 && args[dirArgIdx + 1] ? resolve(args[dirArgIdx + 1]) : process.cwd()

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.coverage'])

// A file is a gate test if its name matches one of these (JS/TS/JVM/Rust/Python/Go conventions).
// JS/TS/Rust/Python/Go tests are identified by filename; bare `.java`/`.kt` files are dir-gated to
// a JVM test tree (src/test/**) inside collectTestFiles via the `inJvmTestTree` flag below.
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
  // Assume-style aborts silently skip the rest of a JVM test when their predicate is unmet — a
  // gate test that aborts is just as muted as one annotated @Disabled. Covers JUnit Jupiter
  // (Assumptions.assumeTrue/assumeFalse/abort), JUnit 4 (Assume.assumeTrue/assumeFalse), and
  // statically-imported bare calls. Anchored to statement position to avoid string-literal mentions.
  {
    re: /^(?:Assumptions?|Assume)?\.?assume(?:True|False|NotNull|That)\s*\(/,
    label: 'jvm assume-abort',
  },
  { re: /^(?:Assumptions?\.)?abort\s*\(/, label: 'jvm assume abort()' },
  { re: /^#\[ignore\]/, label: 'rust #[ignore]' },
  { re: /^@(?:pytest\.mark\.skip|unittest\.skip)/, label: 'python skip' },
  { re: /^t\.Skip\s*\(/, label: 'go t.Skip()' },
]

// Audited inline opt-out for an intentionally-skipped gate test. A legitimate skip must be
// EXPLICIT, greppable, and carry a reason: `// arbiter-allow-skip: <reason>` (the canonical
// cross-stack marker) or the legacy `// muted-test-exempt: <rationale>`, on the marker line or
// the line above. The marker MUST sit in a real comment: a comment delimiter (`//` for
// JS/TS/Java/Kotlin/Rust/Go, `#` for Python/Ruby, `*` for a Javadoc continuation line) at
// start-of-line or after whitespace must immediately precede the token. This blocks the
// fake-green of burying the token in a STRING LITERAL (e.g. const x = 'arbiter-allow-skip: lie')
// to silence the guard without an auditable comment. An UNMARKED skip, or a marker with no
// reason, still fails closed.
const EXEMPT_RE = /(?:^|\s)(?:\/\/+|#+|\*)\s*(?:arbiter-allow-skip|muted-test-exempt):\s*\S/

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
