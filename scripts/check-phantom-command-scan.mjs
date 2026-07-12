#!/usr/bin/env node
// CATALOG: scans hand-authored prose (PRIVACY.md, docs/, website/, .claude/) for `arbiter <cmd>` citations of commands absent from src/cli.ts (INV-111 ext).
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
// police, they just happen to live outside docs/. Only .claude/*.md is scanned
// (materialized, hand-read files) — the .ejs template SOURCES under
// src/templates/claude/ render TO those .md files but are not markdown
// themselves, so they are out of collectMarkdownFiles' reach by construction,
// not by an explicit exclusion.
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
// Usage:
//   node scripts/check-phantom-command-scan.mjs
//   node scripts/check-phantom-command-scan.mjs --cli=path --roots=a,b,c   (fixtures)
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { walkRepo } from './lib/glob-walk.mjs'
import { extractTopLevelCommandNames, extractCommandAliases } from './lib/cli-command-names.mjs'

function argValue(flag) {
  const arg = process.argv.find((a) => a.startsWith(`--${flag}=`))
  return arg ? arg.split('=')[1] : null
}

const CWD = resolve('.')
const CLI_TS = argValue('cli') ? resolve(argValue('cli')) : resolve(CWD, 'src', 'cli.ts')
const ROOTS = argValue('roots')
  ? argValue('roots').split(',')
  : ['PRIVACY.md', 'docs', 'website', '.claude']

// Path segments excluded from the scan (see header comment): decision/roadmap
// archives and the changelog, none of which assert *current* CLI behavior.
const SKIP_PATH_SEGMENTS = [`${sep}internal${sep}`, `${sep}changelog${sep}`]

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

/**
 * Compare cited command words against the real top-level command set.
 * Returns the sorted array of phantom (cited but nonexistent) names.
 */
export function findPhantomCommands(citedCommands, realCommandNames) {
  return [...citedCommands].filter((c) => !realCommandNames.has(c)).sort()
}

function collectMarkdownFiles(root) {
  const abs = resolve(CWD, root)
  if (!existsSync(abs)) return []
  if (statSync(abs).isFile()) return abs.endsWith('.md') ? [abs] : []
  return walkRepo(abs)
    .filter((rel) => rel.endsWith('.md'))
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

  const files = ROOTS.flatMap(collectMarkdownFiles)
  if (files.length === 0) {
    process.stdout.write('[check-phantom-command-scan] no docs found under scan roots — skipping\n')
    process.exit(0)
  }

  let violations = 0
  for (const file of files) {
    const content = readFileSync(file, 'utf-8')
    const cited = extractCitedCommands(content)
    const phantoms = findPhantomCommands(cited, realCommandNames)
    for (const phantom of phantoms) {
      const rel = file.startsWith(CWD + sep) ? file.slice(CWD.length + 1) : file
      process.stdout.write(
        `  phantom: ${rel}: \`arbiter ${phantom}\` is not a registered command\n`,
      )
      violations++
    }
  }

  if (violations > 0) {
    process.stdout.write(
      `[check-phantom-command-scan] FAIL: ${violations} phantom command citation(s) found\n`,
    )
    process.exit(1)
  }
  process.stdout.write(
    `[check-phantom-command-scan] OK — every cited command exists in cli.ts (${files.length} file(s) scanned)\n`,
  )
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
