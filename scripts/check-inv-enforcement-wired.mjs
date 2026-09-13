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

// INV-137: tests/smoke/smoke-journeys.spec.ts is a TS Playwright STARTER FILE that
// src/generators/smoke-journeys.ts writes into a governed TARGET project (verified:
// resolvedPath(base, 'tests', 'smoke', 'smoke-journeys.spec.ts') in that generator) — it
// is generator-authored output, not a static .ejs template, so it can never exist as a
// path in arbiter's own tree and the template-basename fallback cannot see it either.
const TARGET_OUTPUT_PATH_EXEMPT = new Set(['tests/smoke/smoke-journeys.spec.ts'])

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
const idSpanRe = /id:\s*'(INV-\d+)'/g
const idMarks = []
{
  let m
  while ((m = idSpanRe.exec(catalogSrc)) !== null) idMarks.push({ id: m[1], at: m.index })
}
const enforcementById = new Map()
for (let i = 0; i < idMarks.length; i++) {
  const start = idMarks[i].at
  const end = i + 1 < idMarks.length ? idMarks[i + 1].at : catalogSrc.length
  const span = catalogSrc.slice(start, end)
  // enforcement value may be a single quoted literal or several concatenated with `+`
  // (string-literal continuation), matching the multi-line style used across the catalog.
  const em = span.match(
    /enforcement:\s*\n?\s*((?:'[^']*'|"[^"]*")(?:\s*\+\s*\n?\s*(?:'[^']*'|"[^"]*"))*)/,
  )
  if (!em) continue
  const text = [...em[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map((mm) => mm[1] ?? mm[2]).join('')
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
  'scripts',
  '.claude/hooks',
  '.githooks',
  'src/generators',
  '.github/workflows',
]

/** True when `token` (a file-ish citation extracted from an enforcement string) resolves
 * to a real path: a repo-relative path if it contains a `/`, otherwise a bare filename
 * looked up across the gate/hook/workflow directories or the template tree. */
function tokenResolves(token) {
  if (token.includes('/')) {
    // The negative lookahead in FILE_TOKEN_RE strips a trailing `.ejs` (e.g. a citation of
    // `src/templates/scripts/check-foo.mjs.ejs` extracts as `.../check-foo.mjs`) — try both
    // the bare path and its `.ejs` twin so a real template isn't reported as missing.
    return existsSync(resolve(root, token)) || existsSync(resolve(root, `${token}.ejs`))
  }
  for (const dir of BARE_LOOKUP_DIRS) {
    if (existsSync(resolve(root, dir, token))) return true
  }
  return templateBasenames.has(token) || templateBasenames.has(`${token}.ejs`)
}

const FILE_TOKEN_RE = /[A-Za-z0-9_.\-/]+\.(?:mjs|ts|java|yml|yaml)\b/g
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

let unresolvedTokenCount = 0
let allowlistedCount = 0
for (const [id, enforcement] of enforcementById) {
  if (!enforcement) continue
  const tokens = extractFileTokens(enforcement)
  if (tokens.length === 0) {
    // No file-ish token at all: the claim must be an explicit, reasoned allowlist entry —
    // a bare "contains CI/policy/review" match would re-green the exact INV-28 defect this
    // gate exists to catch (a claim that reads as real but resolves to nothing).
    const entry = nonFileAllowlist[id]
    if (!entry || !entry.mechanism || !entry.reason) {
      process.stdout.write(
        `  ENFORCEMENT NAMES NO MECHANISM (not allowlisted): ${id} — "${enforcement}"\n`,
      )
      violations++
    } else {
      allowlistedCount++
    }
    continue
  }
  for (const token of tokens) {
    const base = token.split('/').pop()
    if (FOREIGN_PATH_EXEMPT.has(base) || TARGET_OUTPUT_PATH_EXEMPT.has(token)) continue
    if (!tokenResolves(token) && !tokenResolves(base)) {
      process.stdout.write(`  ENFORCEMENT PATH NOT FOUND: ${id} cites "${token}"\n`)
      violations++
      unresolvedTokenCount++
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
