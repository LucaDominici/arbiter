#!/usr/bin/env node
// INV-52: Every enforcement script cited in catalog must be wired in check-all.mjs (CANON-09).
// #2563: every catalog `enforcement` string must resolve to a real mechanism — either a
// file-ish token (.mjs/.ts/.java/.yml/.yaml) that exists on disk, or an explicit per-ID
// allowlist entry (mechanism + reason) for the genuinely non-file cases (policy/manual/
// per-language CI toolchains). An entry that names neither is a fictional enforcement
// claim (AC-1/AC-2).
// Usage: node scripts/check-inv-enforcement-wired.mjs [--catalog=path] [--gate=path]
//                                                     [--generators=dir] [--allowlist=path]
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const catalogArg = args.find((a) => a.startsWith('--catalog='))
const gateArg = args.find((a) => a.startsWith('--gate='))
const generatorsArg = args.find((a) => a.startsWith('--generators='))
const allowlistArg = args.find((a) => a.startsWith('--allowlist='))

const root = process.cwd()
const catalogPath = catalogArg
  ? resolve(catalogArg.split('=')[1])
  : resolve(root, 'src/invariants/catalog.ts')
const gatePath = gateArg ? resolve(gateArg.split('=')[1]) : resolve(root, 'scripts/check-all.mjs')
const generatorsPath = generatorsArg
  ? resolve(generatorsArg.split('=')[1])
  : resolve(root, 'src/generators')
const allowlistPath = allowlistArg
  ? resolve(allowlistArg.split('=')[1])
  : resolve(root, 'scripts/data/enforcement-non-file-allowlist.json')

/**
 * Read an input the wiring verdict depends on. #2418: these two reads ran bare — an
 * unreadable catalog or gate file crashed with a raw stack under node's generic exit code
 * instead of the INV-53 invocation code.
 */
function readOrDie(path, what) {
  try {
    return readFileSync(path, 'utf-8')
  } catch (err) {
    process.stderr.write(
      `[check-inv-enforcement-wired] ERROR: cannot read ${what} at ${path}: ${err?.message ?? err}\n`,
    )
    process.exit(2)
  }
}

const catalogSrc = readOrDie(catalogPath, 'the invariant catalog')
const gateSrc = readOrDie(gatePath, 'the gate file')

// Track-B scripts: generated into governed target projects, NOT run as arbiter self-gates.
// Citing them in catalog enforcement fields is correct documentation; their absence from
// arbiter's own check-all.mjs is expected and is not a violation.
// #2278: "generated for target projects" is a CLAIM, and every entry below is now
// VERIFIED against src/generators/ by the emission pass at the bottom of this file.
// It was unverified until evidence-collect.mjs turned out to be emitted by nobody
// while INV-33 cited it as enforcement — a promise nothing kept, invisible precisely
// BECAUSE the exemption suppressed it.
const TRACK_B_EXEMPT = new Set([
  'verify-i18n-parity.mjs', // INV-106: emitted by frontend generator for FE target projects
  'i18n-literal-scanner.mjs', // INV-106: emitted by frontend generator for FE target projects
  'verify-tokens.mjs', // INV-105: emitted by frontend generator for FE target projects
  'verify-spotbugs.mjs', // INV-44: emitted by Java template for Java target projects
  'debt-lib.mjs', // INV-109: shared library helper, not a standalone gate step
  'done-evidence.mjs', // INV-38: generated evidence-capture CLI for target projects (.ejs)
  'evidence-collect.mjs', // INV-33: generated nightly-pipeline harness for target projects
  'check-stack-conformity.mjs', // INV-121: emitted by check-stack-conformity.ts for target projects (#1312)
  'check-e2e-quarantine.mjs', // INV-130: emitted E2E reliability quarantine gate for target projects (#1445)
  'check-tdd-evidence.mjs', // INV-131: emitted TDD-evidence re-verification gate for target projects (#1446)
  'verify-module-coverage.mjs', // INV-134: emitted per-module coverage ratchet (advisory) for target projects (#1457)
  // Track-B workflow/FE gates: generated from src/templates/scripts/*.mjs.ejs into target
  // projects, never run as arbiter self-gates. Newly subtracted (#1664) because the
  // position-agnostic check-* existence pass below would otherwise flag them.
  'check-fe-boundaries.mjs', // INV-102..104: emitted by the check-all generator for FE target projects (#1127)
  'check-workflow-perms.mjs', // INV-77: emitted workflow least-privilege gate for target projects
  'check-workflow-job-naming.mjs', // INV-89: Track-B-only workflow job-naming gate for target projects
  'check-workflow-sha-pinning.mjs', // INV-89: Track-B-only workflow SHA-pinning gate for target projects
])

// A citation naming a file-ish token that genuinely lives outside this repo cannot be
// resolved by existsSync no matter how many roots are searched — each entry here is
// individually verified against the catalog prose that names its true home (#2563).
const FOREIGN_PATH_EXEMPT = new Set([
  // INV-143: forma's own mirror of the arbiter<->forma schema contract gate, run in
  // forma's CI, not this repo — the catalog text says so explicitly ("in its own CI").
  'check-arbiter-contract.mjs',
])

// Generator-authored output paths: files a generator WRITES into a governed target project
// at that exact relative path, verified against a literal `resolvedPath(...)` call in the
// named generator — never present as a static template or in arbiter's own tree, so no
// existsSync search can ever find them. Full-token exact match only (#2563).
const TARGET_OUTPUT_PATH_EXEMPT = new Set([
  // INV-137: verified — resolvedPath(base, 'tests', 'smoke', 'smoke-journeys.spec.ts') in
  // src/generators/smoke-journeys.ts:122.
  'tests/smoke/smoke-journeys.spec.ts',
  // INV-61: verified — resolvedPath(base, 'tests', 'e2e', 'a11y', 'run-axe.ts') in
  // src/generators/playwright-ts.ts:42.
  'tests/e2e/a11y/run-axe.ts',
  // INV-126: verified — resolvedPath(base, 'tests', 'api', 'run.sh') in
  // src/generators/api-e2e.ts:147.
  'tests/api/run.sh',
  // INV-60: the real generated filename is docs/coverage/Cargo.toml.profile.release
  // (verified: resolvedPath(base, 'docs', 'coverage', 'Cargo.toml.profile.release') in
  // src/generators/coverage.ts:190) — a double extension FILE_TOKEN_RE cannot see past
  // the first recognised one, so the citation extracts truncated at the `.toml` boundary.
  'docs/coverage/Cargo.toml',
])

// Target-twin documentation paths: arbiter dogfoods each of these under docs/internal/
// (its own SSOT location, per .dogfood-divergences.json), while every GOVERNED TARGET
// gets the bare docs/ path named here. Both twins carry the identical rule; only the path
// differs, by deliberate divergence. The bare form can never exist in arbiter's own tree
// by construction — verified against each catalog entry's own "docs/internal/..." twin
// mention in the same enforcement/description text (#2563).
const TARGET_DOC_TWIN_EXEMPT = new Set([
  'docs/MILESTONES.md', // INV-146 — self twin: docs/internal/PRODUCT/MILESTONES.md
  'docs/SOURCES.md', // INV-146/147 — self twin: docs/internal/PRODUCT/SOURCES.md
  'docs/USE_CASES.md', // INV-146/149 — self twin: docs/internal/PRODUCT/USE_CASES.md
  'docs/FEATURE_MATRIX.md', // INV-149 — self twin: docs/internal/PRODUCT/FEATURE_MATRIX.md
  'docs/TABLETOP-SCENARIOS.md', // INV-149 — self twin: docs/internal/PRODUCT/TABLETOP-SCENARIOS.md
])

// Runtime artifacts: files a script READS or WRITES at run time (evidence, coverage,
// manifests, markers) that are never checked in and so never exist in a fresh checkout —
// each verified against a literal reference in the producing/consuming script named beside
// it. Full-token exact match only (#2563).
const RUNTIME_ARTIFACT_EXEMPT = new Set([
  '.evidence/SUMMARY.json', // INV-33 — verified: src/generators/check-all.ts:724 (producer)
  'status.json', // INV-113 — verified: .claude/.task/status.json, runtime task-phase file
  '/refutation-required.json', // INV-145 — verified: scripts/check-refutation-verdicts.mjs:37 MARKER_NAME
  'coverage/coverage-summary.json', // INV-134 — verified: scripts/check-all.mjs:614, scripts/check-coverage-ratchet.mjs
  'module-coverage-baseline.json', // INV-134 — verified: src/templates/scripts/verify-module-coverage.mjs.ejs baseline file
])

// Match scripts/<name>.mjs — broadened to all prefix patterns and digits.
// Negative lookahead (?!\.ejs) prevents matching the .mjs part inside .mjs.ejs template refs.
const scriptRefs = [...catalogSrc.matchAll(/scripts\/([a-z][a-z0-9-]+\.mjs)(?!\.ejs)/g)].map(
  (m) => m[1],
)
const uniqueScripts = [...new Set(scriptRefs)].filter(
  (s) => s !== 'check-all.mjs' && !TRACK_B_EXEMPT.has(s),
)

let violations = 0
for (const script of uniqueScripts) {
  if (!gateSrc.includes(script)) {
    process.stdout.write(`  MISSING from check-all.mjs: ${script}\n`)
    violations++
  }
}

// #1153: close the blind spot for hook-style enforcement citations. The catalog
// also cites enforcement as bare parenthesised filenames — e.g. `hook
// (check-no-orphan-todo.mjs)` — which carry no `scripts/` prefix and so were
// invisible to the wiring check above. These run via .claude hooks, not
// check-all.mjs, so the correct validation is existence: a citation to a script
// that does not exist as a hook (or script) is fiction enforcement.
const hookRefs = [...catalogSrc.matchAll(/\(([a-z][a-z0-9-]+\.mjs)\)(?!\.ejs)/g)].map((m) => m[1])
const uniqueHooks = [...new Set(hookRefs)].filter(
  (s) => !uniqueScripts.includes(s) && s !== 'check-all.mjs' && !TRACK_B_EXEMPT.has(s),
)
for (const hook of uniqueHooks) {
  const existsAsHook = existsSync(resolve(root, '.claude/hooks', hook))
  const existsAsScript = existsSync(resolve(root, 'scripts', hook))
  if (!existsAsHook && !existsAsScript) {
    process.stdout.write(`  CITED hook does not exist (.claude/hooks/ or scripts/): ${hook}\n`)
    violations++
  }
}

// #1664: close the inverse-citation blind spot. Hooks are also cited with the
// filename OUTSIDE the parens, the parens carrying trigger context — e.g.
// `Claude hook: check-no-pii.mjs (PostToolUse, Edit|Write)`. Such a citation has
// no `scripts/` prefix and no parenthesised filename, so it escaped BOTH passes
// above; a future typo or deleted hook in this already-in-use style would pass
// undetected. Scan position-agnostic for every cited gate-style `check-*.mjs`
// (case-insensitive — names are conventionally lowercase, but fold case so an
// uppercase typo cannot slip through), subtract the names already validated by
// the wiring/paren passes plus the always-present check-all.mjs and the Track-B
// generated gates, then assert each remaining name exists as a hook or script.
const checkRefs = [...catalogSrc.matchAll(/(check-[a-z0-9-]+\.mjs)(?!\.ejs)/gi)].map((m) =>
  m[1].toLowerCase(),
)
const uniqueChecks = [...new Set(checkRefs)].filter(
  (s) =>
    !uniqueScripts.includes(s) &&
    !uniqueHooks.includes(s) &&
    s !== 'check-all.mjs' &&
    !TRACK_B_EXEMPT.has(s) &&
    !FOREIGN_PATH_EXEMPT.has(s),
)
for (const name of uniqueChecks) {
  const existsAsHook = existsSync(resolve(root, '.claude/hooks', name))
  const existsAsScript = existsSync(resolve(root, 'scripts', name))
  if (!existsAsHook && !existsAsScript) {
    process.stdout.write(`  CITED hook does not exist (.claude/hooks/ or scripts/): ${name}\n`)
    violations++
  }
}

// #2278: an exemption is only legitimate while a generator really emits the script.
// Verify each claim against src/generators/: the name must appear as an EXACT quoted
// literal, either the renderTemplate path `scripts/<name>.ejs` or the bare `<name>`
// used by the name-list emission loops. Exact-literal, never substring — a prose
// mention in a comment is the same unverified assertion this pass exists to kill.
function emissionLiterals(dir) {
  let entries
  // #2418: an unreadable generators dir used to return an EMPTY literal set, which reads
  // as "no exemption is emitted by anything" — the right verdict for the wrong reason, and
  // indistinguishable from a genuine emission gap. Name the real fault instead.
  try {
    entries = readdirSync(dir)
  } catch (err) {
    process.stderr.write(
      `[check-inv-enforcement-wired] ERROR: cannot list the generators dir ${dir}: ${err?.message ?? err}\n`,
    )
    process.exit(2)
  }
  const literals = new Set()
  for (const file of entries) {
    if (!file.endsWith('.ts')) continue
    let src
    try {
      src = readFileSync(join(dir, file), 'utf-8')
    } catch (err) {
      // A generator that cannot be read may be the very one emitting an exempted script:
      // skipping it silently turned a read fault into a phantom emission gap.
      process.stderr.write(
        `[check-inv-enforcement-wired] ERROR: cannot read generator ${file}: ${err?.message ?? err}\n`,
      )
      process.exit(2)
    }
    for (const m of src.matchAll(/(['"`])([^'"`\n]*)\1/g)) literals.add(m[2])
  }
  return literals
}

const literals = emissionLiterals(generatorsPath)
for (const name of TRACK_B_EXEMPT) {
  if (literals.has(name) || literals.has(`scripts/${name}.ejs`)) continue
  process.stdout.write(`  EXEMPT but emitted by no generator: ${name}\n`)
  violations++
}

// #2563: resolve EVERY enforcement string, not just the .mjs-shaped citations the passes
// above already cover. Split the catalog into per-id spans (same id-to-next-id scan the
// retired-tombstone pass in check-catalog-agents-parity.mjs uses) so a violation can be
// attributed to its INV id.
// A single quoted-literal alternative, generalised to '/"/` so an id or enforcement value
// written with any quote style is recognised — a double-quoted `id: "INV-999"` used to be
// completely invisible to this scan (single-quote-only), which silently skipped the WHOLE
// entry rather than flagging it [Codex review, P1 #3].
const QUOTED_LITERAL = `(?:'[^']*'|"[^"]*"|` + '`[^`]*`)'
const idSpanRe = new RegExp(`id:\\s*(${QUOTED_LITERAL})`, 'g')
/** Unwrap the OUTER quote characters from a single matched quoted-literal source snippet. */
function unquote(raw) {
  return raw.slice(1, -1)
}
const idMarks = []
{
  let m
  while ((m = idSpanRe.exec(catalogSrc)) !== null) {
    const value = unquote(m[1])
    if (/^INV-\d+$/.test(value)) idMarks.push({ id: value, at: m.index })
  }
}
const enforcementById = new Map()
for (let i = 0; i < idMarks.length; i++) {
  const start = idMarks[i].at
  const end = i + 1 < idMarks.length ? idMarks[i + 1].at : catalogSrc.length
  const span = catalogSrc.slice(start, end)
  // enforcement value may be a single quoted literal (any quote style) or several
  // concatenated with `+` (string-literal continuation), matching the multi-line style
  // used across the catalog. Matches an explicitly EMPTY literal ('') too — that is a
  // distinct, flaggable case from the field being absent entirely (see the resolution
  // loop below), not silently treated the same.
  const em = span.match(
    new RegExp(
      `enforcement:\\s*\\n?\\s*(${QUOTED_LITERAL}(?:\\s*\\+\\s*\\n?\\s*${QUOTED_LITERAL})*)`,
    ),
  )
  if (!em) continue // field genuinely absent from this entry — legitimately optional
  const text = [...em[1].matchAll(new RegExp(QUOTED_LITERAL, 'g'))]
    .map((mm) => unquote(mm[0]))
    .join('')
  enforcementById.set(idMarks[i].id, text)
}

// Every basename under src/templates/** (any depth) — a citation may name a template's
// bare filename (with or without the trailing .ejs) rather than its full path.
function walkFiles(dir) {
  let out = []
  let items
  try {
    items = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const it of items) {
    const p = join(dir, it.name)
    if (it.isDirectory()) out = out.concat(walkFiles(p))
    else out.push(it.name)
  }
  return out
}
const templateBasenames = new Set(walkFiles(resolve(root, 'src/templates')))
const BARE_LOOKUP_DIRS = [
  '.', // repo root — e.g. package.json, .jscpd.json, .dogfood-divergences.json
  'scripts',
  '.claude/hooks',
  '.githooks',
  'src/generators',
  '.github/workflows',
]

/** True when `token` (a file-ish citation extracted from an enforcement string) resolves
 * to a real path: a repo-relative path if it contains a `/`, otherwise a bare filename
 * looked up across the gate/hook/workflow directories or the template tree.
 * #2563 [Codex review, P1 #2]: a token containing `/` is a PATH and must resolve as the
 * exact path cited — there is no basename fallback for it. Falling back to a basename
 * match for a slash-containing token let a fabricated path (`fake/check-secret-scan.mjs`)
 * pass by riding on the real `check-secret-scan.mjs` living somewhere else entirely; the
 * bare-name lookup below stays basename-scoped ONLY for tokens that were cited bare (no
 * `/` in the citation at all), which is the legitimate case (e.g. a hook cited as
 * `check-foo.mjs` without its directory). */
/** A `scripts/<name>` citation of a name already in TRACK_B_EXEMPT is a Track-B script:
 * generated INTO a governed target's scripts/ directory at that exact path, so it never
 * exists at `scripts/<name>` in arbiter's own tree — only its `.ejs` template does. This
 * is not a basename fallback (Codex P1 #2): it's exact-path-shaped (`scripts/` prefix
 * required) and gated on the SAME emission proof (`literals`) the TRACK_B_EXEMPT pass
 * below already independently verifies, so a fabricated `scripts/whatever.mjs` cannot
 * ride through by picking a name off this list. */
function resolvesAsTrackBScriptPath(token) {
  const m = /^scripts\/([a-z][a-z0-9-]+\.mjs)$/.exec(token)
  return Boolean(
    m && TRACK_B_EXEMPT.has(m[1]) && (literals.has(m[1]) || literals.has(`scripts/${m[1]}.ejs`)),
  )
}

/** A bare (no `/`) token, looked up across the gate/hook/workflow directories or the
 * template tree. */
function bareTokenResolves(token) {
  for (const dir of BARE_LOOKUP_DIRS) {
    if (existsSync(resolve(root, dir, token))) return true
  }
  return templateBasenames.has(token) || templateBasenames.has(`${token}.ejs`)
}

function tokenResolves(token) {
  if (!token.includes('/')) return bareTokenResolves(token)
  // The negative lookahead in FILE_TOKEN_RE strips a trailing `.ejs` (e.g. a citation of
  // `src/templates/scripts/check-foo.mjs.ejs` extracts as `.../check-foo.mjs`) — try both
  // the bare path and its `.ejs` twin so a real template isn't reported as missing.
  if (existsSync(resolve(root, token)) || existsSync(resolve(root, `${token}.ejs`))) return true
  return resolvesAsTrackBScriptPath(token)
}

// Broadened extension set [Codex review, P1 #4] — the original 5 extensions missed real
// citation styles (.json manifests, .sh scripts, .md docs, .ejs templates, .toml configs).
// Deliberately NOT "any token containing a slash": this catalog's prose is full of
// slash-joined word pairs with no path meaning at all (CI/CD, and/or, pass/fail,
// CANON-01/04, absent/empty, ...) — a blanket slash detector would misfire on dozens of
// real entries. Anchoring on a recognised extension keeps recall high without that
// false-positive explosion; verified empirically against the full catalog (#2563).
const FILE_TOKEN_RE =
  /[A-Za-z0-9_.\-/]+\.(?:mjs|cjs|ts|mts|cts|tsx|jsx|java|yml|yaml|json|sh|md|ejs|toml)\b/g
// .githooks/<name> entries (pre-commit, pre-push, commit-msg, ...) carry no extension at
// all, so FILE_TOKEN_RE never sees them — a separate, narrower pattern for that one
// directory (#2563).
const GITHOOKS_TOKEN_RE = /\.githooks\/[a-z][a-z-]*/g

function extractFileTokens(text) {
  return [
    ...new Set([
      ...[...text.matchAll(FILE_TOKEN_RE)].map((m) => m[0]),
      ...[...text.matchAll(GITHOOKS_TOKEN_RE)].map((m) => m[0]),
    ]),
  ]
}

// Malformed allowlist JSON is an invocation fault (fail-closed, mirrors readOrDie above) —
// an unreadable/unparsable allowlist must not silently degrade into "nothing is allowlisted"
// (which would false-fail every legitimately-vague entry) nor "everything passes".
let nonFileAllowlist = {}
if (existsSync(allowlistPath)) {
  try {
    nonFileAllowlist = JSON.parse(readFileSync(allowlistPath, 'utf-8'))
  } catch (err) {
    process.stderr.write(
      `[check-inv-enforcement-wired] ERROR: ${allowlistPath} exists but is unreadable/malformed: ${err?.message ?? err}\n`,
    )
    process.exit(2)
  }
}

let allowlistedCount = 0
for (const [id, enforcement] of enforcementById) {
  // An explicitly EMPTY enforcement literal (`enforcement: ''`) is a distinct, flaggable
  // defect from the field being absent — the field being DECLARED with nothing in it reads
  // as documented enforcement to anyone scanning the catalog, and resolves to nothing
  // [Codex review, P1 #3].
  if (enforcement === '') {
    process.stdout.write(`  ENFORCEMENT FIELD IS EMPTY: ${id}\n`)
    violations++
    continue
  }
  const tokens = extractFileTokens(enforcement)
  if (tokens.length === 0) {
    // No file-ish token at all: the claim must be an explicit, reasoned allowlist entry,
    // BOUND to the exact enforcement text it was written against — a bare "contains
    // CI/policy/review" match would re-green the exact INV-28 defect this gate exists to
    // catch, and an allowlist entry whose bound text has drifted from the current catalog
    // wording is stale: the catalog changed after the entry was reviewed and must be
    // re-reviewed, not silently trusted [Codex review, P1 #1].
    const entry = nonFileAllowlist[id]
    if (!entry || !entry.mechanism || !entry.reason || !entry.enforcement) {
      process.stdout.write(
        `  ENFORCEMENT NAMES NO MECHANISM (not allowlisted): ${id} — "${enforcement}"\n`,
      )
      violations++
    } else if (entry.enforcement !== enforcement) {
      process.stdout.write(
        `  STALE ALLOWLIST ENTRY: ${id} — allowlisted text no longer matches the catalog\n` +
          `    allowlist: "${entry.enforcement}"\n` +
          `    catalog:   "${enforcement}"\n`,
      )
      violations++
    } else {
      allowlistedCount++
    }
    continue
  }
  for (const token of tokens) {
    // #2563 [Codex review, P1 #2]: exemptions are keyed by the EXACT cited token, never by
    // basename — `FOREIGN_PATH_EXEMPT.has(base)` would let a fabricated path ending in an
    // exempted basename (e.g. `fake/check-arbiter-contract.mjs`) ride through unexamined.
    if (
      FOREIGN_PATH_EXEMPT.has(token) ||
      TARGET_OUTPUT_PATH_EXEMPT.has(token) ||
      TARGET_DOC_TWIN_EXEMPT.has(token) ||
      RUNTIME_ARTIFACT_EXEMPT.has(token)
    )
      continue
    if (!tokenResolves(token)) {
      process.stdout.write(`  ENFORCEMENT PATH NOT FOUND: ${id} cites "${token}"\n`)
      violations++
    }
  }
}

if (violations > 0) {
  process.stdout.write(
    `[check-inv-enforcement-wired] FAIL: ${violations} enforcement script(s) not wired/found\n`,
  )
  process.exit(1)
}
process.stdout.write(
  `[check-inv-enforcement-wired] OK — ${uniqueScripts.length} gate scripts wired, ` +
    `${uniqueHooks.length} paren-cited + ${uniqueChecks.length} bare check-* hook citations verified, ` +
    `${TRACK_B_EXEMPT.size} exemptions proven emitted, ` +
    `${enforcementById.size} enforcement strings resolved (${allowlistedCount} allowlisted non-file)\n`,
)
