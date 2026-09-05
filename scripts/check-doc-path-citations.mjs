#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: AC-2243.2 (#2243) — scans hand-authored prose (docs/, website/, .claude/)
// CATALOG:   for bare backtick citations of a repo file path (`src/ship/fix-on-red.ts`
// CATALOG:   class) that does not exist on disk. HARD (runCheck) since #2260 —
// CATALOG:   the full corpus was triaged to zero and the class cannot regrow.
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
// Hard (runCheck in check-all.mjs) since #2260. It shipped advisory in #2243
// because the corpus-wide false-positive surface was untriaged; #2260 classified
// all 124 then-open hits into three buckets and cleared them:
//   - runtime-written roots  → RUNTIME_ROOT_SKIP (a tool writes it, nobody commits it)
//   - deliberate placeholders → PLACEHOLDER_PATTERNS (the reader substitutes it)
//   - gitignored-by-design    → isGitIgnored (per-machine file, never in git)
//   - everything else         → a doc edit, never an allowlist entry
// A citation naming a file in a GOVERNED TARGET rather than in arbiter's own tree
// carries the `<project>/` prefix the corpus already uses (docs/INTEGRATIONS.md) —
// which is not path-shaped, so it never reaches this scanner. Deliberately no
// blanket `scripts/`- or `config/`-prefix skip: arbiter has its own scripts/ and
// a prefix skip there would blind the gate to real drift.
//
// Usage:
//   node scripts/check-doc-path-citations.mjs
//   node scripts/check-doc-path-citations.mjs --roots=a,b,c   (fixtures)
import { readFileSync, existsSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname, sep } from 'node:path'
import { walkRepo } from './lib/glob-walk.mjs'
import { isMainModule } from './lib/run-helpers.mjs'

function argValue(flag) {
  const arg = process.argv.find((a) => a.startsWith(`--${flag}=`))
  return arg ? arg.split('=')[1] : null
}

const CWD = resolve('.')
const ROOTS = argValue('roots') ? argValue('roots').split(',') : ['docs', 'website', '.claude']

// Decision/roadmap archives and the changelog legitimately narrate paths that
// were proposed, renamed, or removed — not current-state promises. `internal`
// is a location, not an archive: its CANON, METHOD, PRODUCT, and architecture
// documents describe the current contract and must stay on this scan surface.
const SKIP_PATH_SEGMENTS = [
  `${sep}internal${sep}ADR${sep}`,
  `${sep}internal${sep}SYSTEM${sep}DECISIONS.md`,
  `${sep}internal${sep}PRODUCT${sep}MILESTONES.md`,
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
  // #2260 — each entry below is prose whose POINT is that the path is absent,
  // historical, or owned by another repo. Repointing them would make them lie.
  // AGENTS.md narrates the T2 cut in the same sentence ("commands/conformance.ts
  // deleted"); website/governance/AGENTS.md is its byte-for-byte mirror.
  'website/governance/AGENTS.md:commands/conformance.ts',
  // A 1.0.0 breaking-changes row recording a rename between two modules that
  // both existed at the time and were both later removed.
  'docs/SEMVER.md:src/config/thresholds-l1-l2-l3.ts',
  'docs/SEMVER.md:src/config/thresholds-by-level.ts',
  // ADR-062's verbatim title. The path is emitted into a governed target by
  // src/generators/docs.ts; arbiter deliberately does not self-emit it (#1102).
  'docs/architecture/adr-index.md:docs/COMMANDS.md',
  // A confine review asserting the gate script does NOT exist in arbiter's own
  // scripts/ — the declared-but-unfirable enforcement it is reporting.
  'docs/PRODUCT/CONFINE.md:scripts/check-solo-reactivation.mjs',
  // Names ANOTHER project's enforcement point, immediately after saying so
  // ("this document is the portable pattern, not the project-specific one").
  'docs/methodology/gate-throughput-patterns.md:scripts/gates/chain-batching.sh',
  // Mirrors the M16_CORPUS array in scripts/check-m16-handoff.mjs, which
  // deliberately lists a not-yet-written skill and tolerates its absence.
  'docs/methodology/agent-orchestration-and-context-hygiene.md:.claude/skills/drain/SKILL.md',
  // CANON-07 explicitly records the deletion of this dead test as a lesson.
  'docs/internal/SYSTEM/CANON.md:__tests__/integration/generated-check-all.test.ts',
  // HOOK-CONTRACTS uses this deliberately invalid escape attempt as the example
  // of a fixture path that the guard must reject without writing it.
  'docs/internal/SYSTEM/HOOK-CONTRACTS.md:../escaped.ts',
  // CANONICAL_PATHS is a current SSOT and is scanned. Its left table column is
  // the permanent history of these deliberately removed aliases; each right
  // column target remains subject to the normal existence check.
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/ARCHITECTURE/CANONICAL-SOURCE-MODEL.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/ARCHITECTURE/CONFLICT-RESOLUTION.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/ARCHITECTURE/OVERVIEW.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/ARCHITECTURE/TEMPLATE-SYSTEM.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/architecture/OVERVIEW.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/architecture/CANONICAL-SOURCE-MODEL.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/architecture/TEMPLATE-SYSTEM.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/architecture/CONFLICT-RESOLUTION.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/architecture/dual-track-contract.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/architecture/evidence-bundle.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/architecture/skeleton-governance.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/architecture/ARCHITECTURE.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/SYSTEM/detector-error-policy.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/SYSTEM/FAIL_CLOSED.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/METHOD/TRACK_MODEL.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/SYSTEM/POST_COMMIT_TRACKS.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/METHOD/DOC_SEMVER.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/rfc/README.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/METHOD/PROCESS.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/TESTING_POLICY.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/MASTER_TEST_PLAN.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/TEST_TAXONOMY.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/METHOD/SELF_VALIDATION_PROTOCOL.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/SYSTEM/E2E-RUNTIMES.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/GOVERNANCE/index.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/GOVERNANCE/RACI.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/SYSTEM/ID-STABILITY.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/METHOD/TAG_TAXONOMY.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/GOVERNANCE/GOOD-FIRST-ISSUE-POLICY.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/SETUP.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/install/windows.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/CODING_STANDARDS.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/DEVELOPMENT/GETTING-STARTED.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/DEVELOPMENT/CONVENTIONS.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/PRODUCT/MILESTONES.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/ADR/001-agents-md-canonical.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/ADR/002-thin-pointer-pattern.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/ADR/003-gh-cli-required.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/ADR/004-skip-if-exists.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/ADR/005-deep-merge-settings.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/ADR/031-plugin-api-v1.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/SYSTEM/DECISIONS.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/SYSTEM/CANON.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/ARCHITECTURE.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/METHOD/SSOT_CORE_SET.md',
  'docs/internal/METHOD/CANONICAL_PATHS.md:docs/METHOD/CANONICAL_PATHS.md',
  // GAP is a live, time-stamped audit and is scanned. These FALSO findings
  // deliberately cite the absent path that the audit proved absent.
  'docs/internal/SYSTEM/GAP.md:src/commands/anti-fake-green.ts',
  'docs/internal/SYSTEM/GAP.md:__tests__/commands/anti-fake-green.test.ts',
  'docs/internal/SYSTEM/GAP.md:src/bad.ts',
  'docs/internal/SYSTEM/GAP.md:config/pr-size-config.json',
  'docs/internal/SYSTEM/GAP.md:docs/SYSTEM/CANON.md',
  'docs/internal/SYSTEM/GAP.md:docs/SYSTEM/DECISIONS.md',
  'docs/internal/SYSTEM/GAP.md:docs/DEVELOPMENT/REAL-PROJECT-TESTING.md',
  'docs/internal/SYSTEM/GAP.md:docs/GOVERNANCE/E2E_CONSTITUTION.md',
  'docs/internal/SYSTEM/GAP.md:docs/METHOD/BACKEND_CONTEXT.md',
  'docs/internal/SYSTEM/GAP.md:docs/METHOD/FRONTEND_CONTEXT.md',
  // These two GAP.md rows recorded VERO (the path existed and was verified) at the
  // 2026-07-18 audit date. #2520 later retired both scripts as structurally vacuous
  // (no writer ever produced their stamp artifact; each exited 0 whenever it was
  // absent, by design). GAP.md is a frozen, SHA-pinned point-in-time record — rewriting
  // its verified findings after the fact would make the audit lie about what it found,
  // so the citation is allowlisted rather than the historical text edited.
  'docs/internal/SYSTEM/GAP.md:scripts/check-nightly-freshness.mjs',
  'docs/internal/SYSTEM/GAP.md:scripts/check-monthly-freshness.mjs',
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
  '.claude/.task/', // unified task document written by the task lifecycle (#2260)
  '.claude/hooks/logs/', // hook event log, appended at runtime (#2260)
  '.claude/.last-done-evidence.json', // task-completion state, written at runtime
  '.evidence/', // evidence bundle a governed project's gate emits (#2260)
  'graphify-out/', // optional graphify CLI output — absent unless graphify ran (#2260)
  'plan-review/', // plan-review step output, written per task (#2260)
  'build/', // Gradle build output (coverage XML lives here) (#2260)
  'target/', // Maven build output (JaCoCo XML lives here) (#2260)
  'scratchpad/', // per-session scratch notes, never committed (#2260)
]

// #2260: prose that deliberately uses a sample path — a template the reader
// substitutes, not a promise about the filesystem. Matched as a substring of the
// cited path so one pattern covers every doc that uses the same sample.
const PLACEHOLDER_PATTERNS = [
  'path/to/', // generic "your file here" stand-in in skill/command templates
  'file/path.', // commit/report body template line: `file/path.ts`: <what changed>
  'wave-N.md', // N is the wave number — `.claude/plans/wave-N.md` is a naming rule
  'my-tool', // CONTRIBUTING's "add your own generator" walkthrough scaffold
  'my-rules/', // custom-invariant recipe scaffold emitted by `arbiter plugin init`
  'my-language', // custom-generator recipe's stand-in language name
  'dim-NN-', // generic KIT-dimension filename in architecture tables
  'scripts/X.mjs', // invariant-enforcement sample for an arbitrary gate
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
    .filter(
      (p) =>
        !RUNTIME_ROOT_SKIP.some((skip) => (skip.endsWith('/') ? p.startsWith(skip) : p === skip)),
    )
    .filter((p) => !PLACEHOLDER_PATTERNS.some((ph) => p.includes(ph)))
    .filter(
      (p) =>
        !existsSync(resolve(p.startsWith('../') || p.startsWith('./') ? fileDir : repoRoot, p)),
    )
    .sort()
}

// #2260: a cited path that git IGNORES is local-by-design, not dead —
// `.claude/settings.local.json` exists on a developer's machine and never in
// git, so it resolved locally and 404'd in a fresh CI checkout. A citation is
// dead only when the path is neither tracked NOR ignored. Delegated to git so
// the full .gitignore grammar (negations, nested files, precedence) is honoured
// rather than re-implemented; the exit-1/exit-128 branch means a non-repo
// fixture dir simply reports "not ignored", preserving the fixture semantics.
// Complements RUNTIME_ROOT_SKIP rather than replacing it: that list states an
// intent that holds in a GOVERNED TARGET too (`plan-review/` and `scratchpad/`
// are not in arbiter's own .gitignore), and must not depend on this repo's.
const ignoredCache = new Map()
export function isGitIgnored(citedPath, cwd = CWD) {
  const key = `${cwd}\u0000${citedPath}`
  if (!ignoredCache.has(key)) {
    let ignored = false
    try {
      execFileSync('git', ['check-ignore', '-q', '--', citedPath], { cwd, stdio: 'ignore' })
      ignored = true
    } catch (err) {
      // check-ignore's documented contract: 1 = not ignored, 128 = not a git
      // repo (a fixture temp dir). Both mean "cannot vouch for it" → leave the
      // citation subject to the existence check, i.e. the gate stays strict.
      // Anything else (git absent, permission error) is a broken apparatus, not
      // an answer — surface it rather than silently un-skipping the whole class.
      if (err?.status !== 1 && err?.status !== 128) throw err
      ignored = false
    }
    ignoredCache.set(key, ignored)
  }
  return ignoredCache.get(key)
}

const SCANNABLE_SUFFIXES = ['.md', '.md.ejs']

export function collectScanFiles(root) {
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
      if (isGitIgnored(phantom)) continue
      process.stdout.write(`  phantom-path: ${rel}: \`${phantom}\` does not exist in the repo\n`)
      violations++
    }
  }

  if (violations > 0) {
    process.stdout.write(
      `[check-doc-path-citations] FAIL: ${violations} dead path citation(s) found\n`,
    )
    process.exitCode = 1
    return
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
