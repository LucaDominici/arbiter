// SPDX-License-Identifier: Apache-2.0
// Shared top-level command name extraction from src/cli.ts. Factored out of
// scripts/gen-cli-ref.mjs's parseCliTs (F2 #1838, CANON-16 refactor-first) so
// scripts/check-phantom-command-scan.mjs can reuse the exact same SSOT parser
// instead of re-implementing command-name detection with a second, divergent
// regex.

/**
 * Extract the set of top-level command names registered on `program` in
 * src/cli.ts source text. Returns { topLevelNames: Set<string>, hiddenNames: Set<string> }.
 *
 * Strategy: strip single-line comments, then find `program` (possibly via a
 * `const X = program...` alias) followed within ~50 chars by `.command('name')`,
 * optionally with `{ hidden: true }` (#1770 T5 — experimental surface). This
 * intentionally does NOT match `varName.command(...)` (sub-commands hung off
 * a returned command object, not new top-level commands).
 */
export function extractTopLevelCommandNames(src) {
  const stripped = src.replace(/\/\/.*/g, '')

  const topLevelRe =
    /\bprogram\s*[\s\S]{0,50}?\.command\('([^'\n]+?)'(,\s*\{\s*hidden:\s*true\s*\})?\)/g
  const topLevelNames = new Set()
  const hiddenNames = new Set()
  for (const m of stripped.matchAll(topLevelRe)) {
    // Strip argument specs (<required> [optional]) — use only the base command name.
    const baseName = m[1].trim().split(/[\s<[]/)[0]
    // The `help` meta-command replaces commander's built-in help; it is part
    // of the help mechanism itself (documented in prose), not a governed command.
    if (baseName === 'help') continue
    topLevelNames.add(baseName)
    if (m[2]) hiddenNames.add(baseName)
  }

  return { topLevelNames, hiddenNames }
}

/**
 * Extract every `.alias('name')` registered on a commander Command instance
 * in src/cli.ts (e.g. `.command('worktree').alias('wt')`, `.command('validate').alias('verify')`).
 * These are real, working invocations — `arbiter wt` and `arbiter verify` both
 * run today — but they are NOT separate entries in topLevelNames (gen-cli-ref's
 * generated reference table is keyed by the canonical .command() name only;
 * treating an alias as its own top-level command would make it try to render
 * a second, duplicate doc section with no matching block). Callers that need
 * "does this word actually invoke something" (check-phantom-command-scan.mjs)
 * should check topLevelNames ∪ this set; callers building the canonical
 * command table (gen-cli-ref.mjs) should keep using topLevelNames alone.
 */
export function extractCommandAliases(src) {
  const stripped = src.replace(/\/\/.*/g, '')
  const aliasRe = /\.alias\('([^'\n]+)'\)/g
  return new Set([...stripped.matchAll(aliasRe)].map((m) => m[1].trim()))
}

/**
 * Extract the set of `--flag` tokens registered via `.option(...)` on a single
 * top-level command's block in src/cli.ts (T5b'' #1944, flag-surface extension
 * of the CLI-emitted-surface ledger). Deliberately a smaller, standalone
 * extraction rather than exposing gen-cli-ref.mjs's parseCliTs block-scoping
 * regex: parseCliTs is already covered by its own render-parity tests and
 * builds a full {description, options, subcommands} shape for the doc
 * generator — reusing it here only for flag names would mean importing (and
 * being coupled to) machinery this caller doesn't need. This function shares
 * the same block-scoping strategy (bounded lookahead to the next `.command('`
 * registration) so both stay in sync by construction, not by cross-import.
 *
 * Returns null if the command itself isn't found in src (caller's job to
 * treat "command doesn't exist" as its own, distinct failure).
 */
export function extractCommandOptions(src, commandName) {
  const stripped = src.replace(/\/\/.*/g, '')
  const escaped = commandName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const blockRe = new RegExp(
    `\\.command\\('${escaped}(?: [^']*)?'(?:,\\s*\\{\\s*hidden:\\s*true\\s*\\})?\\)([\\s\\S]{0,6000}?)(?=\\.command\\('|const |var |let |\\bprogram\\b|$)`,
  )
  const m = blockRe.exec(stripped)
  if (!m) return null

  const flags = new Set()
  for (const om of m[0].matchAll(/\.option\(\s*['"]([^'"]+)['"]/g)) {
    // A flags spec may carry a short+long pair ("-y, --yes") or a value
    // slot ("--manifest <path>") — split on whitespace/comma and keep
    // only the `--long` token(s); short-only flags are not part of this
    // ledger's vocabulary (every emitted-surface citation seen to date uses
    // the long form).
    for (const tok of om[1].split(/[\s,]+/)) {
      if (tok.startsWith('--')) flags.add(tok)
    }
  }
  return flags
}

/**
 * Extract the subcommand tree for one top-level command from src/cli.ts
 * (AC-2231.5, #2231). The phantom-scan validates `arbiter <cmd> <sub>` pairs,
 * so it needs the commander chain structure, not just top-level names:
 *
 * - `const <alias> = program` (optionally followed by `.command('<name>')` in
 *   the same statement) binds a const to the command object;
 * - a col-0 bare identifier line followed by indented `.command(...)` lines
 *   (`task\n  .command('resume')`) registers subcommands on that object;
 * - commander's `.command()` returns the NEW subcommand, so chains hung
 *   directly on `program` (col-0 `program` head) register TOP-LEVEL commands,
 *   never subcommands.
 *
 * Returns the Set of subcommand base names. Hidden subcommands are included —
 * `arbiter task mark` genuinely runs even though `mark` is registered hidden,
 * and the phantom-scan's contract is "does this word actually invoke
 * something".
 */
export function extractSubcommandNames(src, topLevelName) {
  const stripped = src.replace(/\/\/.*/g, '')

  // 1. Find the const alias bound to this top-level command. The chain text
  //    after `program` extends over dot-leading continuation lines until the
  //    next col-0 statement.
  const constChainRe = /const\s+(\w+)\s*=\s*program([\s\S]*?)(?=\n\S|$)/g
  let alias = null
  for (const m of stripped.matchAll(constChainRe)) {
    const registered = m[2].match(/\.command\('([^' ]+)/)
    if (registered && registered[1] === topLevelName) {
      alias = m[1]
      break
    }
  }
  if (alias === null) return new Set()

  // 2. Subcommand chains: a col-0 identifier line followed by indented
  //    `.method(...)` lines. A `program` head is a top-level registration
  //    chain, not a subcommand chain.
  const subChainRe = /\n(\w+)\s*\n((?:\s*\.[a-zA-Z_$][\w$]*\([^\n]*\n?)+)/g
  const subs = new Set()
  for (const m of stripped.matchAll(subChainRe)) {
    if (m[1] !== alias) continue
    for (const cm of m[2].matchAll(/\.command\('([^' ]+)/g)) subs.add(cm[1])
  }
  return subs
}

/**
 * Extract alias→canonical command mappings from src/cli.ts (AC-2231.5,
 * #2231). `arbiter wt list` and `arbiter verify tdd` are real invocations
 * whose second token is a subcommand of the CANONICAL name (`worktree` /
 * `validate`) — the phantom-scan must resolve the alias before checking the
 * subcommand tree. Returns a Map<alias, canonicalTopLevelName>.
 *
 * The existing flat extractCommandAliases() stays for callers that only need
 * "does this word invoke something" (gen-cli-ref's canonical table is keyed by
 * the .command() name only); the mapping is derived from the same const-chain
 * shape as extractSubcommandNames — an `.alias('x')` inside a command's
 * registration chain belongs to the command registered in that same chain.
 */
export function extractCommandAliasMappings(src) {
  const stripped = src.replace(/\/\/.*/g, '')
  const map = new Map()
  const constChainRe = /const\s+\w+\s*=\s*program([\s\S]*?)(?=\n\S|$)/g
  for (const m of stripped.matchAll(constChainRe)) {
    const registered = m[1].match(/\.command\('([^' ]+)/)
    const alias = m[1].match(/\.alias\('([^' ]+)'\)/)
    if (registered && alias) map.set(alias[1], registered[1])
  }
  return map
}
