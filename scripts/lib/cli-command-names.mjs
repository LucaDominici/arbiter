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
