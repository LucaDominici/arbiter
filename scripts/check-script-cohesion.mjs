#!/usr/bin/env node
// CATALOG: INV-94 / CANON-21 — script catalog cohesion gate.
// CATALOG: Aggregates the policy that no new scripts/check-*.mjs file may be
// CATALOG: added without an explicit fold-in-rejection justification, expressed
// CATALOG: as a // CATALOG: marker block in the script header.
// CATALOG: No sibling check-*.mjs script enforces script-namespace cohesion
// CATALOG: (closest analog is check-fail-closed-audit.mjs but that audits the
// CATALOG: BODY of every script for fail-open patterns, not the catalog shape),
// CATALOG: so this file is justified rather than folding into an existing one.
//
// Doctrine: every gate script added after the baseline freeze must carry a
// `// CATALOG:` marker block (>=3 contiguous lines, each starting with the
// case-insensitive `// CATALOG:` prefix) declaring what behaviour the script
// aggregates and why it cannot fold into a sibling. Pre-existing scripts are
// grandfathered through scripts/data/script-catalog-baseline.json — the
// baseline is a debt ledger, not a bypass.
//
// Checks:
//   * Every scripts/check-*.mjs file outside the baseline MUST contain a
//     `// CATALOG:` marker block of >=3 contiguous comment lines somewhere in
//     the first 30 lines of the file. A single isolated `// CATALOG:` line
//     does not satisfy the marker.
//   * The total count of scripts/check-*.mjs MAY exceed the baseline by up
//     to 5 silently. Above +5, the gate emits a soft warning (still exit 0)
//     encouraging a refactor pass before another addition. Above +10 the
//     warning is louder but the exit code stays 0 — INV-94 is a marker
//     contract, not a numerical cap.
//
// Exit codes (per INV-53): 0 PASS, 1 FAIL, 2 invocation / IO error.
//
// Usage:
//   node scripts/check-script-cohesion.mjs                       # audit
//   node scripts/check-script-cohesion.mjs --root <dir>          # alternate root
//   node scripts/check-script-cohesion.mjs --update-baseline     # rewrite baseline JSON
//
// Baseline grandfathering: every currently-existing scripts/check-*.mjs is
// listed in scripts/data/script-catalog-baseline.json. To deliberately widen
// the baseline (i.e. when a refactor pass has happened and new scripts are
// fully justified) regenerate with --update-baseline.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const rootArgIdx = args.indexOf('--root')
const ROOT = rootArgIdx >= 0 ? resolve(args[rootArgIdx + 1] ?? '.') : process.cwd()
const UPDATE = args.includes('--update-baseline')
const BASELINE_PATH = resolve(ROOT, 'scripts/data/script-catalog-baseline.json')

const HEAD_SCAN_LINES = 30
const SOFT_CAP_DELTA = 5

function listCheckScripts(scriptsDir) {
  let entries
  try {
    entries = readdirSync(scriptsDir)
  } catch (err) {
    if (err && /** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return []
    throw err
  }
  return entries
    .filter((name) => /^check-.+\.mjs$/.test(name))
    .map((name) => `scripts/${name}`)
    .sort((a, b) => a.localeCompare(b))
}

function hasCatalogMarker(content) {
  const lines = content.split('\n').slice(0, HEAD_SCAN_LINES)
  let run = 0
  for (const line of lines) {
    if (/^\s*\/\/\s*CATALOG\s*:/i.test(line)) {
      run++
      if (run >= 3) return true
    } else {
      run = 0
    }
  }
  return false
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) {
    return { schema: 'arbiter-script-catalog-baseline-v1', files: [] }
  }
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'))
  } catch (err) {
    process.stderr.write(
      `[script-cohesion] ERROR: baseline JSON unreadable at ${BASELINE_PATH}: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    )
    process.exit(2)
  }
  return { files: [] }
}

function writeBaseline(files) {
  const payload = {
    schema: 'arbiter-script-catalog-baseline-v1',
    generated_at: new Date().toISOString(),
    doctrine:
      'INV-94 / CANON-21 — grandfathered list of scripts/check-*.mjs at baseline freeze. ' +
      'New scripts added outside this list must carry a // CATALOG: marker block ' +
      '(>=3 contiguous // CATALOG: lines) explaining what is aggregated and why a sibling ' +
      'fold-in was rejected. To widen the baseline deliberately, regenerate with ' +
      '`node scripts/check-script-cohesion.mjs --update-baseline`.',
    files: [...files].sort((a, b) => a.localeCompare(b)),
  }
  writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`)
}

function main() {
  const scriptsDir = join(ROOT, 'scripts')
  const present = listCheckScripts(scriptsDir)

  if (UPDATE) {
    writeBaseline(present)
    process.stdout.write(
      `[script-cohesion] baseline updated: ${present.length} entries written to ${BASELINE_PATH}\n`,
    )
    process.exit(0)
  }

  const baseline = loadBaseline()
  const baselineSet = new Set(baseline.files ?? [])

  const violations = []
  for (const rel of present) {
    if (baselineSet.has(rel)) continue
    const abs = join(ROOT, rel)
    let content
    try {
      content = readFileSync(abs, 'utf-8')
    } catch (err) {
      process.stderr.write(
        `[script-cohesion] ERROR: cannot read ${rel}: ${
          err instanceof Error ? err.message : String(err)
        }\n`,
      )
      process.exit(2)
    }
    if (!hasCatalogMarker(content)) {
      violations.push(rel)
    }
  }

  // Soft cap warning — never affects exit code.
  const baselineCount = baseline.files?.length ?? 0
  const delta = present.length - baselineCount
  if (delta > SOFT_CAP_DELTA) {
    process.stdout.write(
      `[script-cohesion] WARN: scripts/check-*.mjs has grown by ${delta} above the baseline ` +
        `of ${baselineCount} (current: ${present.length}). Soft cap is +${SOFT_CAP_DELTA}. ` +
        `Consider a refactor pass to fold related scripts together before another addition. ` +
        `INV-94 baseline can be widened with --update-baseline once the new shape is reviewed.\n`,
    )
  }

  if (violations.length > 0) {
    process.stdout.write(
      `[script-cohesion] FAIL: ${violations.length} script(s) outside the INV-94 baseline ` +
        `lack a // CATALOG: marker block (>=3 contiguous // CATALOG: lines).\n`,
    )
    for (const v of violations) {
      process.stdout.write(`  - ${v}\n`)
    }
    process.stdout.write(
      `\nRemedy: add a header comment block such as:\n` +
        `  // CATALOG: what this script aggregates in one sentence.\n` +
        `  // CATALOG: rejected fold-in into <sibling>.mjs because <reason>.\n` +
        `  // CATALOG: rejected fold-in into <other-sibling>.mjs because <reason>.\n` +
        `Or, if the new file is legitimately grandfathered, regenerate the baseline ` +
        `with: node scripts/check-script-cohesion.mjs --update-baseline\n`,
    )
    process.exit(1)
  }

  process.stdout.write(
    `[script-cohesion] OK: ${present.length} scripts/check-*.mjs file(s); ` +
      `${baselineCount} grandfathered; ${present.length - baselineCount} new ` +
      `(all carry // CATALOG: markers).\n`,
  )
  process.exit(0)
}

try {
  main()
} catch (err) {
  process.stderr.write(
    `[script-cohesion] ERROR: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  )
  process.exit(2)
}
