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
//   node scripts/check-fail-closed-audit.mjs --update-baseline --owner <name>
//   node scripts/check-fail-closed-audit.mjs --root <dir>          # alternate root
//
// Baseline grandfathering (#2418): the baseline is a DEBT LEDGER, not an exemption
// list. Every row in `scripts/data/fail-closed-baseline.json` names when the
// exemption was granted (`since`), who owns repaying it (`owner`), and when it
// lapses (`expires`, at most 90 days out) — or, for the rare file that can never
// conform, a written `permanent` rationale. The gate FAILS on an expired row, on a
// window longer than 90 days, on a row whose file no longer violates (so the ledger
// can only shrink), and on any new violation outside the ledger. Regenerating with
// `--update-baseline` preserves each surviving row's metadata VERBATIM — a
// regeneration never renews an expiry, that is a deliberate hand edit — and refuses
// to grandfather a newly-violating file unless `--owner <name>` names its owner.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const args = process.argv.slice(2)
const rootArgIdx = args.indexOf('--root')
const ROOT = rootArgIdx >= 0 ? resolve(args[rootArgIdx + 1] ?? '.') : process.cwd()
const UPDATE = args.includes('--update-baseline')
const ownerArgIdx = args.indexOf('--owner')
const OWNER = ownerArgIdx >= 0 ? (args[ownerArgIdx + 1] ?? '').trim() : ''
const windowArgIdx = args.indexOf('--window')
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
  // CANON-25 #2301: pure gate-roster parser + inversion-ledger semantics; consumers
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
  // #2548 pure byte-level directory-diff helper (removed/added/changed by relative path
  // + content); no entry point, no I/O beyond reads. Consumers
  // (check-kernel-plugin-parity.mjs, regenerate-examples.mjs) own the exit contract and
  // both fail closed (their own top-level try/catch, never exit 0 on an unexpected throw).
  'scripts/lib/dir-diff.mjs',
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
// blanks string/comment/regex bodies before scanning, so the construction string is invisible).
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

// Identifiers/keywords after which a following `/` cannot start a regex — the token
// immediately before is a VALUE (identifier, number, closing bracket), so `/` there reads
// as divide. Everything else (operators, punctuation, keywords, start-of-file) allows a
// regex literal to open. This is the standard divide/regex disambiguation heuristic; it is
// deliberately conservative (see `tryReadRegexLiteral`'s same-line bound below).
const NON_REGEX_KEYWORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'yield',
  'await',
  'do',
  'else',
  'case',
  'throw',
])

/** True when a `/` right after `lastSig` (last significant code char) can open a regex. */
function regexAllowedAfter(out) {
  let j = out.length - 1
  while (j >= 0 && /\s/.test(out[j])) j--
  if (j < 0) return true // start of file
  const c = out[j]
  if (/[A-Za-z0-9_$]/.test(c)) {
    // Walk back over the identifier/number and check it against the keyword lists.
    let k = j
    while (k >= 0 && /[A-Za-z0-9_$]/.test(out[k])) k--
    const word = out.slice(k + 1, j + 1)
    if (NON_REGEX_KEYWORDS.has(word)) return true
    // VALUE_KEYWORDS and any other identifier/number are values => `/` here is divide.
    return false
  }
  if (c === ')' || c === ']') return false // call/index result or grouped expression => a value
  return true // operators, `(`, `{`, `,`, `;`, `:`, `!`, `=`, etc. all allow a regex
}

/**
 * From `start` (the opening `/`), try to read a full regex literal ending on an unescaped
 * `/` on the SAME LINE, respecting character classes (`/` is not a delimiter inside `[...]`)
 * and backslash escapes. Returns the literal text (including trailing flags) or null if no
 * closing `/` is found before the line ends — bounding the scan to one line means a wrong
 * divide/regex guess can never desync masking across line boundaries.
 */
function tryReadRegexLiteral(src, start) {
  let i = start + 1
  let inClass = false
  while (i < src.length) {
    const c = src[i]
    if (c === '\n') return null
    if (c === '\\') {
      i += 2
      continue
    }
    if (inClass) {
      if (c === ']') inClass = false
      i++
      continue
    }
    if (c === '[') {
      inClass = true
      i++
      continue
    }
    if (c === '/') {
      let j = i + 1
      while (j < src.length && /[A-Za-z]/.test(src[j])) j++
      return src.slice(start, j)
    }
    i++
  }
  return null
}

/** Blank a regex literal's body (between the delimiters) the same way string bodies are
 * blanked — this is what neutralizes a quote inside a character class before it can be
 * mistaken for a string open. */
function maskRegexLiteral(literal) {
  const lastSlash = literal.lastIndexOf('/')
  let out = literal[0]
  for (let i = 1; i < lastSlash; i++) out += literal[i] === '\n' ? '\n' : ' '
  out += literal.slice(lastSlash)
  return out
}

/**
 * Return a same-length copy of `src` with the BODIES of strings, comments and regex
 * literals replaced by spaces (newlines preserved so line numbers and brace structure
 * survive). This lets the catch-body scanner reason about real code only — braces or the
 * word "catch" inside a string, comment or regex disappear, so the audit never self-matches
 * on the patterns it documents and never mis-scopes a body on a brace inside a literal.
 *
 * Regex literals ARE masked, via a bounded heuristic (`regexAllowedAfter` +
 * `tryReadRegexLiteral`): distinguishing `/` (divide) from `/…/` (regex) needs a full JS
 * lexer, so this only commits to "regex" when the previous significant token cannot be a
 * value AND a closing `/` exists on the same line; otherwise `/` is left as ordinary code,
 * exactly the prior (safe) behavior. This closes the actual hazard — a quote inside a
 * regex character class (e.g. `/['"]/`) being read as a string open and desyncing the
 * masker for the rest of the file (#2577) — without needing a full lexer.
 */
function maskCode(src) {
  let out = ''
  // A shebang line (`#!/usr/bin/env node`) is never JS syntax — copy it verbatim before the
  // state machine starts. Without this, `regexAllowedAfter`'s start-of-file/after-`!` rule
  // reads the `/` in `/usr/bin/env` as a regex open and hunts for a closing `/`, which it
  // finds inside the path itself (`/usr/`) and masks part of the shebang.
  let i0 = 0
  if (src.startsWith('#!')) {
    const nl = src.indexOf('\n')
    i0 = nl === -1 ? src.length : nl + 1
    out += src.slice(0, i0)
  }
  let state = 'code' // code | line | block | single | double | template
  for (let i = i0; i < src.length; i++) {
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
      } else if (c === '/' && regexAllowedAfter(out)) {
        const literal = tryReadRegexLiteral(src, i)
        if (literal) {
          out += maskRegexLiteral(literal)
          i += literal.length - 1
        } else {
          out += c
        }
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

// Declaration opener for a named function or arrow const, capturing the name and ending
// on the body's `{` so readBraceBlock can lift the body. Built from a string for symmetry
// with the other body-scanning regexes.
const FN_DECL_RE = new RegExp(
  '(?:function\\s+([A-Za-z_$][\\w$]*)\\s*\\([^)]*\\)\\s*' +
    '|(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:async\\s+)?\\([^)]*\\)\\s*=>\\s*)\\{',
  'g',
)
/**
 * Names of file-local functions that SURFACE what they are handed: the body itself carries
 * a surface/propagate token (the `fail(msg)` / `invoke(msg)` / `die(msg)` convention that
 * writes the failure out, records it, throws, or exits). A catch delegating to one of these
 * surfaces the error through a named helper — same semantics the in-body rule already
 * accepts, one indirection deeper — so it is not a swallow.
 *
 * Conservative on purpose: a helper containing any `return` can fall through WITHOUT
 * surfacing, so it does not qualify. Without this, every gate script using the convention
 * was forced into the baseline for errors it was in fact reporting (#2418).
 */
function surfacingHelperNames(masked) {
  const names = new Set()
  FN_DECL_RE.lastIndex = 0
  let m
  while ((m = FN_DECL_RE.exec(masked)) !== null) {
    const name = m[1] ?? m[2]
    if (!name) continue
    const body = readBraceBlock(masked, FN_DECL_RE.lastIndex - 1)
    if (!SURFACE_RE.test(body)) continue
    if (/\breturn\b/.test(body)) continue
    names.add(name)
  }
  return names
}

/**
 * True when the nearest non-blank line ABOVE `lineNo` (1-based, original source) declares
 * `// FAIL-OPEN-INTENT:` / `# FAIL-OPEN-INTENT:` — the marker that turns an undeclared
 * swallow into a declared, reviewed exception.
 */
function hasIntentMarkerAbove(lines, lineNo) {
  for (let j = lineNo - 2; j >= 0; j--) {
    const prev = (lines[j] ?? '').trim()
    if (prev === '') continue
    return FAIL_OPEN_MARK_JS.test(prev) || FAIL_OPEN_MARK.test(prev)
  }
  return false
}

// AC-3 (#2577) — programme-membership floor: a masker that desyncs (a bug like the one this
// issue fixes, or a future one) blanks a long TAIL of the file rather than scattering blanks
// evenly the way normal string/comment masking does. Measured against this repo's own
// scanned files post-fix, the lowest legitimate tail-survival ratio is ~0.065 (heavily
// commented/string-literal-dense modules); a real desync collapses it near zero (~0.01).
// TAIL_SURVIVAL_FLOOR sits with margin below the legitimate floor and above the desync
// signal. This is a backstop for "nobody thought of this hazard" (CANON-24), not a claim
// that 0.03 is theoretically exact — an integrity fault here is a DATA/IO fault (exit 2,
// via `fatal`), never a gate finding: it means the audit could not see the file, not that
// the file violates the contract, so it must never be silently grandfathered into the
// baseline ledger.
const TAIL_LINE_FRACTION = 0.2
const TAIL_MIN_LINES = 10
const TAIL_MIN_ORIG_CHARS = 50 // ignore trivial tails — nothing to desync
const TAIL_SURVIVAL_FLOOR = 0.03

function tailSurvivalRatio(content, masked) {
  const origLines = content.split('\n')
  const maskedLines = masked.split('\n')
  const n = origLines.length
  const tailStart = Math.max(0, n - Math.max(TAIL_MIN_LINES, Math.round(n * TAIL_LINE_FRACTION)))
  let origNonWs = 0
  let maskedNonWs = 0
  for (let i = tailStart; i < n; i++) {
    origNonWs += (origLines[i] ?? '').replace(/\s/g, '').length
    maskedNonWs += (maskedLines[i] ?? '').replace(/\s/g, '').length
  }
  return { origNonWs, ratio: origNonWs > 0 ? maskedNonWs / origNonWs : 1 }
}

/**
 * Fail closed (exit 2) when masking has visibly collapsed a file's tail — the audit cannot
 * distinguish "this file has no more catches" from "the masker went blind here", so it must
 * not guess. This is the check that would have caught #2577 without anyone thinking of quotes.
 */
function checkMaskIntegrity(rel, content, masked) {
  const { origNonWs, ratio } = tailSurvivalRatio(content, masked)
  if (origNonWs < TAIL_MIN_ORIG_CHARS) return
  if (ratio < TAIL_SURVIVAL_FLOOR) {
    fatal(
      `masking collapsed for ${rel} — only ${(ratio * 100).toFixed(1)}% of its tail survived ` +
        `masking (floor ${(TAIL_SURVIVAL_FLOOR * 100).toFixed(0)}%). This means the masker ` +
        `desynced (a string/regex was never closed) and the audit can no longer see this ` +
        `file's catches — fix the file or the masker, this is not a gate finding.`,
    )
  }
}

/**
 * Find every fail-open swallowed `catch` in `content`. A catch is a swallow when its body
 * (masked) carries no surface/propagate token and does not delegate to a surfacing helper.
 * Suppressed when the line above the catch carries a FAIL-OPEN-INTENT marker.
 */
function findSwallowedCatches(content, rel) {
  const masked = maskCode(content)
  checkMaskIntegrity(rel, content, masked)
  const lines = content.split('\n')
  const surfacing = surfacingHelperNames(masked)
  const delegatesRe =
    surfacing.size > 0 ? new RegExp(`\\b(?:${[...surfacing].join('|')})\\s*\\(`) : null
  const hits = []
  CATCH_OPEN_RE.lastIndex = 0
  let m
  while ((m = CATCH_OPEN_RE.exec(masked)) !== null) {
    const body = readBraceBlock(masked, m.index + m[0].length - 1)
    const surfaced = SURFACE_RE.test(body) || (delegatesRe !== null && delegatesRe.test(body))
    if (surfaced) continue
    const lineNo = masked.slice(0, m.index).split('\n').length // 1-based
    if (!hasIntentMarkerAbove(lines, lineNo)) hits.push(lineNo)
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

function auditNode(content, entryScript, rel) {
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
  for (const lineNo of findSwallowedCatches(content, rel)) {
    violations.push({
      kind: 'node-swallowed-catch',
      detail: `catch swallows error without rethrow/exit/surface at line ${lineNo}`,
    })
  }

  return violations
}

// ─── Baseline ledger (#2418) ───────────────────────────────────────────────────

const BASELINE_SCHEMA = 'arbiter-fail-closed-baseline-v2'
const MAX_WINDOW_DAYS = 90
/** A `permanent` row must carry a written reason, not a token word like "legacy". */
const MIN_RATIONALE_CHARS = 24
const DAY_MS = 86_400_000
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

const isoDay = (offsetDays = 0) =>
  new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10)
const daysUntil = (iso) => (Date.parse(`${iso}T00:00:00Z`) - Date.now()) / DAY_MS

function fatal(message) {
  process.stderr.write(`[check-fail-closed-audit] ERROR: ${message}\n`)
  process.exit(2)
}

/** Read the ledger with no policy opinion — the shape `--update-baseline` migrates from. */
function readBaselineRaw() {
  if (!existsSync(BASELINE_PATH)) return null
  let raw
  try {
    raw = readFileSync(BASELINE_PATH, 'utf-8')
  } catch (err) {
    fatal(
      `cannot read baseline ${BASELINE_PATH}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    fatal(
      `malformed JSON in baseline ${BASELINE_PATH}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.files)) {
    fatal(`malformed baseline at ${BASELINE_PATH}: expected an object with a \`files\` array`)
  }
  return parsed
}

const isRowObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isFilledString = (v) => typeof v === 'string' && v.trim() !== ''
const isIsoDate = (v) => typeof v === 'string' && ISO_DATE.test(v)
const isRationale = (v) => typeof v === 'string' && v.trim().length >= MIN_RATIONALE_CHARS

/**
 * The lapse half of a row's contract: EXACTLY one of `expires` / `permanent`, well-formed.
 * A row with both is ambiguous about when it dies; a row with neither never dies at all.
 */
function validateRowLapse(file, entry) {
  const hasExpiry = entry.expires !== undefined
  const hasRationale = entry.permanent !== undefined
  if (hasExpiry === hasRationale) {
    return hasExpiry
      ? [`${file}: carries BOTH \`expires\` and \`permanent\` — a row is one or the other`]
      : [
          `${file}: needs \`expires\` (at most ${MAX_WINDOW_DAYS} days out) or a \`permanent\` rationale`,
        ]
  }
  if (hasExpiry) {
    return isIsoDate(entry.expires) ? [] : [`${file}: malformed \`expires\` (expected YYYY-MM-DD)`]
  }
  return isRationale(entry.permanent)
    ? []
    : [
        `${file}: \`permanent\` needs a written rationale of at least ${MIN_RATIONALE_CHARS} characters`,
      ]
}

/** Structural problems of ONE ledger row (duplicates are a whole-ledger concern). */
function validateRow(entry, index) {
  if (!isRowObject(entry)) {
    return [`entry #${index + 1}: not an object — the v1 bare-path shape carries no date or owner`]
  }
  const file = entry.file
  if (!isFilledString(file)) return [`entry #${index + 1}: missing \`file\``]
  const problems = []
  if (!isIsoDate(entry.since)) {
    problems.push(`${file}: missing or malformed \`since\` (expected YYYY-MM-DD)`)
  }
  if (!isFilledString(entry.owner)) {
    problems.push(`${file}: missing \`owner\` — an unowned exemption is nobody's debt`)
  }
  problems.push(...validateRowLapse(file, entry))
  return problems
}

/**
 * Structural contract for the ledger. Returns human-readable problems; an empty array
 * means every row is dated, owned and bounded. Shape problems are a DATA fault (exit 2),
 * distinct from a policy breach (expired / over-long / stale — exit 1).
 */
function validateRows(rows) {
  const problems = []
  const seen = new Set()
  for (let i = 0; i < rows.length; i++) {
    const file = isRowObject(rows[i]) ? rows[i].file : undefined
    if (isFilledString(file)) {
      if (seen.has(file)) problems.push(`${file}: duplicate entry`)
      seen.add(file)
    }
    problems.push(...validateRow(rows[i], i))
  }
  return problems
}

function loadBaseline() {
  const parsed = readBaselineRaw()
  if (parsed === null) return { schema: BASELINE_SCHEMA, generated_at: null, files: [] }
  if (parsed.schema !== BASELINE_SCHEMA) {
    fatal(
      `baseline schema \`${String(parsed.schema)}\` is not \`${BASELINE_SCHEMA}\` — every row must ` +
        `carry \`since\` + \`owner\` + \`expires\` (or a \`permanent\` rationale). Migrate it with ` +
        `\`node scripts/check-fail-closed-audit.mjs --update-baseline --owner <name>\`.`,
    )
  }
  const problems = validateRows(parsed.files)
  if (problems.length > 0) {
    process.stderr.write(
      `[check-fail-closed-audit] ERROR: ${problems.length} malformed baseline row(s) in ${BASELINE_PATH}:\n` +
        problems.map((p) => `  - ${p}\n`).join(''),
    )
    process.exit(2)
  }
  return parsed
}

function writeBaseline(rows) {
  const out = {
    schema: BASELINE_SCHEMA,
    generated_at: new Date().toISOString(),
    files: [...rows].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0)),
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

/** The existing ledger keyed by path — the metadata a rebuild must carry over verbatim. */
function priorRowsByFile() {
  const rows = new Map()
  for (const entry of readBaselineRaw()?.files ?? []) {
    if (isRowObject(entry) && typeof entry.file === 'string') rows.set(entry.file, entry)
  }
  return rows
}

/** Exemption window for NEW rows: `--window <days>`, capped at the policy maximum. */
function resolveWindowDays() {
  if (windowArgIdx < 0) return MAX_WINDOW_DAYS
  const days = Number(args[windowArgIdx + 1])
  if (!Number.isInteger(days) || days < 1 || days > MAX_WINDOW_DAYS) {
    fatal(`--window must be an integer between 1 and ${MAX_WINDOW_DAYS} days`)
  }
  return days
}

/**
 * Rebuild the ledger from the live findings. Surviving rows keep their metadata
 * VERBATIM (a regeneration must never renew an expiry — renewal is a hand edit that
 * shows up in review); rows whose file no longer violates are dropped; a newly
 * violating file is only grandfathered when `--owner` names who owns repaying it.
 */
function rebuildBaseline(findingFiles) {
  const priorRows = priorRowsByFile()
  const window = resolveWindowDays()
  const added = findingFiles.filter((f) => !priorRows.has(f))
  if (added.length > 0 && OWNER === '') {
    fatal(
      `refusing to grandfather ${added.length} newly-violating file(s) without an owner — ` +
        `re-run with \`--owner <name>\`, or fix them:\n` +
        added.map((f) => `  - ${f}\n`).join(''),
    )
  }
  const rows = findingFiles.map(
    (f) =>
      priorRows.get(f) ?? {
        file: f,
        since: isoDay(0),
        owner: OWNER,
        expires: isoDay(window),
      },
  )
  writeBaseline(rows)
  return {
    kept: rows.length - added.length,
    added: added.length,
    dropped: priorRows.size - (rows.length - added.length),
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
            : auditNode(content, entryScript, rel)
      if (violations.length > 0) {
        allViolations.push({ file: rel, kind, violations })
      }
    }
  }
  return allViolations
}

const findings = audit()

if (UPDATE) {
  const files = findings.map((f) => f.file).sort()
  const { kept, added, dropped } = rebuildBaseline(files)
  process.stdout.write(
    `[check-fail-closed-audit] baseline updated — ${files.length} grandfathered file(s) ` +
      `(${kept} kept verbatim, ${added} newly owned by ${OWNER || '<none>'}, ${dropped} dropped)\n`,
  )
  process.exit(0)
}

const baseline = loadBaseline()
const baselineSet = new Set(baseline.files.map((e) => e.file))
const violatingSet = new Set(findings.map((f) => f.file))

// Ledger policy (#2418): a row is stale once its file stops violating (fixed or deleted)
// — the ledger may only shrink. A live row lapses on its `expires` date, and no row may
// be written more than MAX_WINDOW_DAYS out, so no exemption outlives one quarter.
const stale = []
const expired = []
const overlong = []
for (const entry of baseline.files) {
  if (!violatingSet.has(entry.file)) {
    stale.push(entry.file)
    continue
  }
  if (typeof entry.expires !== 'string') continue
  const remaining = daysUntil(entry.expires)
  if (remaining < 0) {
    expired.push(`${entry.file} — expired ${entry.expires} (owner ${entry.owner})`)
  } else if (remaining > MAX_WINDOW_DAYS) {
    overlong.push(`${entry.file} — expires ${entry.expires}, ${Math.ceil(remaining)} days out`)
  }
}

const newViolations = findings.filter((f) => !baselineSet.has(f.file))

if (stale.length > 0 || expired.length > 0 || overlong.length > 0 || newViolations.length > 0) {
  process.stdout.write('[check-fail-closed-audit] FAIL\n')
  if (expired.length > 0) {
    process.stdout.write(
      `\n${expired.length} EXPIRED baseline row(s) — fix the file or renew the row with a new owner+date:\n` +
        expired.map((l) => `  - ${l}\n`).join(''),
    )
  }
  if (overlong.length > 0) {
    process.stdout.write(
      `\n${overlong.length} baseline row(s) exempt for more than ${MAX_WINDOW_DAYS} days — no exemption may outlive one quarter:\n` +
        overlong.map((l) => `  - ${l}\n`).join(''),
    )
  }
  if (stale.length > 0) {
    process.stdout.write(
      `\n${stale.length} baseline row(s) whose file no longer violates (or no longer exists) — ` +
        `drop them, the ledger only shrinks:\n` +
        stale.map((f) => `  - ${f}\n`).join(''),
    )
  }
  if (newViolations.length > 0) {
    process.stdout.write(
      `\n${newViolations.length} new file(s) violate the fail-closed contract:\n`,
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
  }
  // #2418: `process.exit()` discards stdout still queued on a PIPE, which truncated this
  // report to the first ~90 files whenever the gate ran under a wrapper. Setting the code
  // and letting the process end naturally flushes the whole finding list.
  process.exitCode = 1
} else {
  const permanent = baseline.files.filter((e) => typeof e.permanent === 'string').length
  const nextExpiry = baseline.files
    .filter((e) => typeof e.expires === 'string')
    .sort((a, b) => (a.expires < b.expires ? -1 : 1))[0]
  process.stdout.write(
    `[check-fail-closed-audit] OK — ${baseline.files.length} grandfathered ` +
      `(${permanent} permanent), 0 new violations` +
      (nextExpiry ? `; next expiry ${nextExpiry.expires} (${nextExpiry.file})` : '') +
      '\n',
  )
  process.exitCode = 0
}
