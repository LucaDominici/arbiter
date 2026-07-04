#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// scripts/gen-llms-txt.mjs
// #1721: generate llms.txt (agent-native root index, llmstxt.org convention) from
// llms-txt.config.json (the sole hand-maintained input) + the live docs/INDEX.md doc
// count. Migrates the hand-authored llms.txt (bc5de27f, unmerged) to a generated,
// drift-checked artifact — dogfoods ADR-089 / PRD-DOCS-EVOLUTION's SSOT-core +
// generated-artifacts thesis.
//
// Usage:
//   node scripts/gen-llms-txt.mjs           # (re)write llms.txt
//   node scripts/gen-llms-txt.mjs --check   # exit 1 if llms.txt is stale, 2 on error
//
// Exported functions (for unit tests):
//   buildLlmsTxt(config, { docCount })          → string
//   readDocCount(indexPath)                     → number (throws if unparseable)
//   findMissingPaths(config, root)               → string[] (empty = all paths resolve)
//   runCli(configPath, indexPath, outPath, check) → Promise<0|1|2>  (INV-53: 0=OK/1=drift/2=error)
//
// llms.txt has NO trailing newline (byte-for-byte match with the hand-authored
// original) — never append one. Generated-only: never hand-edit llms.txt.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// Exported API
// ---------------------------------------------------------------------------

/** Render one `- [label](path)[, [extraLabel](extraPath)...]: description` bullet. */
function renderEntry(entry) {
  const extra = (entry.extraLinks ?? []).map(([label, path]) => `, [${label}](${path})`).join('')
  return `- [${entry.label}](${entry.path})${extra}: ${entry.description}`
}

/**
 * Build llms.txt content from the config + a mechanically-derived docCount.
 * No trailing newline. Sections separated by a blank line; bullets by a single
 * newline (no blank line between bullets in the same section).
 */
export function buildLlmsTxt(config, { docCount }) {
  const sections = config.sections.map(
    (s) => `## ${s.heading}\n\n${s.entries.map(renderEntry).join('\n')}`,
  )
  const body =
    `# ${config.title}\n\n` +
    `> ${config.summary}\n\n` +
    `${config.intro}\n\n` +
    sections.join('\n\n')
  return body.replace(/\{\{docCount\}\}/g, String(docCount))
}

/** Parse the `N documents.` line written by scripts/gen-doc-index.mjs. Throws if not found. */
export function readDocCount(indexPath) {
  const content = readFileSync(indexPath, 'utf-8')
  const m = content.match(/^(\d+) documents\.$/m)
  if (!m) {
    throw new Error(`could not parse doc count ("N documents.") from ${indexPath}`)
  }
  return Number(m[1])
}

/**
 * Extract relative markdown link targets `[label](target)` from prose (e.g. an entry
 * description). Skips http(s)/mailto URLs and anchor-only targets (`#foo`) — those
 * are not filesystem paths and are never existsSync-checked.
 */
function extractProseLinkTargets(text) {
  const targets = []
  const re = /\[[^\]]*\]\(([^)]+)\)/g
  let m
  while ((m = re.exec(text))) {
    const target = m[1]
    if (target.startsWith('#') || /^[a-z]+:/i.test(target)) continue
    targets.push(target)
  }
  return targets
}

/**
 * Validate every entry path (+ extraLinks paths + relative markdown links embedded in
 * the description prose) resolves under root, as a file or dir (trailing slash stripped
 * before existsSync). Returns the list of missing raw path strings (empty = all resolve).
 */
export function findMissingPaths(config, root) {
  const missing = []
  for (const s of config.sections) {
    for (const e of s.entries) {
      const paths = [
        e.path,
        ...(e.extraLinks ?? []).map(([, p]) => p),
        ...extractProseLinkTargets(e.description ?? ''),
      ]
      for (const p of paths) {
        const clean = p.replace(/\/$/, '')
        if (!existsSync(resolve(root, clean))) missing.push(p)
      }
    }
  }
  return missing
}

/** Load + parse the config file. Returns { config } or { error } (message only). */
function loadConfig(configPath) {
  if (!existsSync(configPath)) {
    return { error: `config not found: ${configPath}` }
  }
  try {
    return { config: JSON.parse(readFileSync(configPath, 'utf-8')) }
    // FAIL-OPEN-INTENT: error is returned (not thrown) — runCli() surfaces it to stderr and exits 2.
  } catch (err) {
    return {
      error: `invalid JSON in ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/** Wrap readDocCount()'s throw into a { docCount } / { error } shape. */
function loadDocCount(indexPath) {
  try {
    return { docCount: readDocCount(indexPath) }
    // FAIL-OPEN-INTENT: error is returned (not thrown) — runCli() surfaces it to stderr and exits 2.
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

/** --check mode: compare generated content against the committed outPath. */
function checkDrift(outPath, generated) {
  const current = existsSync(outPath) ? readFileSync(outPath, 'utf-8') : ''
  if (current !== generated) {
    process.stderr.write(
      'llms.txt is stale. Run `node scripts/gen-llms-txt.mjs` and commit the result.\n',
    )
    return 1
  }
  process.stdout.write('llms.txt is up to date.\n')
  return 0
}

/** Write mode: persist the generated content to outPath. */
function writeOutput(outPath, generated) {
  writeFileSync(outPath, generated)
  process.stdout.write(`Wrote ${outPath}\n`)
  return 0
}

/**
 * Execute the write or check logic. Returns 0/1/2 (INV-53: OK / drift / error).
 * Does not call process.exit — exported for testing.
 * Fail-closed (INV-96): config/parse/path errors return 2 rather than emitting a
 * partial or wrong llms.txt.
 */
export async function runCli(configPath, indexPath, outPath, check) {
  try {
    const { config, error: configErr } = loadConfig(configPath)
    if (configErr) {
      process.stderr.write(`gen-llms-txt: ${configErr}\n`)
      return 2
    }

    const { docCount, error: countErr } = loadDocCount(indexPath)
    if (countErr) {
      process.stderr.write(`gen-llms-txt: ${countErr}\n`)
      return 2
    }

    const root = resolve(configPath, '..')
    const missing = findMissingPaths(config, root)
    if (missing.length > 0) {
      process.stderr.write(
        `gen-llms-txt: path(s) in ${configPath} do not exist: ${missing.join(', ')}. Update the config.\n`,
      )
      return 2
    }

    const generated = buildLlmsTxt(config, { docCount })
    return check ? checkDrift(outPath, generated) : writeOutput(outPath, generated)
  } catch (err) {
    process.stderr.write(`gen-llms-txt: ${err instanceof Error ? err.message : String(err)}\n`)
    return 2
  }
}

// ---------------------------------------------------------------------------
// CLI entry point — guarded so imports don't trigger side-effects
// ---------------------------------------------------------------------------

const isMain = process.argv[1] === fileURLToPath(import.meta.url)

if (isMain) {
  // Allow overriding paths via --config=/--index=/--out= (used by tests with fixtures).
  const arg = (flag) => process.argv.find((a) => a.startsWith(flag))?.split('=')[1]
  const root = resolve('.')
  const configPath = arg('--config=')
    ? resolve(arg('--config='))
    : resolve(root, 'llms-txt.config.json')
  const indexPath = arg('--index=') ? resolve(arg('--index=')) : resolve(root, 'docs/INDEX.md')
  const outPath = arg('--out=') ? resolve(arg('--out=')) : resolve(root, 'llms.txt')
  runCli(configPath, indexPath, outPath, process.argv.includes('--check'))
    .then((code) => process.exit(code))
    .catch((err) => {
      // Safety net for unexpected promise rejections (INV-96 fail-closed).
      process.stderr.write(`gen-llms-txt: ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(2)
    })
}
