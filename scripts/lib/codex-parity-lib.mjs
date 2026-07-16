// SPDX-License-Identifier: Apache-2.0
// scripts/lib/codex-parity-lib.mjs — pure helpers for the codex-track parity
// contract (ADR-106, #1966). No process.exit, no spawns, no repo mutation:
// every function operates on explicit inputs so unit tests can drive each
// check against isolated fixtures (never the live worktree).
//
// Classification model (ADR-106): every file emitted under a track root gets
// exactly ONE class — DERIVED (generated from the canonical Claude source,
// normalized byte-equality required), ALLOWLISTED (intentional divergence,
// pinned by content hashes of both sides), or BY-DESIGN-EXCLUSIVE (declared
// one-track-only surface). Unclassified or multi-classified files are gate
// failures: parity-surface coverage must be 100%.
//
// Consumed by scripts/check-codex-parity.mjs (the gate check) and by
// __tests__/scripts/check-codex-parity.test.ts (unit + mutation fixtures).

import { readdirSync, lstatSync, readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { minimatch } from 'minimatch'

// ─── Parity classes ──────────────────────────────────────────────────────────

export const CLASS_DERIVED = 'DERIVED'
export const CLASS_ALLOWLISTED = 'ALLOWLISTED'
export const CLASS_EXCLUSIVE = 'BY-DESIGN-EXCLUSIVE'

// ─── Track roots (baked-project-relative) ────────────────────────────────────

// Claude track root vs Codex track roots. The parity surface is the union of
// every file found under these directories in a real bake (hardening 2:
// independent denominator — filesystem scan, then reconciled against the
// generated manifest so registry-omitted files become visible, not invisible).
export const TRACK_ROOTS = Object.freeze({
  claude: ['.claude'],
  codex: ['.agents', '.codex'],
})

// ─── Derived pairs (codex file ← canonical claude source) ────────────────────

// The 5 shared rules the Codex track derives from the canonical Claude rule
// templates (ADR-106 derive-from-Claude model). `golden` names the committed,
// independently reviewed oracle under __tests__/fixtures/codex-parity/golden/
// (hardening 6: generator output is compared TO the golden, never
// generated-vs-generated in the same run).
export const DERIVED_PAIRS = Object.freeze(
  [
    '05-agent-lifecycle.md',
    '25-todo-folder-policy.md',
    '50-batch-execution.md',
    '60-incidental-capture.md',
    '90-exec-protocol.md',
  ].map((name) => ({
    codex: `.agents/rules/${name}`,
    claude: `.claude/rules/${name}`,
    golden: `rules/${name}.golden`,
  })),
)

// The CANON-22 heading whose silent loss from the Codex track is the #1966
// motivating incident. Exported so tests target the exact section.
export const CANON22_HEADING = '## Root-Cause Discipline (CANON-22)'

// ─── Small utilities ─────────────────────────────────────────────────────────

/** SHA-256 hex digest of a UTF-8 string. */
export function sha256(text) {
  return createHash('sha256').update(text, 'utf-8').digest('hex')
}

/**
 * Scoped normalization (hardening 5): ONLY named front-matter fields and
 * explicitly supplied interpolation values are normalized. Semantic whitespace
 * (Markdown indent, code fences, YAML) is preserved so a semantic-whitespace
 * divergence stays visible (red), and legitimate prose that merely mentions an
 * agent name is left untouched unless that exact value was passed in
 * `interpolations`.
 *
 * opts.frontMatterFields — field names whose front-matter VALUE is replaced
 *   with the stable token `<normalized>` (default: ['agent']).
 * opts.interpolations — exact strings (generator interpolation values, e.g. a
 *   project name) replaced with `<normalized>` throughout the body.
 */
export function normalizeContent(text, opts = {}) {
  const fields = opts.frontMatterFields ?? ['agent']
  const interpolations = opts.interpolations ?? []
  let out = normalizeFrontMatter(text, fields)
  for (const value of interpolations) {
    if (typeof value === 'string' && value.length > 0) {
      out = out.split(value).join('<normalized>')
    }
  }
  return out
}

function normalizeFrontMatter(text, fields) {
  if (!text.startsWith('---\n')) return text
  const end = text.indexOf('\n---', 4)
  if (end === -1) return text
  const head = text.slice(0, end)
  const tail = text.slice(end)
  const normalizedHead = head
    .split('\n')
    .map((line) => {
      for (const field of fields) {
        if (line.startsWith(`${field}:`)) return `${field}: <normalized>`
      }
      return line
    })
    .join('\n')
  return normalizedHead + tail
}

// ─── Filesystem scan (hardening 16: bake-scan spec) ─────────────────────────

/**
 * Walk the track roots of a baked project directory. Deterministic (sorted),
 * lstat semantics: a symlink is recorded as an entry, its target is never
 * followed. `exclusions` is a list of minimatch patterns (relative posix
 * paths) from the schema-validated exclusion list.
 *
 * Returns { claude: string[], codex: string[] } of baked-dir-relative posix
 * paths.
 */
export function scanTrackRoots(bakedDir, exclusions = []) {
  const result = { claude: [], codex: [] }
  for (const [track, roots] of Object.entries(TRACK_ROOTS)) {
    for (const root of roots) {
      walkDir(bakedDir, root, exclusions, result[track])
    }
    result[track].sort()
  }
  return result
}

function walkDir(baseDir, rel, exclusions, out) {
  const abs = join(baseDir, rel)
  let stat
  try {
    stat = lstatSync(abs)
  } catch {
    return // root absent in this bake — surfaced by baseline/manifest checks
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    if (!isExcluded(rel, exclusions)) out.push(rel)
    return
  }
  for (const entry of readdirSync(abs).sort()) {
    walkDir(baseDir, `${rel}/${entry}`, exclusions, out)
  }
}

function isExcluded(rel, exclusions) {
  return exclusions.some((pattern) => minimatch(rel, pattern, { dot: true }))
}

/** True when `rel` lies under any track root. */
export function isUnderTrackRoots(rel) {
  const roots = [...TRACK_ROOTS.claude, ...TRACK_ROOTS.codex]
  return roots.some((root) => rel === root || rel.startsWith(`${root}/`))
}

// ─── Data-file loading ───────────────────────────────────────────────────────

/** Read+parse a JSON data file; returns undefined when absent. */
export function readJsonIfExists(path) {
  if (!existsSync(path)) return undefined
  return JSON.parse(readFileSync(path, 'utf-8'))
}

// ─── Schema validators (scripts/data/codex-parity-*.json) ───────────────────

const HEX64 = /^[0-9a-f]{64}$/

function isNonEmptyString(x) {
  return typeof x === 'string' && x.length > 0
}

function isStringArray(x) {
  return Array.isArray(x) && x.every((s) => typeof s === 'string')
}

/** Validate the allowlist data file; returns a list of error strings. */
export function validateAllowlist(x) {
  const errors = []
  if (x?.$schemaVersion !== 1) errors.push('allowlist: $schemaVersion must be 1')
  if (!Array.isArray(x?.entries)) return [...errors, 'allowlist: entries must be an array']
  x.entries.forEach((e, i) => {
    if (!isNonEmptyString(e?.codexPath)) errors.push(`allowlist entries[${i}]: codexPath required`)
    if (!isNonEmptyString(e?.claudePath))
      errors.push(`allowlist entries[${i}]: claudePath required`)
    if (!isNonEmptyString(e?.reason) || e.reason.length < 10)
      errors.push(`allowlist entries[${i}]: reason must explain the divergence (>=10 chars)`)
    if (!HEX64.test(e?.codexHash ?? '')) errors.push(`allowlist entries[${i}]: codexHash sha256`)
    if (!HEX64.test(e?.claudeHash ?? '')) errors.push(`allowlist entries[${i}]: claudeHash sha256`)
  })
  return errors
}

/** Validate the exclusive-declarations data file; returns error strings. */
export function validateExclusive(x) {
  const errors = []
  if (x?.$schemaVersion !== 1) errors.push('exclusive: $schemaVersion must be 1')
  if (!Array.isArray(x?.declarations))
    return [...errors, 'exclusive: declarations must be an array']
  x.declarations.forEach((d, i) => {
    if (!isNonEmptyString(d?.id)) errors.push(`exclusive declarations[${i}]: id required`)
    if (d?.track !== 'claude' && d?.track !== 'codex')
      errors.push(`exclusive declarations[${i}]: track must be claude|codex`)
    if (!isNonEmptyString(d?.pattern)) errors.push(`exclusive declarations[${i}]: pattern required`)
    if (!isNonEmptyString(d?.reason) || d.reason.length < 10)
      errors.push(`exclusive declarations[${i}]: reason must explain exclusivity (>=10 chars)`)
  })
  if (!isStringArray(x?.knownLimitationsInfra))
    errors.push('exclusive: knownLimitationsInfra must be a string array')
  if (!isStringArray(x?.scanExclusions))
    errors.push('exclusive: scanExclusions must be a string array')
  return errors
}

/** Validate the baseline data file; returns error strings. */
export function validateBaseline(x) {
  const errors = []
  if (x?.$schemaVersion !== 1) errors.push('baseline: $schemaVersion must be 1')
  for (const track of ['claude', 'codex']) {
    if (!isStringArray(x?.tracks?.[track]?.files))
      errors.push(`baseline: tracks.${track}.files must be a string array`)
  }
  if (!Array.isArray(x?.removals)) return [...errors, 'baseline: removals must be an array']
  x.removals.forEach((r, i) => {
    if (!isNonEmptyString(r?.file)) errors.push(`baseline removals[${i}]: file required`)
    if (!isNonEmptyString(r?.reason) || r.reason.length < 10)
      errors.push(`baseline removals[${i}]: reason must explain the removal (>=10 chars)`)
    if (!isNonEmptyString(r?.issue)) errors.push(`baseline removals[${i}]: issue required (#NNN)`)
  })
  return errors
}

// ─── Classification ──────────────────────────────────────────────────────────

/**
 * Classify every scanned file into exactly one parity class. Multi-class is
 * an error, not a precedence decision (hardening 4); a file matching nothing
 * is unclassified (parity-surface hole — the #1966 bug-class).
 *
 * ctx: { allowlist, exclusive } (validated data-file contents).
 * Returns { classes: Map<file, class>, findings }.
 */
export function classifyFiles(scan, ctx) {
  const findings = []
  const classes = new Map()
  const derivedSet = new Set(DERIVED_PAIRS.flatMap((p) => [p.codex, p.claude]))
  const allowSet = new Set(
    (ctx.allowlist?.entries ?? []).flatMap((e) => [e.codexPath, e.claudePath]),
  )
  const declarations = ctx.exclusive?.declarations ?? []

  for (const file of [...scan.claude, ...scan.codex]) {
    const matches = []
    if (derivedSet.has(file)) matches.push(CLASS_DERIVED)
    if (allowSet.has(file)) matches.push(CLASS_ALLOWLISTED)
    if (declarations.some((d) => minimatch(file, d.pattern, { dot: true }))) {
      matches.push(CLASS_EXCLUSIVE)
    }
    if (matches.length === 1) {
      classes.set(file, matches[0])
    } else if (matches.length === 0) {
      findings.push({
        kind: 'unclassified',
        file,
        message:
          'emitted file has no parity class — classify it as DERIVED, ALLOWLISTED, or add a ' +
          'BY-DESIGN-EXCLUSIVE declaration (scripts/data/codex-parity-exclusive.json)',
      })
    } else {
      findings.push({
        kind: 'multi-class',
        file,
        message: `file matches more than one parity class (${matches.join(', ')}) — no precedence semantics exist; fix the data files`,
      })
    }
  }

  for (const d of declarations) {
    const matched = [...scan.claude, ...scan.codex].some((f) =>
      minimatch(f, d.pattern, { dot: true }),
    )
    if (!matched) {
      findings.push({
        kind: 'stale-exclusive',
        file: d.pattern,
        message: `exclusive declaration "${d.id}" matches no emitted file — remove or fix it`,
      })
    }
  }

  return { classes, findings }
}

// ─── Derived-pair + golden comparison ────────────────────────────────────────

/** First line number (1-based) where two texts differ, for diagnostics. */
function firstDiffLine(a, b) {
  const la = a.split('\n')
  const lb = b.split('\n')
  const n = Math.max(la.length, lb.length)
  for (let i = 0; i < n; i++) {
    if (la[i] !== lb[i]) return i + 1
  }
  return 0
}

/**
 * Compare each DERIVED pair: the baked codex file must equal the baked claude
 * file post-normalization, and the baked claude file must equal the committed
 * golden (non-circular oracle, hardening 6).
 */
export function compareDerivedPairs(bakedDir, ctx) {
  const findings = []
  const normOpts = ctx.normOpts ?? {}
  for (const pair of DERIVED_PAIRS) {
    const codexAbs = join(bakedDir, pair.codex)
    const claudeAbs = join(bakedDir, pair.claude)
    if (!existsSync(codexAbs) || !existsSync(claudeAbs)) {
      findings.push({
        kind: 'derived-drift',
        file: pair.codex,
        message: `derived pair incomplete: ${existsSync(claudeAbs) ? pair.codex : pair.claude} was not emitted`,
      })
      continue
    }
    const codex = normalizeContent(readFileSync(codexAbs, 'utf-8'), normOpts)
    const claude = normalizeContent(readFileSync(claudeAbs, 'utf-8'), normOpts)
    if (codex !== claude) {
      findings.push({
        kind: 'derived-drift',
        file: pair.codex,
        message: `codex derivation diverges from canonical claude source ${pair.claude} (first diff at line ${firstDiffLine(codex, claude)}) — fix the derivation, never hand-edit the codex copy`,
      })
    }
    findings.push(...compareGolden(pair, claude, ctx, normOpts))
  }
  return findings
}

function compareGolden(pair, claudeNormalized, ctx, normOpts) {
  if (ctx.goldensDir === undefined) return []
  const goldenAbs = join(ctx.goldensDir, pair.golden)
  if (!existsSync(goldenAbs)) {
    return [
      {
        kind: 'golden-mismatch',
        file: pair.claude,
        message: `committed golden ${pair.golden} is missing — goldens are the reviewed oracle and must exist`,
      },
    ]
  }
  const golden = normalizeContent(readFileSync(goldenAbs, 'utf-8'), normOpts)
  if (golden !== claudeNormalized) {
    return [
      {
        kind: 'golden-mismatch',
        file: pair.claude,
        message: `generated content diverges from committed golden ${pair.golden} (first diff at line ${firstDiffLine(golden, claudeNormalized)}) — follow the golden evolution protocol (CODEX_PARITY_RUNBOOK.md)`,
      },
    ]
  }
  return []
}

// ─── Manifest reconciliation (hardening 2) ───────────────────────────────────

/**
 * Reconcile the independent filesystem scan against the generated manifest
 * (registry view). A scanned file missing from the manifest means a generator
 * escaped the registry (invisible emission); a manifest entry missing from
 * the scan means a registered file was not actually emitted.
 */
export function reconcileScanWithManifest(scan, manifestFiles, exclusions = []) {
  const findings = []
  const scanned = new Set([...scan.claude, ...scan.codex])
  const manifest = new Set(
    manifestFiles.filter((f) => isUnderTrackRoots(f) && !isExcluded(f, exclusions)),
  )
  for (const f of scanned) {
    if (!manifest.has(f)) {
      findings.push({
        kind: 'manifest-extra',
        file: f,
        message: 'file exists under a track root but is absent from the generated manifest',
      })
    }
  }
  for (const f of manifest) {
    if (!scanned.has(f)) {
      findings.push({
        kind: 'manifest-missing',
        file: f,
        message: 'generated manifest lists this file but the bake scan did not find it',
      })
    }
  }
  return findings
}

// ─── Allowlist currency (staleness = red) ────────────────────────────────────

/**
 * Every allowlist entry must pin a divergence that STILL exists exactly as
 * approved: both sides present, still different, and both content hashes
 * matching the pins. Healed, missing, or drifted entries are findings.
 */
export function checkAllowlistEntries(bakedDir, allowlist, normOpts = {}) {
  const findings = []
  for (const entry of allowlist?.entries ?? []) {
    const codexAbs = join(bakedDir, entry.codexPath)
    const claudeAbs = join(bakedDir, entry.claudePath)
    if (!existsSync(codexAbs) || !existsSync(claudeAbs)) {
      findings.push({
        kind: 'stale-allowlist',
        file: entry.codexPath,
        message: 'allowlist entry references a file the bake no longer emits — remove the entry',
      })
      continue
    }
    const codex = normalizeContent(readFileSync(codexAbs, 'utf-8'), normOpts)
    const claude = normalizeContent(readFileSync(claudeAbs, 'utf-8'), normOpts)
    if (codex === claude) {
      findings.push({
        kind: 'stale-allowlist',
        file: entry.codexPath,
        message:
          'allowlisted divergence has healed (sides are now equal) — remove the entry or it ' +
          'suppresses future drift',
      })
      continue
    }
    if (sha256(codex) !== entry.codexHash || sha256(claude) !== entry.claudeHash) {
      findings.push({
        kind: 'allowlist-hash-mismatch',
        file: entry.codexPath,
        message:
          'divergence drifted beyond the approved pin — re-review and re-pin both hashes ' +
          'or fix the derivation',
      })
    }
  }
  return findings
}

// ─── Known Limitations table ↔ hook inventory (hardening 8) ─────────────────

/** Extract hook names from the generated Known Limitations table. */
export function parseKnownLimitationsHooks(codexMdText) {
  const start = codexMdText.indexOf('## Known Limitations')
  if (start === -1) return null
  const rest = codexMdText.slice(start)
  const nextHeading = rest.indexOf('\n## ', 1)
  const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading)
  const names = []
  for (const line of section.split('\n')) {
    const m = line.match(/^\| `([^`]+)` \|/)
    if (m) names.push(m[1])
  }
  return names
}

/**
 * The generated CODEX.md table must list EXACTLY the baked .claude/hooks/
 * inventory minus declared infra files: a missing row hides a governance gap,
 * a stale row documents a hook that no longer exists.
 */
export function checkKnownLimitations(codexMdText, scannedHookBasenames, infra) {
  const table = parseKnownLimitationsHooks(codexMdText)
  if (table === null) {
    return [
      {
        kind: 'known-limitations-missing',
        file: '.agents/CODEX.md',
        message: 'CODEX.md has no "Known Limitations" section — the generated table is mandatory',
      },
    ]
  }
  const findings = []
  const infraSet = new Set(infra ?? [])
  const tableSet = new Set(table)
  for (const hook of scannedHookBasenames) {
    if (!infraSet.has(hook) && !tableSet.has(hook)) {
      findings.push({
        kind: 'known-limitations-missing',
        file: '.agents/CODEX.md',
        message: `emitted Claude hook "${hook}" has no Known Limitations row (undisclosed gap — the #1966 bug-class)`,
      })
    }
  }
  const scannedSet = new Set(scannedHookBasenames)
  for (const hook of table) {
    if (!scannedSet.has(hook)) {
      findings.push({
        kind: 'known-limitations-stale',
        file: '.agents/CODEX.md',
        message: `Known Limitations row "${hook}" names a hook the bake did not emit (stale documentation)`,
      })
    }
  }
  return findings
}

// ─── Baseline: identity + anti-shrinkage (hardening 3 + 14) ─────────────────

/**
 * Nonzero totals (hardening 3) — active in BOTH modes: a vacuous surface is
 * never a pass, repo context or not.
 */
export function checkNonzeroTracks(scan) {
  const findings = []
  for (const track of ['claude', 'codex']) {
    if (scan[track].length === 0) {
      findings.push({
        kind: 'empty-track',
        file: TRACK_ROOTS[track].join(','),
        message: `${track} track scan found 0 files — a vacuous parity surface is a failure, not a pass`,
      })
    }
  }
  return findings
}

/**
 * Nonzero totals; committed-baseline identity (any change requires an
 * explicit --update-baseline commit); anti-shrinkage against the baseline AT
 * MERGE-BASE (git show, not working tree — reducing output and baseline in
 * the same change stays red unless a reviewed removal record exists).
 * `mergeBaseBaseline` is the parsed merge-base copy, or 'BOOTSTRAP' when the
 * file did not exist at merge-base.
 *
 * REPO-MODE ONLY: the baseline ratchet is defined against the arbiter repo's
 * own history (merge-base with origin/main). In fixture mode
 * (runParityCheck with skipBaseline — a pre-baked tree outside any repo
 * context) the orchestrator skips this sub-check EXPLICITLY and loudly;
 * the real gate path keeps it fail-closed.
 */
export function checkBaseline(scan, committedBaseline, mergeBaseBaseline) {
  const findings = checkNonzeroTracks(scan)
  findings.push(...baselineIdentity(scan, committedBaseline))
  if (mergeBaseBaseline !== 'BOOTSTRAP') {
    findings.push(...baselineShrinkage(scan, committedBaseline, mergeBaseBaseline))
  }
  return findings
}

function baselineIdentity(scan, committedBaseline) {
  const findings = []
  for (const track of ['claude', 'codex']) {
    const current = new Set(scan[track])
    const pinned = new Set(committedBaseline?.tracks?.[track]?.files ?? [])
    const added = [...current].filter((f) => !pinned.has(f))
    const removed = [...pinned].filter((f) => !current.has(f))
    if (added.length > 0 || removed.length > 0) {
      findings.push({
        kind: 'baseline-drift',
        file: TRACK_ROOTS[track].join(','),
        message:
          `${track} track emission differs from the committed baseline ` +
          `(+${added.length}: ${added.slice(0, 5).join(', ') || '-'}; ` +
          `-${removed.length}: ${removed.slice(0, 5).join(', ') || '-'}) — review, then ` +
          `node scripts/check-codex-parity.mjs --update-baseline`,
      })
    }
  }
  return findings
}

function baselineShrinkage(scan, committedBaseline, mergeBaseBaseline) {
  const findings = []
  const removalSet = new Set((committedBaseline?.removals ?? []).map((r) => r.file))
  for (const track of ['claude', 'codex']) {
    const current = new Set(scan[track])
    for (const f of mergeBaseBaseline?.tracks?.[track]?.files ?? []) {
      if (!current.has(f) && !removalSet.has(f)) {
        findings.push({
          kind: 'baseline-removed',
          file: f,
          message:
            'file present in the merge-base baseline is no longer emitted and has no reviewed ' +
            'removal record (baseline.removals[{file, reason, issue}]) — unexplained shrinkage',
        })
      }
    }
  }
  return findings
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

function validateDataFiles(opts) {
  const errors = [...validateAllowlist(opts.allowlist), ...validateExclusive(opts.exclusive)]
  // In fixture mode no baseline comparison happens, and none is required.
  if (opts.skipBaseline !== true) errors.push(...validateBaseline(opts.baseline))
  return errors.map((message) => ({ kind: 'schema', file: 'scripts/data', message }))
}

/**
 * Run the full parity check over a baked project directory.
 *
 * opts:
 *   bakedDir            — baked fixture project root (required)
 *   manifestFiles       — baked-dir-relative paths from the generated manifest
 *   allowlist/exclusive/baseline — parsed data-file contents
 *   mergeBaseBaseline   — baseline JSON as of merge-base, or 'BOOTSTRAP'
 *   skipBaseline        — fixture mode: skip the repo-history baseline
 *                         sub-check EXPLICITLY (identity + shrinkage); the
 *                         nonzero-track non-vacuity check still runs. The
 *                         repo-mode gate never sets this.
 *   goldensDir          — committed golden fixtures root
 *   exclusions          — extra scan-exclusion patterns (tests)
 *   normOpts            — normalizeContent options
 *
 * Returns { status: 'PASS'|'FAIL', findings: [{kind, file, message}],
 *           surface: { total, classified }, baseline: 'checked'|'skipped' }.
 */
export function runParityCheck(opts) {
  const findings = validateDataFiles(opts)
  const exclusions = [...(opts.exclusive?.scanExclusions ?? []), ...(opts.exclusions ?? [])]
  const scan = scanTrackRoots(opts.bakedDir, exclusions)
  const normOpts = opts.normOpts ?? {}

  const { classes, findings: classFindings } = classifyFiles(scan, opts)
  findings.push(...classFindings)
  findings.push(
    ...compareDerivedPairs(opts.bakedDir, { goldensDir: opts.goldensDir, normOpts }),
    ...reconcileScanWithManifest(scan, opts.manifestFiles ?? [], exclusions),
    ...checkAllowlistEntries(opts.bakedDir, opts.allowlist, normOpts),
  )
  const baselineMode = opts.skipBaseline === true ? 'skipped' : 'checked'
  if (baselineMode === 'skipped') {
    findings.push(...checkNonzeroTracks(scan))
  } else {
    findings.push(...checkBaseline(scan, opts.baseline, opts.mergeBaseBaseline))
  }

  const codexMdAbs = join(opts.bakedDir, '.agents', 'CODEX.md')
  const hookBasenames = scan.claude
    .filter((f) => f.startsWith('.claude/hooks/') && f.endsWith('.mjs'))
    .map((f) => f.slice('.claude/hooks/'.length))
    .filter((f) => !f.includes('/'))
  const codexMdText = existsSync(codexMdAbs) ? readFileSync(codexMdAbs, 'utf-8') : ''
  findings.push(
    ...checkKnownLimitations(
      codexMdText,
      hookBasenames,
      opts.exclusive?.knownLimitationsInfra ?? [],
    ),
  )

  const total = scan.claude.length + scan.codex.length
  return {
    status: findings.length === 0 ? 'PASS' : 'FAIL',
    findings,
    surface: { total, classified: classes.size },
    baseline: baselineMode,
  }
}
