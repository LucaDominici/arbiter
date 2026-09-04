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
import { join, relative, resolve } from 'node:path'

const args = process.argv.slice(2)
const rootArgIdx = args.indexOf('--root')
const ROOT = rootArgIdx >= 0 ? resolve(args[rootArgIdx + 1] ?? '.') : process.cwd()
const UPDATE = args.includes('--update-baseline')
const BASELINE_PATH = resolve(ROOT, 'scripts/data/fail-closed-baseline.json')

// INV-96 scope: PUBLIC dirs only. Never add .env, secrets/, or any path .gitignore'd — audit output reaches CI logs.
// `entryScript: true` dirs hold executable entry points — they must carry top-level
// error handling (node-no-error-handling check). `src/` holds library modules that are
// imported, never executed directly; requiring each to wrap a top-level try/catch is
// nonsensical, so only the swallowed-catch check runs there (a defaulting swallow in a
// governance-deciding engine path is exactly what INV-96 forbids — #1537).
const SCAN_DIRS = [
  { dir: 'scripts', recurse: true, entryScript: true },
  { dir: '.githooks', recurse: true, entryScript: true },
  { dir: '.claude/hooks', recurse: true, entryScript: true },
  { dir: '.github/workflows', recurse: false, entryScript: true },
  { dir: 'src', recurse: true, entryScript: false },
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
  // Pure classification/normalization helpers for the codex self-parity gate (#1966) —
  // exports semantics only; the entry point is scripts/check-codex-self-parity.mjs.
  'scripts/lib/codex-self-parity-lib.mjs',
  // Pure deterministic evaluator (#1373) — exports semantics, no entry point; its
  // missing-file catches return null by design (scored N, never a silent pass).
  'scripts/lib/gold-audit-lib.mjs',
  'scripts/lib/anti-fake-green-core.mjs', // #1412 pure verdict logic; consumers own the exit contract
  'scripts/lib/gh-audit-io.mjs', // #1412 gh I/O helpers; NO-DATA returns {ok:false}, callers own exits
  'scripts/lib/glob-walk.mjs', // #1366: pure glob/tree-walk helper; consumers own the exit contract
  'scripts/lib/continue-on-error-core.mjs', // #1497 pure YAML/value semantics; consumers own exits
  'scripts/lib/secret-presence-core.mjs', // #1497 pure scan semantics; consumers own the exit contract
  'scripts/lib/anti-fake-green-guards.mjs', // #1497 pure guard roster data; no entry point
  'scripts/lib/guard-flip-registry.mjs', // #1497 pure flip-proof registry; no entry point
  // CANON-24 #2301: pure gate-roster parser + inversion-ledger semantics; consumers
  // (check-canon01-declination.mjs, check-guard-flip.mjs) own the exit contract and both
  // fail closed on an unreadable gate source or ledger.
  'scripts/lib/gate-roster.mjs',
  'scripts/lib/ci-cadence.mjs', // #1502 pure cadence-bucket SSOT/partition helper; no entry point
  'scripts/lib/cli-command-names.mjs', // #1838 pure cli.ts command-name parser; consumers (gen-cli-ref, phantom-command-scan) own the exit contract and fail closed on zero-extraction
  'scripts/lib/action-pins.mjs', // #2298 pure CROSS_MAJOR_ALLOWLIST data + effectiveMajor helper; no entry point, consumers (sync-action-pins.mjs, check-action-pins.mjs) own the exit contract
  // T4 (gold-doc-tranches-t3-t5.md §2.2): pure resolution SSOT shared by check-doc-set.mjs and
  // check-doc-freshness.mjs — exports semantics only, no entry point (mirrors the
  // gold-audit.mjs / gold-audit-lib.mjs split above); its missing-file catches return
  // false/[]/undefined by design, and both entry-point consumers own the exit contract.
  'scripts/lib/doc-set-resolve.mjs',
  // E1 #1943: pure agent-return envelope semantics (schema validate + M12 citation resolve);
  // consumers (check-agent-return.mjs, record-agent-return.mjs) own the exit contract.
  'scripts/lib/agent-return-validate.mjs',
  // #1943: pure shared argv parser for the enforcer gate scripts; no entry point.
  'scripts/lib/gate-args.mjs',
  // #1984: pure mtime-comparison helper for the stale-dist guard; no entry point.
  // Consumers (check-self-dogfood.mjs, check-codex-self-parity.mjs) own the exit
  // contract (both fail closed with exit 2 on a stale/missing dist).
  'scripts/lib/dist-staleness.mjs',
  // INV-138: pure AC parsing/validation semantics (no I/O, no process.exit); consumers
  // (check-acceptance.mjs, issue-readiness.mjs) own the exit contract and fail closed
  // (exit 2) on malformed state / unreadable plans.
  'scripts/lib/acceptance-criteria.mjs',
  // #2135 pure private-consumer reliability oracles; executable prepare/verifier/probe
  // entry points own the 0/1/2 contract and convert every oracle verdict fail-closed.
  'scripts/lib/consumer-reliability-bar.mjs',
  // #2148 pure exact-SHA policy declarations/validation; the watcher and branch
  // protection applicator own all I/O and convert validation errors fail-closed.
  'scripts/lib/exact-sha-policy.mjs',
  // #2399 pure content-binding semantics (staleness reason + foreign-sidecar predicate);
  // no entry point — its consumers own the exit contract and fail closed on a non-null reason.
  'scripts/lib/evidence-binding.mjs',
  // #2417 pure self-only-surfaces derivation (commands/skills/agents/hooks diffed against
  // the emitted templates); no entry point — consumers (gen-llms-txt.mjs,
  // __tests__/scripts/self-only-surfaces.test.ts) own the exit contract.
  'scripts/lib/self-only-surfaces.mjs',
])

const BASH_SHEBANG = /^#!\s*\/(usr\/bin\/env\s+bash|bin\/bash|bin\/sh|usr\/bin\/env\s+sh)/
const NODE_SHEBANG = /^#!\s*\/(usr\/bin\/env\s+node|usr\/local\/bin\/node)/
const PIPEFAIL = /^\s*set\s+-[a-zA-Z]*o\s+pipefail|^\s*set\s+-euo\s+pipefail|^\s*set\s+-e[uo]?\s*$/
const OR_TRUE = /\|\|\s*true\b/
const FAIL_OPEN_MARK = /#\s*FAIL-OPEN-INTENT\s*:/i
const FAIL_OPEN_MARK_JS = /\/\/\s*FAIL-OPEN-INTENT\s*:/i
const HELPER_IMPORT = /from\s+['"][^'"]*scripts\/lib\/run-helpers(?:\.mjs)?['"]/
const HELPER_USE = /\brun(Check|WarnCheck|ToolCheck)\s*\(/
const TRY_CATCH_EXIT = /process\.exit\(\s*[12]\s*\)|throw\b/

// `catch` opener — built from a string so this audit file does not self-match (maskCode
// blanks string/comment bodies before scanning, so the construction string is invisible).
const CATCH_OPEN_RE = new RegExp('catch\\s*(?:\\([^)]*\\))?\\s*\\{', 'g')

// A catch body is a fail-open SWALLOW unless it re-throws, exits non-zero, surfaces the
// error (logs / stderr), or propagates (rejects). This subsumes the empty-brace,
// `return null/undefined/false`, `continue`, `break`, and comment-only shapes — every
// pattern that disarms a control silently. Built from a string for the same reason.
const SURFACE_RE = new RegExp(
  [
    '\\bthrow\\b',
    'process\\.exit\\(\\s*(?!0\\s*\\))', // exit(non-zero) or exit(var)
    'process\\.exitCode\\s*=\\s*(?!0)',
    'console\\.(error|warn|log|info|debug)',
    '\\bstderr\\b',
    '\\bstdout\\b',
    'log(Error|Warn|Info|Fatal)',
    'core\\.setFailed',
    '\\breject\\b',
    'return\\s+Promise\\.reject',
  ].join('|'),
)

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
 * Return a same-length copy of `src` with the BODIES of strings and comments replaced by
 * spaces (newlines preserved so line numbers and brace structure survive). This lets the
 * catch-body scanner reason about real code only — braces or the word "catch" inside a
 * string or comment disappear, so the audit never self-matches on the patterns it documents
 * and never mis-scopes a body on a brace inside a literal.
 *
 * Regex literals are intentionally NOT masked: distinguishing `/` (divide) from `/…/`
 * (regex) needs a full JS lexer, and a wrong guess desyncs the masker and blanks real code.
 * A regex literal almost never contains an unescaped `catch {` or an unbalanced brace, so
 * leaving it visible is strictly safer than a heuristic that can swallow whole files.
 */
function maskCode(src) {
  let out = ''
  let state = 'code' // code | line | block | single | double | template
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    const c2 = src[i + 1]
    if (state === 'code') {
      if (c === '/' && c2 === '/') {
        out += '  '
        i++
        state = 'line'
      } else if (c === '/' && c2 === '*') {
        out += '  '
        i++
        state = 'block'
      } else if (c === "'") {
        out += c
        state = 'single'
      } else if (c === '"') {
        out += c
        state = 'double'
      } else if (c === '`') {
        out += c
        state = 'template'
      } else {
        out += c
      }
      continue
    }
    if (state === 'line') {
      if (c === '\n') {
        out += '\n'
        state = 'code'
      } else out += ' '
      continue
    }
    if (state === 'block') {
      if (c === '*' && c2 === '/') {
        out += '  '
        i++
        state = 'code'
      } else out += c === '\n' ? '\n' : ' '
      continue
    }
    // string / template bodies
    if (c === '\\') {
      out += '  '
      i++
      continue
    }
    const closes =
      (state === 'single' && c === "'") ||
      (state === 'double' && c === '"') ||
      (state === 'template' && c === '`')
    if (closes) {
      out += c
      state = 'code'
      continue
    }
    out += c === '\n' ? '\n' : ' '
  }
  return out
}

/**
 * Given masked content and the index of a `{`, return the inner text up to the matching
 * `}` (exclusive). Masked content has no literal/comment braces, so depth tracking is safe.
 */
function readBraceBlock(masked, openIdx) {
  let depth = 0
  for (let i = openIdx; i < masked.length; i++) {
    if (masked[i] === '{') depth++
    else if (masked[i] === '}') {
      depth--
      if (depth === 0) return masked.slice(openIdx + 1, i)
    }
  }
  return masked.slice(openIdx + 1)
}

/**
 * Find every fail-open swallowed `catch` in `content`. A catch is a swallow when its body
 * (masked) carries no surface/propagate token. Suppressed when the previous non-blank line
 * in the ORIGINAL source is a `// FAIL-OPEN-INTENT:` (or `# …`) marker.
 */
function findSwallowedCatches(content) {
  const masked = maskCode(content)
  const lines = content.split('\n')
  const hits = []
  CATCH_OPEN_RE.lastIndex = 0
  let m
  while ((m = CATCH_OPEN_RE.exec(masked)) !== null) {
    const openIdx = m.index + m[0].length - 1
    const body = readBraceBlock(masked, openIdx)
    if (SURFACE_RE.test(body)) continue
    const lineNo = masked.slice(0, m.index).split('\n').length // 1-based
    let allowlisted = false
    for (let j = lineNo - 2; j >= 0; j--) {
      const prev = (lines[j] ?? '').trim()
      if (prev === '') continue
      if (FAIL_OPEN_MARK_JS.test(prev) || FAIL_OPEN_MARK.test(prev)) allowlisted = true
      break
    }
    if (!allowlisted) hits.push(lineNo)
  }
  return hits
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

function auditNode(content, entryScript) {
  const violations = []

  // Entry-point contract: executable scripts must carry top-level error handling. Library
  // modules under src/ are imported, never run directly — this check does not apply there.
  if (entryScript) {
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
  }

  // Swallowed-catch detection (applies everywhere, including src/).
  for (const lineNo of findSwallowedCatches(content)) {
    violations.push({
      kind: 'node-swallowed-catch',
      detail: `catch swallows error without rethrow/exit/surface at line ${lineNo}`,
    })
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
  for (const { dir, recurse, entryScript } of SCAN_DIRS) {
    const abs = resolve(ROOT, dir)
    for (const file of listFiles(abs, recurse)) {
      const rel = relative(ROOT, file).replace(/\\/g, '/')
      if (SKIP_FILES.has(rel)) continue
      // Only audit files that look like entry scripts. Skip data files and READMEs.
      // yaml/yml intentionally NOT excluded — .github/workflows/ yml files are scanned for || true.
      // .ejs templates are EJS source, not executable code — render tests cover them.
      if (/\.(json|md|txt|toml|ejs)$/i.test(rel)) continue
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
            : auditNode(content, entryScript)
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
