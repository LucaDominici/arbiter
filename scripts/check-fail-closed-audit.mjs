#!/usr/bin/env node
// INV-96: Fail-closed audit gate.
//
// Doctrine: every gate, hook, check, and generator emitted by arbiter must
// default to BLOCK on uncertainty, never SKIP. This script audits the local
// inventory under scripts/, .githooks/, and .claude/hooks/ for known
// fail-open anti-patterns and HARD-fails when a NEW script (one not listed
// in scripts/data/fail-closed-baseline.json) violates the contract.
//
// Checks:
//   * Bash scripts (`.sh`, `.githooks/*` without extension) must include
//     `set -euo pipefail` or equivalent within the first 20 non-comment lines.
//   * Bash `|| true` clauses on non-comment lines flag the file UNLESS the
//     previous non-blank line is a comment beginning with `# FAIL-OPEN-INTENT:`.
//   * Node `.mjs`/`.ts` entry scripts must either wrap their top-level work in
//     a `try {…} catch (…)` block that ends in `process.exit(1)` / re-throw OR
//     consume a helper from `scripts/lib/run-helpers.mjs` (`runCheck` /
//     `runWarnCheck` / `runToolCheck`).
//   * Bare `catch {}` or `catch (e) {}` swallowing — flagged unless the
//     line above the catch is `// FAIL-OPEN-INTENT: <reason>`.
//
// Exit codes (per INV-53): 0 PASS, 1 FAIL, 2 invocation/IO error.
//
// Usage:
//   node scripts/check-fail-closed-audit.mjs                       # audit + baseline diff
//   node scripts/check-fail-closed-audit.mjs --update-baseline     # rewrite baseline
//   node scripts/check-fail-closed-audit.mjs --root <dir>          # alternate root
//
// Baseline grandfathering: every currently non-conformant file is listed in
// `scripts/data/fail-closed-baseline.json`. New violations outside that list
// fail the gate. To remove a file from the baseline (i.e. when it has been
// fixed) regenerate the baseline with `--update-baseline`.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const args = process.argv.slice(2)
const rootArgIdx = args.indexOf('--root')
const ROOT = rootArgIdx >= 0 ? resolve(args[rootArgIdx + 1] ?? '.') : process.cwd()
const UPDATE = args.includes('--update-baseline')
const BASELINE_PATH = resolve(ROOT, 'scripts/data/fail-closed-baseline.json')

// INV-96 scope: PUBLIC dirs only. Never add .env, secrets/, or any path .gitignore'd — audit output reaches CI logs.
const SCAN_DIRS = [
  { dir: 'scripts', recurse: true },
  { dir: '.githooks', recurse: true },
  { dir: '.claude/hooks', recurse: true },
  { dir: '.github/workflows', recurse: false },
]

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  'data', // scripts/data is data, not code
])

const SKIP_FILES = new Set([
  // Helper libraries that intentionally export semantics rather than being entry points.
  'scripts/lib/run-helpers.mjs',
  'scripts/lib/parse-check-args.mjs',
  'scripts/lib/suppressions-shared.mjs',
  'scripts/lib/workflow-scan.mjs',
  'scripts/lib/gen-doc-helpers.mjs',
  // Pure deterministic evaluator (#1373) — exports semantics, no entry point; its
  // missing-file catches return null by design (scored N, never a silent pass).
  'scripts/lib/gold-audit-lib.mjs',
])

const BASH_SHEBANG = /^#!\s*\/(usr\/bin\/env\s+bash|bin\/bash|bin\/sh|usr\/bin\/env\s+sh)/
const NODE_SHEBANG = /^#!\s*\/(usr\/bin\/env\s+node|usr\/local\/bin\/node)/
const PIPEFAIL = /^\s*set\s+-[a-zA-Z]*o\s+pipefail|^\s*set\s+-euo\s+pipefail|^\s*set\s+-e[uo]?\s*$/
const OR_TRUE = /\|\|\s*true\b/
const FAIL_OPEN_MARK = /#\s*FAIL-OPEN-INTENT\s*:/i
const FAIL_OPEN_MARK_JS = /\/\/\s*FAIL-OPEN-INTENT\s*:/i
// `catch {}` and `catch (e) {}` swallowing. Whitespace inside the braces tolerated.
const SWALLOWED_CATCH = /catch\s*(?:\([^)]*\))?\s*\{\s*\}/
const HELPER_IMPORT = /from\s+['"][^'"]*scripts\/lib\/run-helpers(?:\.mjs)?['"]/
const HELPER_USE = /\brun(Check|WarnCheck|ToolCheck)\s*\(/
const TRY_CATCH_EXIT = /process\.exit\(\s*1\s*\)|throw\b/

function listFiles(absDir, recurse) {
  const out = []
  let entries
  try {
    entries = readdirSync(absDir)
  } catch (err) {
    if (err && /** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return out
    throw err
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(absDir, entry)
    let st
    try {
      st = statSync(full)
    } catch (err) {
      // FAIL-OPEN-INTENT: ENOENT is a race (file removed between readdir and stat); rethrow all others.
      if (err && /** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') continue
      throw err
    }
    if (st.isDirectory()) {
      if (recurse) out.push(...listFiles(full, recurse))
      continue
    }
    if (st.isFile()) out.push(full)
  }
  return out
}

function classify(content) {
  const head = content.split('\n', 2)[0] ?? ''
  if (BASH_SHEBANG.test(head)) return 'bash'
  if (NODE_SHEBANG.test(head)) return 'node'
  // Inferred fallbacks by extension.
  return null
}

function inferKind(relPath, content) {
  const explicit = classify(content)
  if (explicit) return explicit
  if (relPath.endsWith('.sh')) return 'bash'
  if (relPath.endsWith('.mjs') || relPath.endsWith('.cjs') || relPath.endsWith('.js')) return 'node'
  if (relPath.endsWith('.ts')) return 'node'
  // .githooks/pre-commit etc. have no extension; treat as bash if shebang absent.
  if (/^\.githooks\//.test(relPath)) return 'bash'
  // Workflow YAML files — audit run: blocks for || true fail-open patterns.
  if (/^\.github\/workflows\/.*\.(yml|yaml)$/.test(relPath)) return 'yaml'
  return null
}

/**
 * Return true if a regex hit on `line` lands inside a `//` comment or a string
 * literal (single, double, or backtick). Used to suppress false positives when
 * the audit script is itself documenting the forbidden pattern.
 */
function isInsideCommentOrString(line, re) {
  const matchIdx = line.search(re)
  if (matchIdx < 0) return false
  let inSingle = false
  let inDouble = false
  let inBacktick = false
  for (let i = 0; i < matchIdx; i++) {
    const ch = line[i]
    if (ch === '\\' && (inSingle || inDouble || inBacktick)) {
      i++
      continue
    }
    if (!inDouble && !inBacktick && ch === "'") inSingle = !inSingle
    else if (!inSingle && !inBacktick && ch === '"') inDouble = !inDouble
    else if (!inSingle && !inDouble && ch === '`') inBacktick = !inBacktick
    else if (!inSingle && !inDouble && !inBacktick && ch === '/' && line[i + 1] === '/') {
      // Rest of line is a comment — the match starts at matchIdx >= i, so it's inside it.
      return true
    }
  }
  return inSingle || inDouble || inBacktick
}

function auditBashPipefail(content) {
  const lines = content.split('\n')
  const violations = []
  let sawPipefail = false
  let nonCommentScanned = 0
  for (const line of lines) {
    if (nonCommentScanned >= 20) break
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    nonCommentScanned++
    if (PIPEFAIL.test(line)) {
      sawPipefail = true
      break
    }
  }
  if (!sawPipefail) {
    violations.push({ kind: 'bash-no-pipefail', detail: 'missing `set -euo pipefail` in head' })
  }
  return violations
}

function auditBashOrTrue(content) {
  const lines = content.split('\n')
  const violations = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!OR_TRUE.test(line)) continue
    // Skip when the `|| true` is itself inside a comment.
    const noStrings = line.replace(/"[^"]*"|'[^']*'/g, '""')
    const commentIdx = noStrings.indexOf('#')
    const orIdx = noStrings.indexOf('|| true')
    if (commentIdx >= 0 && orIdx > commentIdx) continue
    // Look backward for an allowlist comment on the previous non-blank line.
    let allowlisted = false
    for (let j = i - 1; j >= 0; j--) {
      const prev = lines[j].trim()
      if (prev === '') continue
      if (FAIL_OPEN_MARK.test(prev)) allowlisted = true
      break
    }
    if (!allowlisted) {
      violations.push({
        kind: 'bash-or-true',
        detail: `unallowlisted \`|| true\` at line ${i + 1}`,
      })
    }
  }
  return violations
}

function auditBash(content) {
  return [...auditBashPipefail(content), ...auditBashOrTrue(content)]
}

function auditNode(content) {
  const violations = []
  const hasHelper = HELPER_IMPORT.test(content) && HELPER_USE.test(content)
  const hasTryCatch =
    /try\s*\{[\s\S]+?\}\s*catch\s*\([^)]*\)\s*\{[\s\S]*?\}/.test(content) &&
    TRY_CATCH_EXIT.test(content)
  if (!hasHelper && !hasTryCatch) {
    violations.push({
      kind: 'node-no-error-handling',
      detail: 'no top-level try/catch with process.exit(1) and no run-helpers usage',
    })
  }

  // Swallowed catch detection — flag `catch {}` / `catch(e){}` without FAIL-OPEN-INTENT.
  // Skip matches inside `//` line comments and `'…' / "…" / \`…\`` string literals so the
  // audit does not false-positive on documentation of the very pattern it forbids.
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!SWALLOWED_CATCH.test(lines[i])) continue
    if (isInsideCommentOrString(lines[i], SWALLOWED_CATCH)) continue
    let allowlisted = false
    for (let j = i - 1; j >= 0; j--) {
      const prev = lines[j].trim()
      if (prev === '') continue
      if (FAIL_OPEN_MARK_JS.test(prev) || FAIL_OPEN_MARK.test(prev)) allowlisted = true
      break
    }
    if (!allowlisted) {
      violations.push({
        kind: 'node-swallowed-catch',
        detail: `bare catch swallows error at line ${i + 1}`,
      })
    }
  }

  return violations
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) {
    return { schema: 'arbiter-fail-closed-baseline-v1', generated_at: null, files: [] }
  }
  try {
    const raw = readFileSync(BASELINE_PATH, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.files)) {
      process.stderr.write(
        `[check-fail-closed-audit] ERROR: malformed baseline at ${BASELINE_PATH}\n`,
      )
      process.exit(2)
    }
    return parsed
  } catch (err) {
    process.stderr.write(
      `[check-fail-closed-audit] ERROR: cannot read baseline ${BASELINE_PATH}: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(2)
  }
}

function writeBaseline(files) {
  const out = {
    schema: 'arbiter-fail-closed-baseline-v1',
    generated_at: new Date().toISOString(),
    files: [...files].sort(),
  }
  try {
    writeFileSync(BASELINE_PATH, JSON.stringify(out, null, 2) + '\n')
  } catch (err) {
    process.stderr.write(
      `[check-fail-closed-audit] ERROR: cannot write baseline ${BASELINE_PATH}: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(2)
  }
}

function audit() {
  const allViolations = []
  for (const { dir, recurse } of SCAN_DIRS) {
    const abs = resolve(ROOT, dir)
    for (const file of listFiles(abs, recurse)) {
      const rel = relative(ROOT, file).replace(/\\/g, '/')
      if (SKIP_FILES.has(rel)) continue
      // Only audit files that look like entry scripts. Skip data files and READMEs.
      // yaml/yml intentionally NOT excluded — .github/workflows/ yml files are scanned for || true.
      if (/\.(json|md|txt|toml)$/i.test(rel)) continue
      let content
      try {
        content = readFileSync(file, 'utf-8')
      } catch (err) {
        process.stderr.write(
          `[check-fail-closed-audit] ERROR: cannot read ${rel}: ${err instanceof Error ? err.message : String(err)}\n`,
        )
        process.exit(2)
      }
      const kind = inferKind(rel, content)
      if (!kind) continue
      const violations =
        kind === 'bash'
          ? auditBash(content)
          : kind === 'yaml'
            ? auditBashOrTrue(content)
            : auditNode(content)
      if (violations.length > 0) {
        allViolations.push({ file: rel, kind, violations })
      }
    }
  }
  return allViolations
}

const findings = audit()

if (UPDATE) {
  const files = findings.map((f) => f.file)
  writeBaseline(files)
  process.stdout.write(
    `[check-fail-closed-audit] baseline updated — ${files.length} grandfathered file(s)\n`,
  )
  process.exit(0)
}

const baseline = loadBaseline()
const baselineSet = new Set(baseline.files)
const newViolations = findings.filter((f) => !baselineSet.has(f.file))

if (newViolations.length > 0) {
  process.stdout.write(
    `[check-fail-closed-audit] FAIL: ${newViolations.length} new file(s) violate fail-closed contract\n`,
  )
  for (const v of newViolations) {
    process.stdout.write(`  ${v.file} (${v.kind}):\n`)
    for (const item of v.violations) {
      process.stdout.write(`    - [${item.kind}] ${item.detail}\n`)
    }
  }
  process.stdout.write(
    '\nFix the script (see docs/SYSTEM/FAIL_CLOSED.md) or, for a legitimate exception,\n' +
      'mark the offending line with `# FAIL-OPEN-INTENT: <reason>` (bash) or\n' +
      '`// FAIL-OPEN-INTENT: <reason>` (node).\n',
  )
  process.exit(1)
}

process.stdout.write(
  `[check-fail-closed-audit] OK — ${findings.length} grandfathered, 0 new violations\n`,
)
process.exit(0)
