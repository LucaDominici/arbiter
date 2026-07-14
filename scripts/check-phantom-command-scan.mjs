#!/usr/bin/env node
// CATALOG: scans hand-authored prose (PRIVACY.md, docs/, website/, .claude/) + emitted-runner template sources (src/templates/**) for `arbiter <cmd>` citations of commands absent from src/cli.ts (INV-111 ext); cross-checks standards/cli-emitted-surface.yml against the same SSOT (T5b'/T5b'', #1944).
// CATALOG: rejected fold-in into gen-cli-ref.mjs (generates/validates ONE machine-owned region in cli.md; this scans the whole prose corpus — different failure surface, shared parser via lib/cli-command-names.mjs).
// CATALOG: rejected fold-in into check-doc-links.mjs (link-target existence, not command-existence; merging would conflate two drift models).
//
// Gate (F2 #1838, item 4 — extends INV-111 enforcement): every `arbiter <cmd>`
// invocation cited in hand-authored prose docs (PRIVACY.md, docs/, website/,
// .claude/) must name a command that actually exists in src/cli.ts's routing.
//
// .claude/ was added to ROOTS after a release-readiness audit found a phantom
// `arbiter context-pack` citation in .claude/agents/context-checker.md that this
// gate never saw (docs/website only): agent personas and slash-command runbooks
// are exactly the "current-state, user-facing promises" this gate exists to
// police, they just happen to live outside docs/.
//
// INV-111 already guards the MACHINE-GENERATED region of website/reference/cli.md
// (scripts/gen-cli-ref.mjs --check) — but hand-written prose elsewhere can cite a
// phantom command without ever touching that generated region, so it drifts
// invisibly. This is exactly what happened historically: PRIVACY.md cited
// `arbiter check` / `arbiter generate`, neither of which was ever registered
// (fixed in F1, #1837). This gate makes that class of drift permanent-catchable
// instead of relying on a human noticing during review.
//
// Scope is deliberately narrower than "every markdown file": docs/internal/
// (ADR + roadmap) and website/changelog/ are historical/decision/roadmap
// records that legitimately discuss commands that are proposed-but-unbuilt or
// removed-but-once-existed ("`arbiter upgrade` ... is planned as a separate
// future feature", "### Removed - `arbiter work`") — flagging those would be
// noise, not a caught bug, and would erode trust in the gate (no finto
// enforcement in the other direction either: a gate nobody can keep green
// without constant suppression stops being followed). The scan targets
// current-state, user-facing promises only.
//
// T5b′ (docs/design/gold-doc-self-tier-and-coherence.md §2.2, #1944): `src/templates`
// is scanned too — the .ejs SOURCES render byte-for-byte into every governed repo's
// emitted runners/playbooks (*.md.ejs -> .claude/commands/*.md; *.mjs.ejs ->
// scripts/*.mjs), so a phantom citation here breaks the emission boundary itself,
// not just one repo's prose. Two matchers cover it: the existing backtick-prose
// COMMAND_MENTION_RE (unchanged — .md.ejs bodies read like ordinary markdown) and
// the new SPAWN_ARRAY_RE below (the `spawnSync('npx', ['--no-install', 'arbiter',
// 'doc-set', ...])` shape thin-runner .mjs.ejs templates use).
//
// T5b″ (design §2.3, #1944): standards/cli-emitted-surface.yml is the append-only
// memory of which commands ship inside emitted artifacts (deleting a command a
// template still cites would go RED here even if the template scan somehow missed
// it, and vice versa — every citation the template scan finds must have a ledger
// row, keeping the ledger complete by construction). Extended beyond the design
// doc's own schema (#1944, "flag-surface check"): a ledger row MAY also carry a
// `flags:` list, checked against the SAME command's registered `.option()` flags
// in cli.ts. This is the check that would have caught the real incident behind
// this issue — `doc-set --check` broke every governed repo's runner because the
// *command* existed but the *flag* didn't, a class the name-level scan above is
// structurally blind to (fixed for real in 379185de; this gate is what should have
// caught it first).
//
// Usage:
//   node scripts/check-phantom-command-scan.mjs
//   node scripts/check-phantom-command-scan.mjs --cli=path --roots=a,b,c --ledger=path   (fixtures)
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { walkRepo } from './lib/glob-walk.mjs'
import {
  extractTopLevelCommandNames,
  extractCommandAliases,
  extractCommandOptions,
} from './lib/cli-command-names.mjs'

function argValue(flag) {
  const arg = process.argv.find((a) => a.startsWith(`--${flag}=`))
  return arg ? arg.split('=')[1] : null
}

const CWD = resolve('.')
const CLI_TS = argValue('cli') ? resolve(argValue('cli')) : resolve(CWD, 'src', 'cli.ts')
const ROOTS = argValue('roots')
  ? argValue('roots').split(',')
  : ['PRIVACY.md', 'docs', 'website', '.claude', 'src/templates']
const LEDGER_PATH = argValue('ledger')
  ? resolve(argValue('ledger'))
  : resolve(CWD, 'standards', 'cli-emitted-surface.yml')

// Path segments excluded from the scan (see header comment): decision/roadmap
// archives and the changelog, none of which assert *current* CLI behavior.
// `design` (gold-doc-self-tier-and-coherence.md §2.2): design docs are PROPOSAL records too —
// they legitimately cite a cut or never-shipped command (`arbiter watch`, `arbiter ghostcmd`,
// `arbiter context-pack`) as the very thing being discussed/rejected. Current-state promises
// must not live in docs/design/, so a design doc discussing a dead command is not a phantom
// citation the way a live skill/playbook instructing one would be.
// `audit` (docs/audit/release-readiness-verdict.md, seal/fable-docs): same class as `design` —
// an audit report's job is to quote OTHER files' broken citations as EVIDENCE (`arbiter mark`,
// `arbiter review plan`, `arbiter work close`, ...), not to assert those commands currently work.
// A backtick-quoted phantom inside an audit finding is the bug being reported, not a live
// user-facing promise this gate exists to police — flagging it would be the exact self-referential
// false positive the verdict doc's own B1 section already documents happening to another file.
// `plans` (design §2.2, "Not .claude/plans"): historical planning-session transcripts under
// .claude/plans/ legitimately narrate commands that were proposed, renamed, or cut mid-session
// (verified: 7 phantom citations there today, all noise — adapters/adherence/close-gold-gap/
// conformance/findings/kit/plugin) — same "record of a discussion", not a live promise, rationale
// as `design`/`audit`, just for a different doc class.
const SKIP_PATH_SEGMENTS = [
  `${sep}internal${sep}`,
  `${sep}changelog${sep}`,
  `${sep}design${sep}`,
  `${sep}audit${sep}`,
  `${sep}plans${sep}`,
]

// `help` is commander's built-in meta-command — extractTopLevelCommandNames
// deliberately excludes it (gen-cli-ref.mjs's generated table doesn't need a
// row for it), but `arbiter help` genuinely runs, so the phantom-scan must
// not flag it.
const ALWAYS_VALID = new Set(['help'])

// Matches an inline-code or fenced-code `arbiter <word>` invocation: the
// backtick-wrapped form is how every doc in this repo cites a command (never
// bare prose), so anchoring to backticks avoids matching plain-English
// sentences like "arbiter checks your commits". The [a-z] lead character
// naturally excludes global flags (`arbiter --version`) and possessives
// (`arbiter's`), since neither starts a bare lowercase word.
const COMMAND_MENTION_RE = /`arbiter\s+([a-z][a-z0-9-]*)/g

// A handful of common verbs read naturally after "arbiter" in prose that
// happens to sit inside backticks for emphasis (e.g. "`arbiter governs
// itself`" in website/problems/dogfooding-trust.md) rather than citing an
// invocation. Backtick-anchoring alone can't distinguish "styled sentence"
// from "command reference" — this explicit, auditable stoplist can.
const PROSE_STOPWORDS = new Set(['governs', 'is', 'was', 'does', 'has', 'runs', 'works'])

export function extractCitedCommands(markdown) {
  const cited = new Set()
  for (const m of markdown.matchAll(COMMAND_MENTION_RE)) {
    if (PROSE_STOPWORDS.has(m[1])) continue
    cited.add(m[1])
  }
  return cited
}

// Matches the two adjacent string-literal array elements of a commander-CLI
// spawn call — `spawnSync('npx', ['--no-install', 'arbiter', 'doc-set', ...])`
// — the shape every thin-runner .mjs.ejs template in src/templates/scripts/
// uses to shell out to this CLI (design §2.2, T5b′, #1944). This is the
// emission-boundary counterpart to COMMAND_MENTION_RE's backtick-prose match:
// a template stranding a citation here breaks every governed repo's emitted
// runner, not just a doc's prose promise. No stopword filtering needed — an
// array-literal token immediately after `'arbiter',` is never styled prose.
const SPAWN_ARRAY_RE = /'arbiter',\s*'([a-z][a-z0-9-]*)'/g

export function extractSpawnedCommands(source) {
  return new Set([...source.matchAll(SPAWN_ARRAY_RE)].map((m) => m[1]))
}

/**
 * Compare cited command words against the real top-level command set.
 * Returns the sorted array of phantom (cited but nonexistent) names.
 */
export function findPhantomCommands(citedCommands, realCommandNames) {
  return [...citedCommands].filter((c) => !realCommandNames.has(c)).sort()
}

// `.md` covers hand-authored prose; `.md.ejs`/`.mjs.ejs` are the emitted-template
// SOURCES (design §2.2) — they render byte-for-byte into a governed repo's
// `.claude/commands/*.md` / `scripts/*.mjs`, so scanning the template source
// validates every future emission. Both extractors (backtick-prose and
// spawn-array) run against every collected file regardless of extension —
// each regex is specific enough (backtick+`arbiter <word>`, literal
// `'arbiter', '<word>'` array elements) that running the "wrong" one against
// the "wrong" file type is a no-op, not a false positive.
const SCANNABLE_SUFFIXES = ['.md', '.md.ejs', '.mjs.ejs']

function collectScanFiles(root) {
  const abs = resolve(CWD, root)
  if (!existsSync(abs)) return []
  if (statSync(abs).isFile()) {
    return SCANNABLE_SUFFIXES.some((suf) => abs.endsWith(suf)) ? [abs] : []
  }
  return walkRepo(abs)
    .filter((rel) => SCANNABLE_SUFFIXES.some((suf) => rel.endsWith(suf)))
    .map((rel) => join(abs, rel))
    .filter((abs2) => !SKIP_PATH_SEGMENTS.some((seg) => abs2.includes(seg)))
}

function main() {
  if (!existsSync(CLI_TS)) {
    process.stdout.write(`[check-phantom-command-scan] ERROR: cli source not found: ${CLI_TS}\n`)
    process.exit(2)
  }
  const cliSrc = readFileSync(CLI_TS, 'utf-8')
  const { topLevelNames } = extractTopLevelCommandNames(cliSrc)
  const aliases = extractCommandAliases(cliSrc)
  if (topLevelNames.size === 0) {
    throw new Error('extracted zero top-level commands from cli.ts — parser out of date')
  }
  const realCommandNames = new Set([...topLevelNames, ...aliases, ...ALWAYS_VALID])

  const files = ROOTS.flatMap(collectScanFiles)
  if (files.length === 0) {
    process.stdout.write('[check-phantom-command-scan] no docs found under scan roots — skipping\n')
    process.exit(0)
  }

  let violations = 0
  // T5b′ (#1944): commands cited from emitted-template SOURCES (.md.ejs/.mjs.ejs
  // under src/templates/**) are tracked separately so the T5b″ ledger completeness
  // cross-check can demand a row for each — the ledger is the append-only memory of
  // what ships INSIDE emitted artifacts, so it is kept complete by construction.
  const templateCitedCommands = new Set()
  for (const file of files) {
    const content = readFileSync(file, 'utf-8')
    const cited = extractCitedCommands(content)
    // T5b′: also match the spawn-array shape (`'arbiter', 'doc-set'`) thin-runner
    // .mjs.ejs templates use to shell out — a phantom here breaks every governed
    // repo's emitted runner, not just a prose promise.
    for (const c of extractSpawnedCommands(content)) cited.add(c)
    if (file.endsWith('.md.ejs') || file.endsWith('.mjs.ejs')) {
      for (const c of cited) templateCitedCommands.add(c)
    }
    const phantoms = findPhantomCommands(cited, realCommandNames)
    for (const phantom of phantoms) {
      process.stdout.write(
        `  phantom: ${relPath(file)}: \`arbiter ${phantom}\` is not a registered command\n`,
      )
      violations++
    }
  }

  // T5b″ (#1944): cross-check the append-only ledger against the same SSOT. Only
  // runs when emitted-template sources were scanned — the ledger is the memory of
  // what ships inside emitted artifacts, so the cross-check is moot without them.
  if (templateCitedCommands.size > 0) {
    violations += crossCheckLedger(LEDGER_PATH, templateCitedCommands, realCommandNames, cliSrc)
  }

  if (violations > 0) {
    process.stdout.write(
      `[check-phantom-command-scan] FAIL: ${violations} phantom command citation(s) / ledger drift found\n`,
    )
    process.exit(1)
  }
  process.stdout.write(
    `[check-phantom-command-scan] OK — every cited command exists in cli.ts (${files.length} file(s) scanned)\n`,
  )
}

/**
 * T5b″ (#1944): cross-check standards/cli-emitted-surface.yml against the same
 * SSOT (src/cli.ts). Three failure classes:
 *   1. completeness — every command an emitted template cites must have a ledger
 *      row (keeps the append-only memory complete by construction);
 *   2. existence — every command the ledger records must be a registered command
 *      in cli.ts (deleting a command a template still cites goes RED here even if
 *      the template scan somehow missed it);
 *   3. flag-surface — every `flags:` entry on a ledger row must match a real
 *      `.option()` for that command in cli.ts (the check that would have caught
 *      the `doc-set --check` incident — command existed, flag didn't).
 */
function crossCheckLedger(ledgerPath, templateCitedCommands, realCommandNames, cliSrc) {
  let violations = 0
  const rel = relPath(ledgerPath)
  if (!existsSync(ledgerPath)) {
    process.stdout.write(
      `  ledger: ${rel} not found — T5b″ requires an append-only ledger when template sources are scanned (#1944)\n`,
    )
    return 1
  }
  let ledger
  try {
    ledger = parseYaml(readFileSync(ledgerPath, 'utf-8'))
  } catch (err) {
    process.stdout.write(
      `  ledger: ${rel} failed to parse: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    return 1
  }
  const rows = Array.isArray(ledger?.commands) ? ledger.commands : []
  const ledgerByCommand = new Map()
  for (const row of rows) {
    if (!row || typeof row.command !== 'string') continue
    ledgerByCommand.set(row.command, new Set(Array.isArray(row.flags) ? row.flags : []))
  }

  // 1. completeness: template-cited → ledger row.
  for (const cmd of [...templateCitedCommands].sort()) {
    if (!ledgerByCommand.has(cmd)) {
      process.stdout.write(
        `  ledger: \`${cmd}\` is cited by an emitted template but has no row in ${rel} (T5b″ completeness, #1944)\n`,
      )
      violations++
    }
  }
  // 2. existence: ledger command → registered in cli.ts.
  for (const cmd of [...ledgerByCommand.keys()].sort()) {
    if (!realCommandNames.has(cmd)) {
      process.stdout.write(
        `  ledger: \`${cmd}\` is recorded in ${rel} but is not a registered command in cli.ts (T5b″, #1944)\n`,
      )
      violations++
    }
  }
  // 3. flag-surface: ledger flag → real .option() for that command.
  for (const cmd of [...ledgerByCommand.keys()].sort()) {
    const flags = ledgerByCommand.get(cmd)
    if (flags.size === 0) continue
    if (!realCommandNames.has(cmd)) continue // already reported as missing command
    const realOpts = extractCommandOptions(cliSrc, cmd)
    if (realOpts === null) continue
    for (const f of [...flags].sort()) {
      if (!realOpts.has(f)) {
        process.stdout.write(
          `  ledger: flag \`${f}\` for command \`${cmd}\` in ${rel} is not a registered .option() in cli.ts (T5b″ flag-surface, #1944)\n`,
        )
        violations++
      }
    }
  }
  return violations
}

function relPath(abs) {
  return abs.startsWith(CWD + sep) ? abs.slice(CWD.length + 1) : abs
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  try {
    main()
  } catch (err) {
    process.stderr.write(
      `[check-phantom-command-scan] ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(1)
  }
}
