#!/usr/bin/env node
// scripts/check-self-dogfood.mjs
// INV-45: Every EJS template under src/templates/claude/ must render (with
// arbiter's own config) to content that matches its materialized .claude/ file.
//
// Exits 1 if unexpected drift is found. Files listed in .dogfood-divergences.json
// are skipped (intentional arbiter-internal extensions).
//
// Exports for unit tests:
//   buildRenderContext, templateToMaterialized, isAllowlisted,
//   isConfigGated, normalizeLines, computeDiff

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Read a script name from package.json and return "npm run <name>".
 * Falls back to `fallback` if the script does not exist.
 */
export function getNpmScript(name, fallback) {
  const pkgPath = join(repoRoot, 'package.json')
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    if (pkg.scripts && pkg.scripts[name]) {
      return `npm run ${name}`
    }
  } catch {
    // ignore
  }
  return fallback
}

/**
 * Build an EJS render context from arbiter's own config (arbiter.json).
 * Mirrors the fields that claude/*.ejs templates reference.
 */
export function buildRenderContext(cfg = {}) {
  const governanceLevel = cfg.governanceLevel ?? 'L2'
  const language = cfg.language ?? 'typescript'
  const buildTool = cfg.buildTool ?? 'npm'
  const tools = cfg.tools ?? ['claude']
  const features = cfg.features ?? {}

  return {
    projectName: cfg.projectName ?? 'arbiter',
    description: cfg.description ?? 'arbiter project',
    language,
    framework: cfg.framework ?? null,
    archetype: cfg.archetype ?? 'library',
    architectureStyle: cfg.architectureStyle ?? 'none',
    isMultiTenant: cfg.isMultiTenant ?? false,
    hasDatabase: cfg.hasDatabase ?? false,
    hasPublicApi: cfg.hasPublicApi ?? false,
    buildTool,
    buildCommand: cfg.buildCommand ?? getNpmScript('build', 'npm run build'),
    testCommand: cfg.testCommand ?? getNpmScript('test', 'npm test'),
    lintCommand: cfg.lintCommand ?? getNpmScript('lint', 'npx eslint src'),
    formatCommand: cfg.formatCommand ?? getNpmScript('format', 'npx prettier --write .'),
    tools,
    governanceLevel,
    useGitHub: cfg.useGitHub ?? true,
    githubOwner: cfg.githubOwner ?? null,
    githubRepo: cfg.githubRepo ?? null,
    lanes: cfg.lanes ?? [],
    // languageHooks: rendered inline in templates that need it
    languageHooks: cfg.languageHooks ?? [],
    enableDebtGates: cfg.enableDebtGates ?? governanceLevel !== 'L1',
    enableSuppressions: cfg.enableSuppressions ?? true,
    enableSecurityScanning: cfg.enableSecurityScanning ?? features.securityScanning ?? true,
    enableEvidenceHarness: features.evidenceHarness ?? false,
    enableMutationTesting: cfg.enableMutationTesting ?? false,
    enableContractTesting: cfg.enableContractTesting ?? false,
    invariantTiers: cfg.invariantTiers ?? ['architectural', 'governance', 'data', 'operational'],
    existing: cfg.existing ?? {
      agentsMd: true,
      claudeDir: true,
      agentsDir: false,
      aiRulez: false,
      settingsJson: true,
      checkAllScript: true,
      geminiDir: false,
      windsurfRules: false,
      aiderConf: false,
    },
  }
}

/**
 * Convert a template path like /repo/src/templates/claude/hooks/lib.mjs.ejs
 * to the materialized path /repo/.claude/hooks/lib.mjs
 */
export function templateToMaterialized(templatePath) {
  const marker = 'src/templates/claude/'
  const idx = templatePath.indexOf(marker)
  if (idx === -1) {
    throw new Error(`Template path does not contain '${marker}': ${templatePath}`)
  }
  const rel = templatePath.slice(idx + marker.length)
  const withoutEjs = rel.endsWith('.ejs') ? rel.slice(0, -4) : rel
  // Reconstruct using repoRoot derived from template path
  const repoRootFromTemplate = templatePath.slice(0, idx)
  return join(repoRootFromTemplate, '.claude', withoutEjs)
}

/**
 * Returns true if the line should be excluded from comparison.
 * Allowlists:
 *   - Lines containing 'LucaDominici/arbiter' (repo-specific tokens)
 *   - Lines containing absolute paths (system-specific)
 */
export function isAllowlisted(line) {
  if (line.includes('LucaDominici/arbiter')) return true
  // Absolute path: starts with / or contains an obvious absolute path pattern
  if (/(?:^|\s|['"])\/[^\s'"]{3,}/.test(line)) return true
  return false
}

/**
 * Returns true when the template should be skipped for this render context.
 * Currently: guard-done-evidence.mjs is only emitted when enableEvidenceHarness=true.
 */
export function isConfigGated(templatePath, ctx) {
  if (templatePath.endsWith('hooks/guard-done-evidence.mjs.ejs') && !ctx.enableEvidenceHarness) {
    return true
  }
  return false
}

/**
 * Normalize file content to a stable line array for diffing:
 *  1. Run through Prettier (handles table padding, quote normalization, etc.)
 *  2. Split on newlines
 *  3. Trim trailing whitespace
 *  4. Drop blank lines
 *  5. Filter allowlisted lines
 */
export async function normalizeLines(content, filePath) {
  let formatted = content
  try {
    const prettier = await import('prettier')
    const parser = filePath.endsWith('.json')
      ? 'json'
      : filePath.endsWith('.mjs') || filePath.endsWith('.js')
        ? 'babel'
        : 'markdown'
    formatted = await prettier.format(content, {
      parser,
      printWidth: 80,
      tabWidth: 2,
      useTabs: false,
      singleQuote: false,
      trailingComma: 'all',
      semi: true,
    })
  } catch {
    // Prettier unavailable or parse error — use raw content
    formatted = content
  }

  return formatted
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0)
    .filter((l) => !isAllowlisted(l))
}

/**
 * Compute line-level diff between expected and actual.
 *
 * Position-aware via occurrence counts: an extra duplicate of a line
 * in `actual` (e.g. [x,y,x] vs [x,y]) counts as drift, not a no-op.
 * A Set-based comparison would silently consider them equal because
 * both contain the same UNIQUE set of lines — INV-45 would pass on
 * duplicate-line drift.
 *
 * Returns null when the line bags are identical (same count per line),
 * or {added, removed} where `removed` lists lines present in `expected`
 * but missing/short in `actual`, and `added` lists the converse.
 */
export function computeDiff(expected, actual) {
  /** @param {string[]} arr */
  function toCounts(arr) {
    const m = new Map()
    for (const line of arr) m.set(line, (m.get(line) ?? 0) + 1)
    return m
  }

  const expectedCounts = toCounts(expected)
  const actualCounts = toCounts(actual)

  const removed = []
  const added = []

  for (const [line, ec] of expectedCounts) {
    const ac = actualCounts.get(line) ?? 0
    if (ec > ac) {
      // expected has ec copies, actual has ac (< ec) → ec - ac removed.
      for (let i = 0; i < ec - ac; i++) removed.push(line)
    }
  }
  for (const [line, ac] of actualCounts) {
    const ec = expectedCounts.get(line) ?? 0
    if (ac > ec) {
      for (let i = 0; i < ac - ec; i++) added.push(line)
    }
  }

  if (removed.length === 0 && added.length === 0) return null
  return { added, removed }
}

// ─── divergences manifest ────────────────────────────────────────────────────

function loadDivergences() {
  const manifestPath = join(repoRoot, '.dogfood-divergences.json')
  if (!existsSync(manifestPath)) return new Set()
  const entries = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  // Convert relative paths like "hooks/lib.mjs" to absolute .claude/ paths
  return new Set(entries.map((e) => join(repoRoot, '.claude', e.path)))
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  // Lazy-load ejs so the exported helpers work without it
  const ejs = (await import('ejs')).default

  const templatesDir = join(repoRoot, 'src/templates/claude')

  function findEjs(dir) {
    const results = []
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        results.push(...findEjs(full))
      } else if (full.endsWith('.ejs')) {
        results.push(full)
      }
    }
    return results
  }
  const templates = findEjs(templatesDir).sort()

  // Load arbiter's own config
  const arbiterConfig = JSON.parse(readFileSync(join(repoRoot, 'arbiter.json'), 'utf-8'))

  const ctx = buildRenderContext({
    governanceLevel: arbiterConfig.governanceLevel ?? 'L2',
    language: 'typescript',
    buildTool: 'npm',
    tools: arbiterConfig.tools ?? ['claude'],
    features: arbiterConfig.features ?? {},
    projectName: 'arbiter',
    archetype: arbiterConfig.archetype ?? 'library',
    lanes: arbiterConfig.lanes ?? [],
    languageHooks: [
      {
        name: 'check-no-orphan-todo.mjs',
        description: 'Every TODO must reference a task ID',
        body: '',
      },
    ],
  })

  const divergences = loadDivergences()

  let skipped = 0
  let checked = 0
  const drifted = []

  for (const templatePath of templates) {
    const materialized = templateToMaterialized(templatePath)

    // Skip config-gated templates
    if (isConfigGated(templatePath, ctx)) {
      skipped++
      continue
    }

    // Skip EJS include partials — rendered inline by a parent template, no standalone materialized output
    if (templatePath.includes('/post-commit-checklists/')) {
      skipped++
      continue
    }

    // Skip templates whose materialized files are known divergences
    if (divergences.has(materialized)) {
      skipped++
      continue
    }

    // Check if materialized file exists
    if (!existsSync(materialized)) {
      const relMat = relative(repoRoot, materialized)
      drifted.push({
        template: relative(repoRoot, templatePath),
        materialized: relMat,
        reason: 'materialized file does not exist',
      })
      continue
    }

    // Render template
    let rendered
    try {
      const source = readFileSync(templatePath, 'utf-8')
      rendered = ejs.render(source, ctx, { filename: templatePath })
    } catch (err) {
      const relT = relative(repoRoot, templatePath)
      drifted.push({
        template: relT,
        materialized: relative(repoRoot, materialized),
        reason: `render error: ${err.message}`,
      })
      continue
    }

    const materializedContent = readFileSync(materialized, 'utf-8')

    const expectedLines = await normalizeLines(rendered, materialized)
    const actualLines = await normalizeLines(materializedContent, materialized)
    const diff = computeDiff(expectedLines, actualLines)

    if (diff) {
      drifted.push({
        template: relative(repoRoot, templatePath),
        materialized: relative(repoRoot, materialized),
        added: diff.added.slice(0, 5),
        removed: diff.removed.slice(0, 5),
      })
    } else {
      checked++
    }
  }

  process.stdout.write(`[dogfood] ${skipped} template(s) skipped (config-gated or diverged).
`)

  if (drifted.length > 0) {
    console.error(`[dogfood] FAIL — ${drifted.length} template(s) have unexpected drift:`)
    for (const d of drifted) {
      console.error(`\n  template:     ${d.template}`)
      console.error(`  materialized: ${d.materialized}`)
      if (d.reason) {
        console.error(`  reason:       ${d.reason}`)
      } else {
        if (d.removed && d.removed.length > 0) {
          console.error(`  removed lines (in rendered but not in materialized):`)
          d.removed.forEach((l) => console.error(`    - ${l}`))
        }
        if (d.added && d.added.length > 0) {
          console.error(`  added lines (in materialized but not in rendered):`)
          d.added.forEach((l) => console.error(`    + ${l}`))
        }
      }
    }
    console.error(`\n  To suppress a known divergence, add an entry to .dogfood-divergences.json`)
    process.exit(1)
  }

  process.stdout.write(
    `[dogfood] ${checked} template(s) checked. All templates match materialized .claude/ files.\n`,
  )
}

// Run only when executed directly (not imported by tests)
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  main().catch((err) => {
    console.error('[dogfood] Fatal error:', err.message)
    process.exit(1)
  })
}
