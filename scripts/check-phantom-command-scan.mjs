#!/usr/bin/env node
// CATALOG: scans hand-authored prose (PRIVACY.md, docs/, website/, .claude/) + emitted-runner template sources (src/templates/**) for `arbiter <cmd>` citations of commands absent from src/cli.ts (INV-111 ext); cross-checks standards/cli-emitted-surface.yml against the same SSOT (T5b'/T5b'', #1944). AC-2243.1 (#2243) extends this to bare-word (no `arbiter ` prefix) command citations in an "(e.g. `a`, `b`, ...)" list gated on a nearby "command(s)" mention.
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
import { parse as parseYaml } from 'yaml'
import { walkRepo } from './lib/glob-walk.mjs'
import { isMainModule } from './lib/run-helpers.mjs'
import { loadDocGateAllowlist, allowlistSummary } from './lib/doc-gate-allowlist.mjs'
import {
  extractTopLevelCommandNames,
  extractCommandAliases,
  extractCommandOptions,
  extractSubcommandNames,
  extractCommandAliasMappings,
} from './lib/cli-command-names.mjs'

function argValue(flag) {
  const arg = process.argv.find((a) => a.startsWith(`--${flag}=`))
  return arg ? arg.split('=')[1] : null
}

const CWD = resolve('.')
const CLI_TS = argValue('cli') ? resolve(argValue('cli')) : resolve(CWD, 'src', 'cli.ts')
// #2408: `examples` joins the roots — `examples/plugins/spring-boot/README.md`
// cites `arbiter plugin add` inside a fenced block and nothing ever looked at it.
// Only README.md is collected there (see EXAMPLES_ROOT below): every
// `examples/<name>/` subtree is verbatim `arbiter init` OUTPUT, regenerated by
// scripts/regenerate-examples.mjs, and its emitted playbooks are already covered
// at their TEMPLATE source under src/templates/**.
const ROOTS = argValue('roots')
  ? argValue('roots').split(',')
  : ['PRIVACY.md', 'docs', 'website', '.claude', 'src/templates', 'examples']
const EXAMPLES_ROOT = 'examples'
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
// AC-2231.5 (#2231): a second, optional capture validates SUBCOMMAND tokens —
// `arbiter review code`. The same [a-z] lead on token 2 discriminates
// non-verbs in the corpus: `arbiter ship #NNN --advance` (#-prefixed issue
// arg), `arbiter init --recipe <url>` / `arbiter update --governance`
// (--flags) and `<...>`/`[...]` arg specs never start with a bare lowercase
// word, so they can never be misread as subcommands.
const COMMAND_MENTION_RE = /`arbiter\s+([a-z][a-z0-9-]*)(?:\s+([a-z][a-z0-9-]*))?/g

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

// AC-2243.1 (#2243): a bare backtick word cites a command WITHOUT the
// `arbiter ` prefix — arc42.md:706's "Only 11 CLI commands are public; the
// remaining ~65 registrations are hidden/experimental but fully functional
// (e.g. `graph`, `kit`, `conformance`, `ci`, `plugin`)" is the motivating
// case. COMMAND_MENTION_RE can't see these (it anchors on the literal
// `arbiter ` prefix). Matching EVERY bare backtick word in the corpus would
// be noise (most are flags, filenames, config keys, code snippets — anything
// short and lowercase) — this class is scoped to a comma-separated
// `` `word`, `word`, ... `` list introduced by "e.g." (the idiom every corpus
// instance of this class uses), and further gated on a "command(s)" mention
// within COMMAND_CONTEXT_WINDOW chars before the list, so an unrelated
// enumeration (environment names, config values) never trips it.
const BARE_WORD_LIST_RE = /\(e\.g\.,?\s+((?:`[a-z][a-z0-9-]*`(?:,\s*)?)+)\)/g
const COMMAND_CONTEXT_RE = /\bcommands?\b/i
const COMMAND_CONTEXT_WINDOW = 300

/**
 * AC-2243.1 (#2243): extract bare-word command citations from an "(e.g. `a`,
 * `b`, ...)" list whose containing context mentions "command(s)". See
 * BARE_WORD_LIST_RE above for the false-positive rationale.
 */
export function extractBareWordCommandCitations(markdown) {
  const cited = new Set()
  for (const m of markdown.matchAll(BARE_WORD_LIST_RE)) {
    const contextStart = Math.max(0, m.index - COMMAND_CONTEXT_WINDOW)
    if (!COMMAND_CONTEXT_RE.test(markdown.slice(contextStart, m.index))) continue
    for (const wordMatch of m[1].matchAll(/`([a-z][a-z0-9-]*)`/g)) {
      cited.add(wordMatch[1])
    }
  }
  return cited
}

/**
 * AC-2231.5 (#2231): extract `arbiter <cmd> <sub>` pairs from backtick-prose
 * citations. Returns Map<firstToken, Set<secondToken>> — second tokens that
 * pass the [a-z] command-like lead only (issue args, --flags and <args> are
 * structurally excluded by COMMAND_MENTION_RE's second capture).
 */
export function extractCitedSubcommands(markdown) {
  const pairs = new Map()
  for (const m of markdown.matchAll(COMMAND_MENTION_RE)) {
    if (PROSE_STOPWORDS.has(m[1])) continue
    if (m[2] === undefined) continue
    if (!pairs.has(m[1])) pairs.set(m[1], new Set())
    pairs.get(m[1]).add(m[2])
  }
  return pairs
}

// Matches the two adjacent string-literal array elements of a commander-CLI
// spawn call — `spawnSync('npx', ['--no-install', 'arbiter', 'doc-set', ...])`
// — the shape every thin-runner .mjs.ejs template in src/templates/scripts/
// uses to shell out to this CLI (design §2.2, T5b′, #1944). This is the
// emission-boundary counterpart to COMMAND_MENTION_RE's backtick-prose match:
// a template stranding a citation here breaks every governed repo's emitted
// runner, not just a doc's prose promise. No stopword filtering needed — an
// array-literal token immediately after `'arbiter',` is never styled prose.
// AC-2231.5 (#2231): an optional third element captures a subcommand token —
// `['--no-install', 'arbiter', 'task', 'record-red', ...]`. Flag/arg elements
// (`'--freshness'`, `...args`) never match the [a-z] lead, so the optional
// group stays empty for today's thin-runner shapes.
const SPAWN_ARRAY_RE = /'arbiter',\s*'([a-z][a-z0-9-]*)'(?:,\s*'([a-z][a-z0-9-]*)')?/g

export function extractSpawnedCommands(source) {
  return new Set([...source.matchAll(SPAWN_ARRAY_RE)].map((m) => m[1]))
}

/**
 * AC-2231.5 (#2231): subcommand-token counterpart of extractSpawnedCommands —
 * `['--no-install', 'arbiter', 'task', 'record-red', ...]` cites a
 * subcommand; a phantom there would break every governed repo's emitted
 * runner exactly like a phantom first token would.
 */
export function extractSpawnedSubcommands(source) {
  const pairs = new Map()
  for (const m of source.matchAll(SPAWN_ARRAY_RE)) {
    if (m[2] === undefined) continue
    if (!pairs.has(m[1])) pairs.set(m[1], new Set())
    pairs.get(m[1]).add(m[2])
  }
  return pairs
}

// #2408: COMMAND_MENTION_RE anchors on a literal backtick, so it can only ever
// see INLINE citations — and every install instruction, runbook step and skill
// recipe in the corpus lives inside a FENCED block, where the backtick is the
// fence itself and never precedes the command. That blind spot is what let
// `arbiter plugin add` sit on the public website and in an example README, and
// `arbiter invariants list` sit in a skill, with a green gate.
//
// Only shell-ish fences are parsed: an unlabeled fence or bash/sh/shell/console/
// zsh. A ```js or ```ts fence is a code SAMPLE — a string that happens to read
// like a command there is not an invocation promise. Inside a shell fence a line
// is matched only from its start (after stripping indentation and a `$ `/`> `
// prompt), so `# see arbiter frobnicate` (a comment) and prose never match.
const FENCE_RE = /^\s*```(\S*)/
const SHELL_FENCE_LANGS = new Set(['', 'bash', 'sh', 'shell', 'console', 'zsh'])
const FENCED_COMMAND_RE =
  /^(?:npx\s+(?:--no-install\s+)?)?arbiter\s+([a-z][a-z0-9-]*)(?:\s+([a-z][a-z0-9-]*))?/
const FENCED_SCRIPT_RE = /\bnode\s+(scripts\/[A-Za-z0-9._/-]+\.mjs)/g
const PROMPT_RE = /^[$>]\s+/

/**
 * Parse fenced shell blocks for `arbiter <cmd> [sub]` invocations and
 * `node scripts/<x>.mjs` citations.
 *
 * @returns {{ commands: Set<string>, pairs: Map<string, Set<string>>, scripts: Set<string> }}
 */
export function extractFencedCitations(markdown) {
  const commands = new Set()
  const pairs = new Map()
  const scripts = new Set()
  let lang = null // null = outside a fence
  for (const raw of markdown.split('\n')) {
    const fence = raw.match(FENCE_RE)
    if (fence) {
      lang = lang === null ? fence[1].toLowerCase() : null
      continue
    }
    if (lang === null || !SHELL_FENCE_LANGS.has(lang)) continue
    const line = raw.trim().replace(PROMPT_RE, '')
    const m = line.match(FENCED_COMMAND_RE)
    if (m && !PROSE_STOPWORDS.has(m[1])) {
      commands.add(m[1])
      if (m[2] !== undefined) {
        if (!pairs.has(m[1])) pairs.set(m[1], new Set())
        pairs.get(m[1]).add(m[2])
      }
    }
    for (const s of line.matchAll(FENCED_SCRIPT_RE)) scripts.add(s[1])
  }
  return { commands, pairs, scripts }
}

/**
 * Compare cited command words against the real top-level command set.
 * Returns the sorted array of phantom (cited but nonexistent) names.
 */
export function findPhantomCommands(citedCommands, realCommandNames) {
  return [...citedCommands].filter((c) => !realCommandNames.has(c)).sort()
}

/**
 * AC-2231.5 (#2231): validate `arbiter <cmd> <sub>` pairs against the
 * subcommand tree extracted from cli.ts. Returns the sorted array of
 * `"<cmd> <sub>"` phantom pairs. Discrimination rules:
 *
 * - aliases resolve to their canonical command first (`arbiter wt list` is
 *   `worktree list`; `arbiter verify tdd` is `validate tdd` — cli.ts:1172);
 * - a first token with NO subcommand tree skips validation entirely — its
 *   second token is a positional argument, not a verb (e.g. `arbiter ship 1`);
 * - the second token has already passed the [a-z] command-like lead in
 *   extractCitedSubcommands, so `#NNN` / `--flag` / `<arg>` never reach here.
 */
export function findPhantomSubcommands(citedPairs, subcommandsByCommand, aliasToCanonical) {
  const phantoms = []
  for (const [cmd, subs] of citedPairs) {
    const canonical = aliasToCanonical.get(cmd) ?? cmd
    const tree = subcommandsByCommand.get(canonical)
    if (!tree || tree.size === 0) continue
    for (const sub of [...subs].sort()) {
      if (!tree.has(sub)) phantoms.push(`${cmd} ${sub}`)
    }
  }
  return phantoms.sort()
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
  // #2408: under examples/, only the hand-authored README.md files — the rest of
  // the tree is generated init output (see the EXAMPLES_ROOT comment above).
  const suffixes = root === EXAMPLES_ROOT ? ['README.md'] : SCANNABLE_SUFFIXES
  return walkRepo(abs)
    .filter((rel) => suffixes.some((suf) => rel.endsWith(suf)))
    .map((rel) => join(abs, rel))
    .filter((abs2) => !SKIP_PATH_SEGMENTS.some((seg) => abs2.includes(seg)))
}

function main() {
  const allow = loadDocGateAllowlist('phantom-command')
  process.stdout.write(allowlistSummary('check-phantom-command-scan', allow))

  if (!existsSync(CLI_TS)) {
    process.stdout.write(`[check-phantom-command-scan] ERROR: cli source not found: ${CLI_TS}\n`)
    process.exit(2)
  }
  const cliSrc = readFileSync(CLI_TS, 'utf-8')
  const { topLevelNames } = extractTopLevelCommandNames(cliSrc)
  const aliases = extractCommandAliases(cliSrc)
  const aliasToCanonical = extractCommandAliasMappings(cliSrc)
  if (topLevelNames.size === 0) {
    throw new Error('extracted zero top-level commands from cli.ts — parser out of date')
  }
  const realCommandNames = new Set([...topLevelNames, ...aliases, ...ALWAYS_VALID])

  // AC-2231.5 (#2231): subcommand tree per top-level command — the extension
  // that catches `arbiter review code` (the multi-pass dispatch removed in
  // #1817) while leaving `arbiter review diff` and `arbiter task resume` alone.
  const subcommandsByCommand = new Map()
  for (const name of topLevelNames) {
    const subs = extractSubcommandNames(cliSrc, name)
    if (subs.size > 0) subcommandsByCommand.set(name, subs)
  }

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
    // #2408: an allowlisted file is skipped BEFORE templateCitedCommands is
    // populated. Filtering later would let an excused template citation reach the
    // T5b″ ledger cross-check, which would then demand a row for a command that
    // deliberately does not exist — turning one dated excuse into two hard failures.
    if (allow.has(relPath(file))) continue
    const content = readFileSync(file, 'utf-8')
    const cited = extractCitedCommands(content)
    // AC-2231.5 (#2231): subcommand-token validation runs in the same pass.
    const citedSubs = extractCitedSubcommands(content)
    // T5b′: also match the spawn-array shape (`'arbiter', 'doc-set'`) thin-runner
    // .mjs.ejs templates use to shell out — a phantom here breaks every governed
    // repo's emitted runner, not just a prose promise.
    for (const c of extractSpawnedCommands(content)) cited.add(c)
    for (const [cmd, subs] of extractSpawnedSubcommands(content)) {
      if (!citedSubs.has(cmd)) citedSubs.set(cmd, new Set())
      for (const s of subs) citedSubs.get(cmd).add(s)
    }
    // #2408: fenced shell blocks — the class the backtick anchor was blind to.
    const fenced = extractFencedCitations(content)
    for (const c of fenced.commands) cited.add(c)
    for (const [cmd, subs] of fenced.pairs) {
      if (!citedSubs.has(cmd)) citedSubs.set(cmd, new Set())
      for (const s of subs) citedSubs.get(cmd).add(s)
    }
    // A `node scripts/<x>.mjs` path inside a TEMPLATE is relative to the
    // CONSUMER's emitted tree (e.g. `scripts/smoke.mjs` in a runbook), not to
    // arbiter's — resolving it here would flag a file that is correct by design.
    // Verifying those is the emitted-tree resolver's job (M-B), not this gate's.
    if (!file.includes(`${sep}src${sep}templates${sep}`)) {
      for (const script of [...fenced.scripts].sort()) {
        if (existsSync(join(CWD, script))) continue
        process.stdout.write(`  phantom (script): ${relPath(file)}: \`${script}\` does not exist\n`)
        violations++
      }
    }
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
    // AC-2243.1 (#2243): bare-word citations (no `arbiter ` prefix) validated
    // against the same realCommandNames SSOT, reported distinctly so a phantom
    // here doesn't read as if it had the (absent) `arbiter ` prefix.
    const bareWordPhantoms = findPhantomCommands(
      extractBareWordCommandCitations(content),
      realCommandNames,
    )
    for (const phantom of bareWordPhantoms) {
      process.stdout.write(
        `  phantom (bare-word): ${relPath(file)}: \`${phantom}\` is not a registered command\n`,
      )
      violations++
    }
    const subPhantoms = findPhantomSubcommands(citedSubs, subcommandsByCommand, aliasToCanonical)
    for (const pair of subPhantoms) {
      const [cmd, sub] = pair.split(' ')
      process.stdout.write(
        `  phantom: ${relPath(file)}: \`arbiter ${cmd} ${sub}\` — \`${sub}\` is not a registered subcommand of \`${cmd}\`\n`,
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

const isMain = isMainModule(import.meta.url)
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
