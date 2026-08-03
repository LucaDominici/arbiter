#!/usr/bin/env node
// CATALOG: regenerates/validates the derived marker regions in website/ pages — active-experiments table (from src/experimental/registry.ts) and kit dimension count (from src/kit/catalog.json) (#1838).
// CATALOG: rejected fold-in into gen-cli-ref.mjs (single-purpose cli.md region keyed to cli.ts command parsing; these regions derive from entirely different SSOTs).
// CATALOG: rejected fold-in into gen-status.mjs (internal product dashboard derived from FEATURE_MATRIX/MILESTONES, docs/internal-only — not public website pages).
//
// Gate (F2 #1838, item 6): pages whose facts derive from code registries are
// EMITTED by this generator, with --check wired in L1 — so they can never
// silently contradict the registry again. Two derived regions:
//
//   1. website/reference/experimental-policy.md — the "Active Experiments"
//      table, derived from src/experimental/registry.ts. F1 (#1837) fixed the
//      page by hand ("No experiments are currently active" while `kit` had
//      been registered since 0.1.0) and left TODO(#1838) for this generator.
//   2. website/features/index.md — the kit dimension count ("78 dimensions"),
//      derived from src/kit/catalog.json. F1 fixed the hardcoded 77 by hand.
//
// Regions are marker-delimited (BEGIN/END GENERATED:<name>) like gen-cli-ref;
// hand-written prose outside the markers is preserved on every regeneration.
//
// Usage:
//   node scripts/gen-derived-pages.mjs           # rewrite marker regions
//   node scripts/gen-derived-pages.mjs --check   # exit 1 if any region is stale
//
// Exit codes (INV-53): 0 = OK / 1 = drift / 2 = invocation error
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { isMainModule } from './lib/run-helpers.mjs'

const CHECK = process.argv.includes('--check')

function argPath(flag, fallback) {
  const arg = process.argv.find((a) => a.startsWith(`--${flag}=`))
  return arg ? resolve(arg.split('=')[1]) : fallback
}

const REGISTRY_TS = argPath('registry', resolve('src/experimental/registry.ts'))
const CATALOG_JSON = argPath('catalog', resolve('src/kit/catalog.json'))
const POLICY_MD = argPath('policy', resolve('website/reference/experimental-policy.md'))
const FEATURES_MD = argPath('features', resolve('website/features/index.md'))

// ── SSOT readers ─────────────────────────────────────────────────────────────

/**
 * Parse the EXPERIMENTS array out of src/experimental/registry.ts source text
 * (same no-build-step source-parsing precedent as gen-cli-ref.mjs on cli.ts).
 * Fails closed: a shape change that yields zero experiments throws — the
 * registry has had ≥1 entry since 0.1.0, so zero means the parser broke.
 */
export function parseExperiments(src) {
  const arrayMatch = src.match(/EXPERIMENTS[^=]*=\s*\[([\s\S]*?)\n\]/)
  if (!arrayMatch) throw new Error('EXPERIMENTS array not found in registry.ts')
  const body = arrayMatch[1]
  const experiments = []
  for (const objMatch of body.matchAll(/\{([\s\S]*?)\}/g)) {
    const obj = objMatch[1]
    const field = (name) => {
      const m = obj.match(new RegExp(`${name}:\\s*'([^']*)'`))
      return m ? m[1] : null
    }
    const record = {
      name: field('name'),
      stabilityTarget: field('stabilityTarget'),
      addedIn: field('addedIn'),
      promotionCriteria: field('promotionCriteria'),
      plannedReviewDate: field('plannedReviewDate'),
    }
    if (!record.name) throw new Error('experiment entry with no name — parser out of date')
    experiments.push(record)
  }
  if (experiments.length === 0) {
    throw new Error('extracted zero experiments from registry.ts — parser out of date')
  }
  return experiments
}

/** Count kit dimensions from src/kit/catalog.json (fail-closed on zero). */
export function countKitDimensions(catalogRaw) {
  const catalog = JSON.parse(catalogRaw)
  const dims = Array.isArray(catalog) ? catalog : catalog.dimensions
  if (!Array.isArray(dims) || dims.length === 0) {
    throw new Error('kit catalog has no dimensions array — parser out of date')
  }
  return dims.length
}

// ── region builders ──────────────────────────────────────────────────────────

export function buildExperimentsRegion(experiments) {
  const lines = [
    'The authoritative list is the registry in `src/experimental/registry.ts`;',
    'experiments are opted in per-invocation via the `--experimental.<name>` flag',
    '(e.g. `arbiter --experimental.kit kit list`). Currently active:',
    '',
    '| Experiment | Stability target | Added in | Planned review | Promotion criteria |',
    '| ---------- | ---------------- | -------- | -------------- | ------------------ |',
  ]
  for (const e of experiments) {
    lines.push(
      `| \`${e.name}\` | ${e.stabilityTarget} | ${e.addedIn} | ${e.plannedReviewDate} | ${e.promotionCriteria} |`,
    )
  }
  return lines.join('\n')
}

export function buildKitCountRegion(count) {
  return [
    `## Coverage matrix (${count} dimensions)`,
    '',
    `Beyond the named invariants, arbiter tracks a machine-generated catalogue of **${count} security and`,
    'quality dimensions** — each with its gate tier (L1/L2/L3), BLOCKING/ADVISORY status, and per-stack',
    'coverage, rendered into `docs/REFERENCE/GLOBAL_KIT.md` from the same source arbiter uses for itself.',
  ].join('\n')
}

// ── marker plumbing (same contract as gen-cli-ref) ───────────────────────────

export function replaceMarkerRegion(docSrc, name, newContent) {
  const begin = `<!-- BEGIN GENERATED:${name} -->`
  const end = `<!-- END GENERATED:${name} -->`
  const beginIdx = docSrc.indexOf(begin)
  const endIdx = docSrc.indexOf(end)
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    throw new Error(`marker region GENERATED:${name} not found (or malformed) in target doc`)
  }
  return docSrc.slice(0, beginIdx + begin.length) + '\n' + newContent + '\n' + docSrc.slice(endIdx)
}

// ── main ─────────────────────────────────────────────────────────────────────

/**
 * Format a full doc with the repo's prettier config, so the generator's output
 * is byte-identical to what the `format` gate (prettier --check .) demands —
 * without this, prettier's markdown table padding and the freshness --check
 * would fight each other forever (each declaring the other's output stale).
 */
async function prettify(docPath, content) {
  const prettier = await import('prettier')
  const config = (await prettier.resolveConfig(docPath)) ?? {}
  return prettier.format(content, { ...config, parser: 'markdown' })
}

async function processDoc(docPath, regionName, newContent) {
  const docSrc = readFileSync(docPath, 'utf-8')
  const updated = await prettify(docPath, replaceMarkerRegion(docSrc, regionName, newContent))
  if (updated === docSrc) {
    process.stdout.write(`  gen-derived-pages: ${regionName} region up to date\n`)
    return true
  }
  if (CHECK) {
    process.stdout.write(
      `  gen-derived-pages: ${regionName} region is STALE in ${docPath}\n` +
        `  Fix: node scripts/gen-derived-pages.mjs\n`,
    )
    return false
  }
  writeFileSync(docPath, updated)
  process.stdout.write(`  gen-derived-pages: ${regionName} region rewritten\n`)
  return true
}

async function main() {
  for (const [p, what] of [
    [REGISTRY_TS, 'experiment registry'],
    [CATALOG_JSON, 'kit catalog'],
    [POLICY_MD, 'experimental-policy doc'],
    [FEATURES_MD, 'features index doc'],
  ]) {
    if (!existsSync(p)) {
      process.stdout.write(`  gen-derived-pages: error — ${what} not found: ${p}\n`)
      process.exit(2)
    }
  }

  const experiments = parseExperiments(readFileSync(REGISTRY_TS, 'utf-8'))
  const kitCount = countKitDimensions(readFileSync(CATALOG_JSON, 'utf-8'))

  const okPolicy = await processDoc(POLICY_MD, 'experiments', buildExperimentsRegion(experiments))
  const okFeatures = await processDoc(FEATURES_MD, 'kit-count', buildKitCountRegion(kitCount))

  if (!okPolicy || !okFeatures) process.exit(1)
  process.stdout.write(
    `  gen-derived-pages: OK — ${experiments.length} experiment(s), ${kitCount} kit dimension(s)\n`,
  )
}

const isMain = isMainModule(import.meta.url)
if (isMain) {
  try {
    await main()
  } catch (err) {
    process.stderr.write(
      `  gen-derived-pages: ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(2)
  }
}
