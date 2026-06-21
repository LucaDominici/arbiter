// SPDX-License-Identifier: Apache-2.0
// gold-audit-lib.mjs — deterministic gold-audit evaluator (#1373).
//
// Reimplements the upstream reference gold-audit registry evaluator natively in node (zero
// Python dependency). The score is computed by code, never by an AI. Pure functions only — no
// process.exit, no argv, no console. The thin CLI (scripts/gold-audit.mjs) and the report
// consumer (scripts/gold-report.mjs) both call evaluate() so there is one code path.
//
// Verdicts (per check):
//   Y  — verified true by code, with evidence (file [+ line])
//   P  — partial (a count_matches check met some but not all of its target)
//   N  — verified false by code, with evidence (the path/pattern that was absent)
//   NA — not applicable (applies_if overlay disabled)
//   NV — not verified by code (manual / attestation-required check)
//
// Determinism contract: identical repo + identical registry ⇒ identical evaluate() output.
// Checks are evaluated in stable id order; no wall-clock value enters the scored payload.

import { existsSync, readFileSync, statSync, lstatSync } from 'node:fs'
import { resolve, relative, isAbsolute } from 'node:path'
import { globMatch, validateGlob, walkRepo } from './glob-walk.mjs'

/**
 * Resolve a registry-declared path inside root; reject traversal + null bytes. Parity contract:
 * behaves byte-identically to src/conformance/shared.ts safeResolve for string inputs (reject only
 * `\0` + post-resolve `..` escape — a literal filename containing '..' that stays in-root is
 * allowed, matching the TS engine). The leading non-string guard is .mjs-only safety (the TS engine
 * defaults a missing args.path to ''); for any real path both engines agree.
 */
function safeResolve(root, p) {
  if (typeof p !== 'string' || p.includes('\0')) return null
  const abs = resolve(root, p)
  const rel = relative(root, abs)
  if (rel.startsWith('..') || isAbsolute(rel)) return null
  return abs
}

/** Read a file's text, or null if missing/unreadable. */
function readText(abs) {
  try {
    return readFileSync(abs, 'utf-8')
  } catch {
    return null
  }
}

/** 1-based line number of the first occurrence of `needle` in `text`, or null. */
function lineOf(text, needle) {
  const idx = text.indexOf(needle)
  if (idx < 0) return null
  let line = 1
  for (let i = 0; i < idx; i++) if (text[i] === '\n') line++
  return line
}

/** 1-based line number of the character at `idx` in `text`. */
function lineAtIndex(text, idx) {
  let line = 1
  for (let i = 0; i < idx && i < text.length; i++) if (text[i] === '\n') line++
  return line
}

// ── Constrained deterministic glob (#1470) ──────────────────────────────────────
//
// Glob support reuses scripts/lib/glob-walk.mjs (globMatch/validateGlob/walkRepo: POSIX paths,
// prunes SKIP_DIRS) — one canonical matcher, never a hand-written copy (CANON-16). The TS engine
// mirrors this via src/conformance/shared.ts expandGlob (engine-parity gate). Both sort with a plain
// `.sort()` (code-unit), NEVER localeCompare, so the file order is byte-identical across engines.

/**
 * Expand a repo-rooted glob to a SORTED array of repo-relative POSIX paths, or null when the glob
 * is invalid (absolute / `..`-traversal / non-string). An empty array is a valid "matched nothing".
 */
function expandGlob(root, pattern) {
  if (typeof pattern !== 'string' || pattern === '' || !validateGlob(pattern)) return null
  return walkRepo(root)
    .filter((f) => globMatch(pattern, f))
    .sort()
}

/**
 * Deterministic, locale-independent string order (UTF-16 code units) — byte-identical across the
 * .mjs and TS engines and immune to Node/ICU collation drift (#1471). Used for every check /
 * dimension sort so the scored payload's ordering can never silently diverge between engines.
 */
function cmpCodeUnit(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Resolve a glob-check's `args.glob` to a SORTED match list. Returns { ok:true, glob, matched } on
 * success, or { ok:false, result } (a verified-N) when the glob is invalid/empty — shared by every
 * glob-based check so the invalid-glob guard exists once (mirrored in src/conformance/engine.ts).
 */
function resolveGlobArg(args, root) {
  const glob = typeof args.glob === 'string' ? args.glob : ''
  const matched = expandGlob(root, glob)
  if (matched === null) {
    return {
      ok: false,
      result: { verdict: 'N', evidence: { file: glob, detail: 'invalid or empty glob' } },
    }
  }
  return { ok: true, glob, matched }
}

/**
 * Whether git tracks the executable bit in this repo (core.fileMode). Reads `<root>/.git/config`
 * deterministically (no spawn — INV-12); only an explicit `filemode = false` disables it. A missing
 * or unreadable config (e.g. a worktree pointer file, or a non-git fixture) ⇒ treated as enabled, so
 * the exec-bit check still runs. Mirrored byte-for-byte in src/conformance/engine.ts.
 */
function gitFileModeEnabled(root) {
  const cfg = readText(resolve(root, '.git/config'))
  if (cfg === null) return true
  let inCore = false
  let lastValue = null
  for (const raw of cfg.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('[')) {
      // Only the exact top-level [core] section — a `[core "subsection"]` is NOT [core].filemode.
      inCore = /^\[core\]/i.test(line)
      continue
    }
    if (!inCore) continue
    // git honors the LAST value when a key is declared more than once — keep scanning, don't return.
    const m = /^filemode\s*=\s*(\S+)/i.exec(line)
    if (m !== null) lastValue = m[1].toLowerCase()
  }
  return lastValue === null ? true : lastValue !== 'false'
}

// ── #1413: deterministic report metric extraction (json/xml/regex) ──────────────
//
// A `value` check with an `args.format` reads a PRE-GENERATED tool report deterministically (no live
// spawn: that would break the determinism + parity + fail-closed contracts). It extracts a single
// numeric metric and compares it against a per-brownfield-class bar resolved via `threshold_ref`. A
// check whose report file is ABSENT resolves to NA (the tool did not run / does not apply) — never a
// false-N. This logic is byte-identical to src/conformance/engine.ts (engine-parity.test.ts).

/** Read a numeric metric from a JSON report via a dotted path (e.g. `total.lines.pct`), or null. */
function extractJson(text, select) {
  let node
  try {
    node = JSON.parse(text)
  } catch {
    return null
  }
  for (const key of select.split('.')) {
    if (key === '') continue
    if (node === null || typeof node !== 'object') return null
    node = node[key]
  }
  const n = typeof node === 'number' ? node : Number(node)
  return Number.isFinite(n) ? n : null
}

/**
 * Read a numeric metric from an XML report. Selectors (deterministic, dependency-free):
 *   `count:tag`        → number of `<tag` occurrences (open or self-closing)
 *   `attr:tag@name`    → the numeric `name="…"` attribute of the first `<tag …>` element
 */
function extractXml(text, select) {
  if (select.startsWith('count:')) {
    const tag = select.slice('count:'.length)
    if (tag === '') return null
    let count = 0
    const needle = `<${tag}`
    let from = 0
    for (;;) {
      const i = text.indexOf(needle, from)
      if (i < 0) break
      const next = text[i + needle.length]
      if (
        next === undefined ||
        next === ' ' ||
        next === '\t' ||
        next === '\n' ||
        next === '\r' ||
        next === '>' ||
        next === '/'
      ) {
        count++
      }
      from = i + needle.length
    }
    return count
  }
  if (select.startsWith('attr:')) {
    const spec = select.slice('attr:'.length)
    const at = spec.indexOf('@')
    if (at < 0) return null
    const tag = spec.slice(0, at)
    const attr = spec.slice(at + 1)
    if (tag === '' || attr === '') return null
    const open = text.indexOf(`<${tag}`)
    if (open < 0) return null
    const close = text.indexOf('>', open)
    const segment = close < 0 ? text.slice(open) : text.slice(open, close)
    // Guard the attr RegExp build: a regex metachar in the attr name (`attr:a@(`) would otherwise
    // throw — yield null (⇒ per-check N 'no metric') instead of crashing the whole audit.
    let m
    try {
      m = new RegExp(`${attr}\\s*=\\s*"([^"]*)"`).exec(segment)
    } catch {
      return null
    }
    if (m === null) return null
    const n = Number(m[1])
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Read a numeric metric from text via a regex whose first capture group is the number. */
function extractRegex(text, select) {
  let re
  try {
    re = new RegExp(select)
  } catch {
    return null
  }
  const m = re.exec(text)
  if (m === null || m[1] === undefined) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

/** Extract a numeric metric from a report's text for the given format + selector, or null. */
function extractMetric(text, format, select) {
  if (format === 'json') return extractJson(text, select)
  if (format === 'xml') return extractXml(text, select)
  if (format === 'regex') return extractRegex(text, select)
  return null
}

/** Apply a comparison operator. Unknown op fails closed (false). */
function compareValue(actual, op, bar) {
  if (op === 'gte') return actual >= bar
  if (op === 'lte') return actual <= bar
  if (op === 'eq') return actual === bar
  return false
}

/**
 * Resolve the comparison bar for a value check: `threshold_ref` row keyed by the active brownfield
 * class, else the literal `args.expected`. Returns null when neither yields a finite number.
 */
function resolveBar(check, options) {
  const ref = check.threshold_ref
  if (ref !== undefined && ref !== '') {
    const table = options.thresholds ?? {}
    const row = table[ref]
    if (row === undefined) return null
    const cls = options.brownfieldClass ?? 'gold'
    const bar = Object.prototype.hasOwnProperty.call(row, cls) ? row[cls] : undefined
    return typeof bar === 'number' && Number.isFinite(bar) ? bar : null
  }
  const lit = check.args?.expected
  return typeof lit === 'number' && Number.isFinite(lit) ? lit : null
}

/**
 * value-op report-extraction evaluator (#1413). Reads a pre-generated tool report; absent report ⇒
 * NA (no false-N). Bar resolved per brownfield class via threshold_ref / args.expected.
 */
function evalValueReport(abs, rel, check, options) {
  // Absent report ⇒ NA: the tool did not run / does not apply for this stack (never a false-N).
  if (!existsSync(abs)) return { verdict: 'NA', evidence: null }
  const args = check.args || {}
  const format = String(args.format ?? '')
  const select = String(args.select ?? '')
  const op = String(args.op ?? '')
  const bar = resolveBar(check, options)
  if (bar === null) {
    return { verdict: 'N', evidence: { file: rel, detail: 'unresolved threshold' } }
  }
  const text = readText(abs)
  if (text === null) return { verdict: 'N', evidence: { file: rel, detail: 'unreadable' } }
  const actual = extractMetric(text, format, select)
  if (actual === null) {
    return { verdict: 'N', evidence: { file: rel, detail: `no metric for ${format}:${select}` } }
  }
  const pass = compareValue(actual, op, bar)
  return pass
    ? { verdict: 'Y', evidence: { file: rel, detail: `${actual} ${op} ${bar}` } }
    : { verdict: 'N', evidence: { file: rel, detail: `${actual} !${op} ${bar}` } }
}

// ── version_consistency: a VERSION file ↔ the latest CHANGELOG entry ─────────────
//
// Catches release-hygiene drift: the declared VERSION must equal the newest version recorded in
// the CHANGELOG. Pure text read + a single regex (no spawn, no wall-clock) — byte-deterministic.

/** First capture group of `pattern` (multiline) in `text` = the latest declared version, or null. */
function latestChangelogVersion(text, pattern) {
  if (typeof pattern !== 'string' || pattern === '') return null
  let re
  try {
    re = new RegExp(pattern, 'm')
  } catch {
    return null
  }
  const m = re.exec(text)
  // A falsy/empty capture is NOT a version — return null so the caller scores P (indeterminate),
  // never a false Y (e.g. an empty trimmed VERSION === an empty capture).
  return m !== null && m[1] ? m[1] : null
}

/**
 * version_consistency evaluator. Y = VERSION equals the latest CHANGELOG entry; P = both present
 * but divergent OR no changelog entry matches the pattern (indeterminate — never a false Y);
 * N = a required file is missing/unreadable.
 */
function evalVersionConsistency(args, root) {
  const vFile = typeof args.version_file === 'string' ? args.version_file : ''
  const cFile = typeof args.changelog_file === 'string' ? args.changelog_file : ''
  const vAbs = safeResolve(root, vFile)
  const cAbs = safeResolve(root, cFile)
  if (vAbs === null || cAbs === null) {
    return { verdict: 'N', evidence: { file: vFile || cFile, detail: 'invalid path' } }
  }
  const vText = readText(vAbs)
  if (vText === null)
    return { verdict: 'N', evidence: { file: vFile, detail: 'missing version file' } }
  const cText = readText(cAbs)
  if (cText === null)
    return { verdict: 'N', evidence: { file: cFile, detail: 'missing changelog' } }
  const version = vText.trim()
  if (version === '') {
    return { verdict: 'P', evidence: { file: vFile, detail: 'empty version file' } }
  }
  const latest = latestChangelogVersion(cText, args.changelog_pattern)
  if (latest === null) {
    return {
      verdict: 'P',
      evidence: { file: cFile, detail: 'no changelog entry matches the pattern' },
    }
  }
  if (version === latest) {
    return { verdict: 'Y', evidence: { file: vFile, detail: `${version} == ${latest}` } }
  }
  return {
    verdict: 'P',
    evidence: { file: cFile, detail: `VERSION ${version} != CHANGELOG ${latest}` },
  }
}

// ── Per-type check evaluators (extracted to mirror src/conformance/engine.ts) ────
// The dispatch in evalCheck stays a thin if-chain over these handlers so the two engines keep an
// identical structure (parity) and no single function grows past the complexity ceiling as types
// are added. file_exists rejects directories + returns null evidence on N to match the TS engine
// exactly (removes the previously-tolerated directory/evidence divergence).

function evalFileExists(abs, rel) {
  if (!existsSync(abs)) return { verdict: 'N', evidence: { file: rel, detail: 'missing' } }
  try {
    if (statSync(abs).isDirectory())
      return { verdict: 'N', evidence: { file: rel, detail: 'is a directory' } }
  } catch {
    return { verdict: 'N', evidence: { file: rel, detail: 'unreadable' } }
  }
  return { verdict: 'Y', evidence: { file: rel } }
}

function evalFileContains(abs, rel, pattern) {
  const text = readText(abs)
  if (text === null) return { verdict: 'N', evidence: { file: rel, detail: 'missing' } }
  const line = lineOf(text, pattern)
  return line !== null
    ? { verdict: 'Y', evidence: { file: rel, line } }
    : { verdict: 'N', evidence: { file: rel, detail: `pattern not found: ${pattern}` } }
}

function evalCountMatches(abs, rel, pattern, want) {
  const text = readText(abs)
  if (text === null) return { verdict: 'N', evidence: { file: rel, detail: 'missing' } }
  let count = 0
  let from = 0
  while (pattern.length > 0) {
    const i = text.indexOf(pattern, from)
    if (i < 0) break
    count++
    from = i + pattern.length
  }
  if (count >= want) return { verdict: 'Y', evidence: { file: rel, detail: `count=${count}` } }
  if (count > 0) return { verdict: 'P', evidence: { file: rel, detail: `count=${count}/${want}` } }
  return { verdict: 'N', evidence: { file: rel, detail: `count=0/${want}` } }
}

function evalValue(abs, rel, expected) {
  const text = readText(abs)
  if (text === null) return { verdict: 'N', evidence: { file: rel, detail: 'missing' } }
  const line = lineOf(text, expected)
  return line !== null
    ? { verdict: 'Y', evidence: { file: rel, line } }
    : { verdict: 'N', evidence: { file: rel, detail: `value not present: ${expected}` } }
}

// ── forbidden_pattern: a regex that must NOT appear in any file under a glob (#1470) ──
//
// Scores an ABSENCE property with anti-fake-green hardening (red-team): an empty scan must never
// fake-green. Verdict ladder (order matters — evaluated top-down, byte-identical to engine.ts):
//   empty/non-string pattern ⇒ N · invalid regex ⇒ N · invalid/empty glob ⇒ N ·
//   exclude entry with a glob char ⇒ N (literal-only) · exclude_paths set w/o rationale ⇒ N ·
//   glob matched 0 files ⇒ NA (nothing of this kind exists) ·
//   excludes removed ALL matched files ⇒ N (refuse to fake-green an emptied scan) ·
//   pattern found ⇒ N (first SORTED file + line) · absent across every scanned file ⇒ Y.

/** True if a string contains any glob metacharacter (so it is NOT a literal path). */
function hasGlobChar(s) {
  return /[*?[\]]/.test(s)
}

function evalForbiddenPattern(args, root) {
  const pattern = typeof args.pattern === 'string' ? args.pattern : ''
  if (pattern === '') {
    return { verdict: 'N', evidence: { file: '', detail: 'empty or non-string pattern' } }
  }
  let re
  try {
    re = new RegExp(pattern)
  } catch {
    return { verdict: 'N', evidence: { file: '', detail: `invalid regex: ${pattern}` } }
  }
  const g = resolveGlobArg(args, root)
  if (!g.ok) return g.result
  const { glob, matched } = g
  const excludeRaw = Array.isArray(args.exclude_paths) ? args.exclude_paths : []
  for (const ex of excludeRaw) {
    if (typeof ex !== 'string' || hasGlobChar(ex)) {
      return {
        verdict: 'N',
        evidence: { file: glob, detail: `exclude_paths must be literal: ${ex}` },
      }
    }
  }
  if (excludeRaw.length > 0) {
    const rationale = typeof args.rationale === 'string' ? args.rationale.trim() : ''
    if (rationale === '') {
      return {
        verdict: 'N',
        evidence: { file: glob, detail: 'exclude_paths requires a rationale' },
      }
    }
  }
  if (matched.length === 0) {
    return { verdict: 'NA', evidence: null }
  }
  const exclude = new Set(excludeRaw)
  const remaining = matched.filter((f) => !exclude.has(f))
  if (remaining.length === 0) {
    return {
      verdict: 'N',
      evidence: { file: glob, detail: 'all matched files excluded (refusing fake-green)' },
    }
  }
  for (const rel of remaining) {
    const abs = safeResolve(root, rel)
    const text = abs === null ? null : readText(abs)
    if (text === null) {
      // A matched, non-excluded file we cannot read ⇒ we cannot assert the pattern is ABSENT over
      // it. Fail-closed N (never a silent skip → a chmod-000 file holding the marker must not
      // fake-green to Y). Deterministic: `remaining` is sorted, so the first anomaly wins.
      return { verdict: 'N', evidence: { file: rel, detail: 'unreadable — cannot verify absence' } }
    }
    const m = re.exec(text)
    if (m !== null) {
      return {
        verdict: 'N',
        evidence: {
          file: rel,
          line: lineAtIndex(text, m.index),
          detail: 'forbidden pattern present',
        },
      }
    }
  }
  // Y only when EVERY remaining file was actually read — the count is honest, never inflated.
  return {
    verdict: 'Y',
    evidence: { file: glob, detail: `absent across ${remaining.length} file(s)` },
  }
}

// ── file_stat: the executable bit on a glob of files (#1470) ─────────────────────
//
// Only the executable bit (mode & 0o111) is portable — git tracks 0o111 but read/write depend on
// the umask (non-deterministic), so a readable/writable request is a config error (N). Gated behind
// core.fileMode: when git does not track the exec bit the property is unmeasurable ⇒ NA. Symlinks
// are evaluated by their OWN mode (lstat), never their target's. Verdict: all exec ⇒ Y, some ⇒ P,
// none ⇒ N; a valid glob matching 0 files ⇒ NA; a malformed glob ⇒ N.

function evalFileStat(args, root) {
  const bit = typeof args.bit === 'string' ? args.bit.toLowerCase() : 'executable'
  if (bit !== 'executable') {
    return {
      verdict: 'N',
      evidence: { file: '', detail: `only the executable bit is deterministic, got: ${bit}` },
    }
  }
  const g = resolveGlobArg(args, root)
  if (!g.ok) return g.result
  const { glob, matched } = g
  if (matched.length === 0) {
    return { verdict: 'NA', evidence: null }
  }
  if (!gitFileModeEnabled(root)) {
    return { verdict: 'NA', evidence: null }
  }
  let withBit = 0
  let firstMissing = null
  for (const rel of matched) {
    const abs = safeResolve(root, rel)
    let exec = false
    try {
      const st = abs === null ? null : lstatSync(abs)
      // A symlink is NOT a tracked executable regular file (git stores it as a symlink, not 0o755),
      // and its OWN lstat mode is always 0o777 — trusting it would fake-green the exec bit. Treat a
      // symlink as not-executable: deterministic (symlink-ness is stable) and anti-fake-green.
      exec = st !== null && !st.isSymbolicLink() && (st.mode & 0o111) !== 0
    } catch {
      exec = false
    }
    if (exec) withBit++
    else if (firstMissing === null) firstMissing = rel
  }
  if (withBit === matched.length) {
    return {
      verdict: 'Y',
      evidence: { file: glob, detail: `executable across ${matched.length} file(s)` },
    }
  }
  if (withBit === 0) {
    return { verdict: 'N', evidence: { file: firstMissing ?? glob, detail: 'not executable' } }
  }
  return {
    verdict: 'P',
    evidence: { file: firstMissing ?? glob, detail: `executable ${withBit}/${matched.length}` },
  }
}

/**
 * Evaluate a single check against the repo. Thin dispatch over the per-type handlers above; returns
 * { verdict, evidence } where evidence is { file, line?, detail? } for code-verifiable checks, or
 * null for NA/NV. Glob/pair checks (version_consistency, forbidden_pattern, file_stat) dispatch
 * BEFORE the single-file `args.path` resolve, since they own their own path handling.
 */
function evalCheck(check, root, options) {
  const type = check.type
  if (type === 'manual') return { verdict: 'NV', evidence: null }
  const args = check.args || {}
  if (type === 'version_consistency') return evalVersionConsistency(args, root)
  if (type === 'forbidden_pattern') return evalForbiddenPattern(args, root)
  if (type === 'file_stat') return evalFileStat(args, root)

  const abs = safeResolve(root, args.path)
  if (abs === null) {
    // An unresolvable / traversal path is a verified failure, with a detail note.
    return { verdict: 'N', evidence: { file: String(args.path ?? ''), detail: 'invalid path' } }
  }
  const rel = args.path

  if (type === 'file_exists') return evalFileExists(abs, rel)
  if (type === 'file_contains') return evalFileContains(abs, rel, String(args.pattern ?? ''))
  if (type === 'count_matches')
    return evalCountMatches(abs, rel, String(args.pattern ?? ''), Number(args.min ?? 1))
  if (type === 'value') {
    // A value check with a report `format` reads a pre-generated tool report (#1413); without one it
    // keeps the legacy single-line `equals`-contains behavior (back-compat — same verdicts as before).
    return args.format
      ? evalValueReport(abs, rel, check, options || {})
      : evalValue(abs, rel, String(args.equals ?? ''))
  }

  // Unknown check type — treat as not verified (never a silent pass).
  return { verdict: 'N', evidence: { file: rel || '', detail: `unknown check type: ${type}` } }
}

/** True if a check's overlay condition is satisfied (applies_if absent ⇒ always applies). */
function isApplicable(check, overlays) {
  const cond = check.applies_if
  if (!cond || cond === 'always') return true
  return overlays.has(cond)
}

/** Numeric verdict weight: Y=1, P=0.5, N=0; NA/NV excluded from the denominator. */
function verdictPoints(verdict) {
  if (verdict === 'Y') return 1
  if (verdict === 'P') return 0.5
  return 0
}

/**
 * Evaluate the whole registry. Deterministic: checks sorted by id, no timestamps.
 * @returns scored payload: { registryVersion, score, yCount, riskyCount, totals, dimensions, checks }
 */
function evaluateInner(registry, overlays, root, options = {}) {
  const overlaySet = overlays instanceof Set ? overlays : new Set(overlays || [])
  const opts = options && typeof options === 'object' ? options : {}
  // Drop non-object entries (a stray `-`/commented item in a templated YAML list parses to null) so
  // the valid checks are still scored and neither engine throws — shared fail-closed shape with the TS.
  const rawChecks = (Array.isArray(registry?.checks) ? registry.checks : []).filter(
    (c) => c && typeof c === 'object',
  )
  const sorted = [...rawChecks].sort((a, b) => cmpCodeUnit(String(a.id), String(b.id)))

  const checks = []
  const dims = new Map()
  let yCount = 0
  let riskyCount = 0
  let earned = 0
  let possible = 0

  for (const check of sorted) {
    const applicable = isApplicable(check, overlaySet)
    let verdict
    let evidence
    if (!applicable) {
      verdict = 'NA'
      evidence = null
    } else {
      const r = evalCheck(check, root, opts)
      verdict = r.verdict
      evidence = r.evidence
    }

    const weight = Number(check.weight ?? 1)
    const risk = check.risk === 'RISKY' ? 'RISKY' : 'SAFE'
    if (risk === 'RISKY') riskyCount++
    if (verdict === 'Y') yCount++

    // Scoring denominator: applicable, code-verifiable checks only (exclude NA + NV).
    if (verdict !== 'NA' && verdict !== 'NV') {
      earned += verdictPoints(verdict) * weight
      possible += weight
    }

    const dimId = String(check.dimension ?? 'D-UNCLASSIFIED')
    if (!dims.has(dimId)) dims.set(dimId, { earned: 0, possible: 0, y: 0 })
    const d = dims.get(dimId)
    if (verdict === 'Y') d.y++
    if (verdict !== 'NA' && verdict !== 'NV') {
      d.earned += verdictPoints(verdict) * weight
      d.possible += weight
    }

    checks.push({
      id: String(check.id),
      dimension: dimId,
      title: String(check.title ?? ''),
      type: String(check.type ?? ''),
      verdict,
      weight,
      risk,
      anchor: check.anchor ? String(check.anchor) : null,
      evidence,
    })
  }

  const score = possible > 0 ? Math.round((earned / possible) * 1000) / 10 : 0
  const dimensions = {}
  for (const [id, d] of [...dims.entries()].sort((a, b) => cmpCodeUnit(a[0], b[0]))) {
    dimensions[id] = {
      score: d.possible > 0 ? Math.round((d.earned / d.possible) * 1000) / 10 : 0,
      y: d.y,
    }
  }

  return {
    registryVersion: String(registry?.version ?? '0'),
    score,
    yCount,
    riskyCount,
    totals: {
      checks: checks.length,
      y: yCount,
      p: checks.filter((c) => c.verdict === 'P').length,
      n: checks.filter((c) => c.verdict === 'N').length,
      na: checks.filter((c) => c.verdict === 'NA').length,
      nv: checks.filter((c) => c.verdict === 'NV').length,
    },
    dimensions,
    checks,
  }
}

/**
 * Evaluate the whole registry, fail-closed: any uncaught error returns a zero-score payload rather
 * than throwing (byte-identical fail-closed shape to src/conformance/engine.ts — engine-parity).
 */
export function evaluate(registry, overlays, root, options = {}) {
  try {
    return evaluateInner(registry, overlays, root, options)
  } catch {
    return {
      registryVersion: '0',
      score: 0,
      yCount: 0,
      riskyCount: 0,
      totals: { checks: 0, y: 0, p: 0, n: 0, na: 0, nv: 0 },
      dimensions: {},
      checks: [],
    }
  }
}

/** Compare current vs baseline; return { ok, reasons } — ok=false on score/Y regression. */
export function checkNoRegress(current, baseline) {
  const reasons = []
  if (!baseline || typeof baseline !== 'object') return { ok: true, reasons }
  if (typeof baseline.score === 'number' && current.score < baseline.score) {
    reasons.push(`score regressed: ${current.score} < baseline ${baseline.score}`)
  }
  if (typeof baseline.yCount === 'number' && current.yCount < baseline.yCount) {
    reasons.push(`Y-count regressed: ${current.yCount} < baseline ${baseline.yCount}`)
  }
  return { ok: reasons.length === 0, reasons }
}

/** Monotonic ratchet: per field, keep max(current, baseline) — can only tighten. */
export function ratchet(current, baseline) {
  const prev = baseline && typeof baseline === 'object' ? baseline : {}
  const dimensions = {}
  const ids = new Set([
    ...Object.keys(current.dimensions || {}),
    ...Object.keys(prev.dimensions || {}),
  ])
  for (const id of [...ids].sort()) {
    const c = current.dimensions?.[id] || { score: 0, y: 0 }
    const p = prev.dimensions?.[id] || { score: 0, y: 0 }
    dimensions[id] = { score: Math.max(c.score, p.score ?? 0), y: Math.max(c.y, p.y ?? 0) }
  }
  return {
    score: Math.max(current.score, typeof prev.score === 'number' ? prev.score : 0),
    yCount: Math.max(current.yCount, typeof prev.yCount === 'number' ? prev.yCount : 0),
    dimensions,
  }
}

/** Baseline-shaped snapshot of a scored payload (the ratchet-compared subset, no timestamp). */
export function baselineOf(current) {
  return { score: current.score, yCount: current.yCount, dimensions: current.dimensions }
}

// ── #1414: deterministic gold-LEVEL band + "what's missing" gap report ──────────────────────────
//
// The level band maps a code-computed score (0–100) to a Target Maturity Level (L0–L3) keyed by
// the repo's brownfieldClass: a heavy legacy repo reaches a given band at a LOWER score than a
// greenfield gold repo (the realistic target differs by starting condition). Thresholds are the
// minimum score required to ENTER each level; L0 is the floor (always entered).

/** Per-class entry thresholds: [L1, L2, L3] minimum scores. gold = strictest, heavy = most lenient. */
const LEVEL_THRESHOLDS = {
  gold: [50, 75, 95],
  light: [45, 70, 90],
  medium: [40, 60, 85],
  heavy: [30, 50, 75],
}
const LEVELS = ['L0', 'L1', 'L2', 'L3']

/**
 * Map a score to a level band for a brownfieldClass. Pure + deterministic.
 * @returns { level, nextLevel, toNextLevel, brownfieldClass, thresholds }
 */
export function levelBand(score, brownfieldClass) {
  const cls = Object.prototype.hasOwnProperty.call(LEVEL_THRESHOLDS, brownfieldClass)
    ? brownfieldClass
    : 'gold' // unknown class → strictest band (fail-safe, never over-credits)
  const thresholds = LEVEL_THRESHOLDS[cls]
  const s = Number.isFinite(score) ? score : 0
  let idx = 0
  for (let i = 0; i < thresholds.length; i++) if (s >= thresholds[i]) idx = i + 1
  const level = LEVELS[idx]
  const nextLevel = idx < LEVELS.length - 1 ? LEVELS[idx + 1] : null
  const toNextLevel =
    nextLevel === null ? 0 : Math.max(0, Math.round((thresholds[idx] - s) * 10) / 10)
  return { level, nextLevel, toNextLevel, brownfieldClass: cls, thresholds }
}

/**
 * "What's missing" report: the checks with verdict N or P (the actionable gaps), grouped by
 * dimension (family), each with its evidence. Y/NA/NV are excluded — you cannot close an NV (code
 * can't verify it) or an NA (it doesn't apply) by working on it. Deterministic: dimensions sorted
 * by id, checks in the already-stable id order from evaluate().
 * @returns Array<{ dimension, title, checks: Array<{id,title,verdict,evidence,anchor}> }>
 */
export function gapReport(result) {
  const checks = Array.isArray(result?.checks) ? result.checks : []
  const byDim = new Map()
  for (const c of checks) {
    if (c.verdict !== 'N' && c.verdict !== 'P') continue
    const dim = String(c.dimension ?? 'D-UNCLASSIFIED')
    if (!byDim.has(dim)) byDim.set(dim, [])
    byDim.get(dim).push({
      id: c.id,
      title: c.title,
      verdict: c.verdict,
      anchor: c.anchor ?? null,
      evidence: c.evidence ?? null,
    })
  }
  return [...byDim.entries()]
    .sort((a, b) => cmpCodeUnit(a[0], b[0]))
    .map(([dimension, gaps]) => ({ dimension, checks: gaps }))
}

// ── #1473: fail-closed freshness banner (out-of-band, NEVER in the scored payload) ───────────────
//
// A `value` check with an `args.format` reads a PRE-GENERATED tool report; an absent report scores
// NA silently (the tool may not apply OR may simply never have run). freshness() is the out-of-band
// signal that distinguishes those: it stats every value-check report path and reports FRESH/PARTIAL/
// STALE. The wall-clock (mtime / now) lives ONLY here — it never enters evaluate()'s byte-deterministic
// payload — so the scored artifact stays reproducible while the banner stays honest (fail-closed:
// a report that is absent, or older than the window, is never counted as FRESH).

/**
 * Classify the freshness of the value-check report files declared by `registry`. Pure given (now).
 *   FRESH   — every declared report present AND within staleHours (or no reports declared at all)
 *   PARTIAL — at least one report present, but some missing or older than the window
 *   STALE   — reports are declared but NONE are present (the tools never ran)
 * @param {{checks?: unknown[]}} registry
 * @param {string} root
 * @param {{ staleHours?: number, now?: number }} [options]
 * @returns {{ status: 'FRESH'|'PARTIAL'|'STALE', staleHours: number,
 *   counts: { total: number, present: number, fresh: number },
 *   reports: Array<{ path: string, present: boolean, ageHours: number|null, fresh: boolean }> }}
 */
export function freshness(registry, root, options = {}) {
  const staleHours =
    Number.isFinite(options.staleHours) && options.staleHours >= 0 ? options.staleHours : 24
  const now = typeof options.now === 'number' ? options.now : Date.now()
  const checks = Array.isArray(registry?.checks) ? registry.checks : []
  const reports = []
  for (const c of checks) {
    if (!c || typeof c !== 'object') continue
    if (c.type !== 'value') continue
    const args = c.args || {}
    // Only a value check with a report `format` reads a pre-generated tool report; a legacy value
    // check (args.equals, no format) reads a tracked source file and is not a freshness concern.
    if (!args.format) continue
    const p = typeof args.path === 'string' ? args.path : null
    if (p === null) continue
    const abs = safeResolve(root, p)
    let present = false
    let ageHours = null
    if (abs !== null) {
      try {
        const st = statSync(abs)
        if (st.isFile()) {
          present = true
          ageHours = Math.max(0, (now - st.mtimeMs) / (3600 * 1000))
        }
      } catch {
        present = false
      }
    }
    const fresh = present && ageHours !== null && ageHours <= staleHours
    reports.push({ path: p, present, ageHours, fresh })
  }
  // Stable banner order (code-unit), deterministic across runs.
  reports.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const total = reports.length
  const present = reports.filter((r) => r.present).length
  const fresh = reports.filter((r) => r.fresh).length
  let status
  if (total === 0 || fresh === total) status = 'FRESH'
  else if (present === 0) status = 'STALE'
  else status = 'PARTIAL'
  return { status, staleHours, counts: { total, present, fresh }, reports }
}
