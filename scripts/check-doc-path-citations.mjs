#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: AC-2243.2 (#2243) — scans hand-authored prose (docs/, website/, .claude/)
// CATALOG:   for bare backtick citations of a repo file path (`src/ship/fix-on-red.ts`
// CATALOG:   class) that does not exist on disk. Advisory (runWarnCheck) — see the
// CATALOG:   header rationale below.
//
// CANON-16 survey (documented in the #2243 commit body): evaluated folding this
// class into check-phantom-command-scan.mjs vs a new sibling. Rejected the fold:
// phantom-command-scan is COMMAND-shaped (a regex pipeline over `arbiter <cmd>`
// citations cross-checked against src/cli.ts's routing table) — a bare file-path
// citation is a different SSOT (the filesystem, not a parsed command tree) and a
// different match shape (no `arbiter ` anchor). Also evaluated folding into
// check-doc-links.mjs — rejected: that gate resolves markdown LINK TARGETS
// (`[text](href)`, with VitePress route-aware redirects); this class is a bare
// inline-code path citation with NO link syntax (arc42.md:190's
// "`src/ship/fix-on-red.ts`" is a table cell, not a link). Zero syntactic overlap.
// New sibling script, per the pattern of check-phantom-command-scan.mjs itself
// (that script has no `.ejs` twin and no gate-registry.yml.ejs row — arbiter's own
// doc corpus is not something a consuming project's generated gate needs to
// validate against ITS OWN filesystem; this scanner follows the same precedent:
// no `.ejs` twin, no gate-registry row, the manifest's conditional
// check-doc-path-citations.mjs.ejs stays unmaterialized).
//
// Advisory, not hard (runWarnCheck in check-all.mjs): the corpus-wide false-positive
// surface for a first pass is unknown (runtime-generated paths referenced as "where
// the tool writes X", e.g. `.arbiter/e2e-ledger.jsonl`, are real prose but not
// committed source) — RUNTIME_ROOT_SKIP below covers the common cases but is not
// exhaustive. Promotion to a hard check is a tracked follow-up once a full-corpus
// pass confirms zero false positives (see the #2243 DONE report).
//
// Usage:
//   node scripts/check-doc-path-citations.mjs
//   node scripts/check-doc-path-citations.mjs --roots=a,b,c   (fixtures)
import { readFileSync, existsSync, statSync } from 'node:fs'
import { resolve, dirname, sep } from 'node:path'
import { walkRepo } from './lib/glob-walk.mjs'
import { isMainModule } from './lib/run-helpers.mjs'

function argValue(flag) {
  const arg = process.argv.find((a) => a.startsWith(`--${flag}=`))
  return arg ? arg.split('=')[1] : null
}

const CWD = resolve('.')
const ROOTS = argValue('roots') ? argValue('roots').split(',') : ['docs', 'website', '.claude']

// Same rationale as check-phantom-command-scan.mjs's SKIP_PATH_SEGMENTS:
// decision/roadmap archives and the changelog legitimately narrate paths that
// were proposed, renamed, or removed — not current-state promises.
const SKIP_PATH_SEGMENTS = [
  `${sep}internal${sep}`,
  `${sep}changelog${sep}`,
  `${sep}design${sep}`,
  `${sep}audit${sep}`,
  `${sep}plans${sep}`,
]

// AC-2243.2 (#2243): explicit, auditable allowlist for prose that DELIBERATELY
// documents a removed/historical path — not a live promise. Keyed by
// `${repo-relative file}:${cited path}` so an allowlist entry can never mask an
// unrelated future phantom citation in the same file. Mirrors
// check-phantom-command-scan.mjs's SKIP_PATH_SEGMENTS convention (explicit +
// commented, not keyword-sniffed).
const PATH_ALLOWLIST = new Set([
  // docs/REFERENCE/fix-on-red.md is the canonical historical record of the T2
  // command-surface cut — it cites src/ship/fix-on-red.ts explicitly to say it
  // no longer exists ("removed in the T2 command-surface cut").
  'docs/REFERENCE/fix-on-red.md:src/ship/fix-on-red.ts',
])

// Path-shaped citations under these roots are runtime-generated artifacts, not
// committed source — a doc legitimately says "written to `.arbiter/graph.json`"
// without that path ever existing in a fresh checkout. #2260 extended the list
// from the full-corpus triage; every entry below is a path a TOOL writes, never
// a path a human commits.
const RUNTIME_ROOT_SKIP = [
  '.arbiter/', // arbiter's own state/evidence root
  'dist/', // TypeScript build output
  'node_modules/', // installed dependencies
  'coverage/', // test-coverage reporter output
  '.git/', // git internals
  'tmp/', // scratch output
  '.claude/.task', // unified task document written by the task lifecycle (#2260)
  '.claude/hooks/logs/', // hook event log, appended at runtime (#2260)
  '.evidence/', // evidence bundle a governed project's gate emits (#2260)
  'graphify-out/', // optional graphify CLI output — absent unless graphify ran (#2260)
  'plan-review/', // plan-review step output, written per task (#2260)
  'build/', // Gradle build output (coverage XML lives here) (#2260)
  'target/', // Maven build output (JaCoCo XML lives here) (#2260)
  'scratchpad/', // per-session scratch notes, never committed (#2260)
]

// #2260: prose that deliberately uses a PLACEHOLDER path — a template the reader
// substitutes, not a promise about the filesystem. Matched as a substring of the
// cited path so one pattern covers every doc that uses the same placeholder.
const PLACEHOLDER_PATTERNS = [
  'path/to/', // generic "your file here" stand-in in skill/command templates
  'file/path.', // commit/report body template line: `file/path.ts`: <what changed>
  'wave-N.md', // N is the wave number — `.claude/plans/wave-N.md` is a naming rule
  'my-tool', // CONTRIBUTING's "add your own generator" walkthrough scaffold
  'my-rules/', // custom-invariant recipe scaffold emitted by `arbiter plugin init`
  'my-language', // custom-generator recipe's stand-in language name
]

// Matches a backtick-wrapped, standalone repo-relative path: at least one `/`
// segment, ending in a `.ext` (1-5 lowercase letters). Anchored tight against
// the backticks (no leading/trailing text inside them) so a full command-line
// example like `` `node scripts/check-all.mjs L1` `` does NOT match — the
// space before "scripts/" breaks the pattern, unlike a bare path citation such
// as `` `src/ship/fix-on-red.ts` ``. This is exactly what keeps the class off
// shell/example snippets (#2243's false-positive corpus requirement).
const PATH_CITATION_RE = /`([a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)+\.[a-zA-Z]{1,5})`/g

export function extractPathCitations(markdown) {
  const cited = new Set()
  for (const m of markdown.matchAll(PATH_CITATION_RE)) {
    cited.add(m[1])
  }
  return cited
}

/**
 * AC-2243.2 (#2243): a cited path is a phantom when it looks like a repo path
 * (matched PATH_CITATION_RE) but does not exist on disk, isn't a URL, and isn't
 * under a runtime-generated root. A `./` or `../`-leading citation resolves
 * against `fileDir` (the citing doc's own directory — how a relative path in
 * prose is actually meant); everything else — including a dotfolder like
 * `.claude/x.md` or `.arbiter/y`, which is repo-root-relative, NOT
 * file-relative — resolves against `repoRoot` (`fileDir` optional — defaults
 * to `repoRoot`, e.g. for `extractPathCitations` callers with no file context).
 */
export function findPhantomPaths(citedPaths, repoRoot, fileDir = repoRoot) {
  return [...citedPaths]
    .filter((p) => !/^(https?:)?\/\//.test(p))
    .filter((p) => !RUNTIME_ROOT_SKIP.some((skip) => p.startsWith(skip)))
    .filter((p) => !PLACEHOLDER_PATTERNS.some((ph) => p.includes(ph)))
    .filter(
      (p) =>
        !existsSync(resolve(p.startsWith('../') || p.startsWith('./') ? fileDir : repoRoot, p)),
    )
    .sort()
}

const SCANNABLE_SUFFIXES = ['.md', '.md.ejs']

function collectScanFiles(root) {
  const abs = resolve(CWD, root)
  if (!existsSync(abs)) return []
  if (statSync(abs).isFile()) {
    return SCANNABLE_SUFFIXES.some((suf) => abs.endsWith(suf)) ? [abs] : []
  }
  return walkRepo(abs)
    .filter((rel) => SCANNABLE_SUFFIXES.some((suf) => rel.endsWith(suf)))
    .map((rel) => `${abs}${sep}${rel}`)
    .filter((abs2) => !SKIP_PATH_SEGMENTS.some((seg) => abs2.includes(seg)))
}

function relPath(abs) {
  return abs.startsWith(CWD + sep) ? abs.slice(CWD.length + 1) : abs
}

function main() {
  const files = ROOTS.flatMap(collectScanFiles)
  if (files.length === 0) {
    process.stdout.write('[check-doc-path-citations] no docs found under scan roots — skipping\n')
    process.exit(0)
  }

  let violations = 0
  for (const file of files) {
    const rel = relPath(file)
    const content = readFileSync(file, 'utf-8')
    const phantoms = findPhantomPaths(extractPathCitations(content), CWD, dirname(file))
    for (const phantom of phantoms) {
      if (PATH_ALLOWLIST.has(`${rel}:${phantom}`)) continue
      process.stdout.write(`  phantom-path: ${rel}: \`${phantom}\` does not exist in the repo\n`)
      violations++
    }
  }

  if (violations > 0) {
    process.stdout.write(
      `[check-doc-path-citations] FAIL: ${violations} dead path citation(s) found\n`,
    )
    process.exit(1)
  }
  process.stdout.write(
    `[check-doc-path-citations] OK — every cited path exists (${files.length} file(s) scanned)\n`,
  )
}

const isMain = isMainModule(import.meta.url)
if (isMain) {
  try {
    main()
  } catch (err) {
    process.stderr.write(
      `[check-doc-path-citations] ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(1)
  }
}
