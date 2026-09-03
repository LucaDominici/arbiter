#!/usr/bin/env node
// scripts/check-self-dogfood.mjs
// INV-45: Every EJS template under src/templates/claude/ must render (with
// arbiter's own config) to content that matches its materialized .claude/ file.
//
// Exits 1 if unexpected drift is found.
// Exits 2 if dist/ is missing or stale relative to the src/ trees the R-02
// external CI-surface parity check depends on (#1984) — run "npm run build".
//
// CANON-14 auto-diff (F2 #1838, item 2): .dogfood-divergences.json is NOT a
// whole-file skip list. Each entry pins the sha256 of the exact approved diff
// (diffHash over the sorted added/removed normalized-line multiset). At every
// run the real template-vs-materialized diff is recomputed and compared:
//   - diff matches the pinned hash  → approved divergence, skipped
//   - diff CHANGED beyond the pin   → FAIL (new drift inside an allowlisted
//     file was previously invisible — the guard-done-evidence vs
//     stop-evidence-guard class of drift, per #1836 F2)
//   - diff is now EMPTY             → FAIL (stale entry: the divergence healed,
//     the entry must be removed or it suppresses all future drift)
//   - entry path never visited      → FAIL (dead entry: nothing pins it)
//   - entry `expires` in the past   → FAIL (T4 dogfood-closure: a STAGED divergence
//     is audit-mode with a deadline, not a destination — an expired carve-out must be
//     reconciled to the template or re-dated. Undated entries are permanent-by-design
//     self-hardening and are not expiry-checked. See classifyDivergence.)
// Regenerate pins after a human-approved change with:
//   node scripts/check-self-dogfood.mjs --update-divergences
//
// To check an isolated repository fixture without touching the current tree:
//   node scripts/check-self-dogfood.mjs --root <dir>
// `--root` defaults to arbiter's repository root, preserving normal gate behavior.
//
// Exports for unit tests:
//   buildRenderContext, templateToMaterialized, isAllowlisted,
//   isConfigGated, normalizeLines, computeDiff, checkRawHooks, REQUIRED_RAW_HOOKS,
//   hashDiff, classifyDivergence, exportedSymbols, missingExports,
//   exportSurfaceViolation, classifyAllowlistedPair, EXTERNAL_CI_FAMILIES, matchedFamilyBasenames,
//   checkExternalCiSurfaceParity

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, relative, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { walkRepo } from './lib/glob-walk.mjs'
import { checkDistFresh } from './lib/dist-staleness.mjs'
import { isMainModule } from './lib/run-helpers.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const defaultRepoRoot = join(__dirname, '..')

function resolveRepoRoot(argv) {
  const rootIndex = argv.indexOf('--root')
  if (rootIndex === -1) return defaultRepoRoot
  const root = argv[rootIndex + 1]
  if (!root || root.startsWith('--')) {
    throw new Error('missing directory after --root')
  }
  return resolve(root)
}

const repoRoot = resolveRepoRoot(process.argv)

// Raw .mjs hooks copied verbatim by src/generators/claude.ts (readTemplate →
// writeFile, no EJS render). The .ejs corpus walk never saw them, so they were
// historically unchecked (#1090, INV-45). Each must have a byte-identical
// materialized copy under .claude/hooks/, OR be listed in
// .dogfood-divergences.json as intentional arbiter-internal self-hardening.
export const REQUIRED_RAW_HOOKS = [
  'stop-dangerous.mjs',
  'enforce-read-only.mjs',
  'pre-edit-ssot-guard.mjs',
  'enforce-gate-before-pr.mjs',
  'check-no-unused-exports.mjs',
  'check-no-skipped-tests.mjs',
  'post-brainstorm-stop.mjs',
  'pre-spawn-worktree-guard.mjs',
  'post-subagent-release.mjs',
]

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
  const collaborationMode = cfg.collaborationMode ?? 'peer-review'
  const sourceExtensions =
    {
      typescript: ['.ts', '.tsx', '.mts', '.cts', '.mjs', '.cjs', '.js', '.jsx'],
      multi: ['.ts', '.tsx', '.mts', '.cts', '.mjs', '.cjs', '.js', '.jsx', '.java', '.kt', '.kts'],
      java: ['.java'],
      kotlin: ['.kt', '.kts', '.java'],
      rust: ['.rs'],
      go: ['.go'],
      python: ['.py'],
    }[language] ?? []

  return {
    projectName: cfg.projectName ?? 'arbiter',
    description: cfg.description ?? 'arbiter project',
    language,
    sourceExtensions,
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
    // ADR-051: collaboration-mode axis — read from arbiter.json so trunk-solo conditional
    // blocks in templates render correctly during dogfood parity checks. (#1216)
    collaborationMode,
    maxParallelWorktrees:
      cfg.automation?.maxParallelWorktrees ?? (collaborationMode === 'trunk-solo' ? 1 : 3),
    mergeMode: cfg.mergeMode ?? 'pr-ff',
    // #1290 — ship-driver template vars (src/templates/ship/): generator defaults.
    shipLabel: cfg.shipLabel ?? 'ship',
    harnessCmd: cfg.harnessCmd ?? 'claude',
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
 * Template-family roots: SSOT for BOTH path dispatch (templateToMaterialized)
 * AND the corpus walk in main(). Adding a family here both maps and ENUMERATES
 * it — a map-only or walk-only addition cannot leave a family unchecked (#1290).
 * Iterated in insertion order (deterministic).
 */
export const TEMPLATE_ROOTS = {
  'src/templates/claude/': '.claude',
  'src/templates/ship/': '.arbiter/ship',
}

/**
 * Convert a template path like /repo/src/templates/claude/hooks/lib.mjs.ejs
 * to its materialized path (e.g. /repo/.claude/hooks/lib.mjs), resolved via
 * TEMPLATE_ROOTS. Unknown template families throw (fail-closed).
 */
export function templateToMaterialized(templatePath) {
  for (const [marker, dest] of Object.entries(TEMPLATE_ROOTS)) {
    const idx = templatePath.indexOf(marker)
    if (idx === -1) continue
    const rel = templatePath.slice(idx + marker.length)
    const withoutEjs = rel.endsWith('.ejs') ? rel.slice(0, -4) : rel
    // Reconstruct using repoRoot derived from template path
    const repoRootFromTemplate = templatePath.slice(0, idx)
    return join(repoRootFromTemplate, dest, withoutEjs)
  }
  throw new Error(
    `Template path matches no TEMPLATE_ROOTS marker (${Object.keys(TEMPLATE_ROOTS).join(', ')}): ${templatePath}`,
  )
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
  // Shell scripts: compare raw and UNFILTERED — prettier has no shell parser, and
  // the absolute-path allowlist must not hide drift in an executable artifact
  // (an injected `exec /usr/bin/x` line would otherwise be invisible). The ship
  // templates contain no machine-specific absolute paths, so raw is safe (#1290).
  if (filePath.endsWith('.sh')) {
    return content
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.length > 0)
  }
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

// ─── divergences manifest (CANON-14 auto-diff, #1838) ───────────────────────

/**
 * Stable fingerprint of a computeDiff result. Sorting both line arrays makes
 * the hash independent of map-iteration order; normalizeLines has already
 * stripped environment-specific content (absolute paths, repo tokens), so the
 * hash is machine-independent. `null` (no diff) hashes to a distinct sentinel
 * so a healed divergence can never collide with a real one.
 */
export function hashDiff(diff) {
  if (diff === null) return 'no-diff'
  const canonical = JSON.stringify({
    added: [...diff.added].sort(),
    removed: [...diff.removed].sort(),
  })
  return createHash('sha256').update(canonical).digest('hex')
}

/**
 * Exported symbol names of an ES module, or `null` when the surface is not
 * statically knowable (`export * from` re-exports an unnamed set — guessing
 * there would read as a mass drop and over-block).
 */
export function exportedSymbols(content) {
  if (/^\s*export\s+\*/m.test(content)) return null
  const names = new Set()
  for (const m of content.matchAll(
    /^\s*export\s+(?:async\s+)?(?:function\s*\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
  )) {
    names.add(m[1])
  }
  for (const m of content.matchAll(/^\s*export\s*\{([^}]*)\}/gm)) {
    for (const spec of m[1].split(',')) {
      const trimmed = spec.trim()
      if (!trimmed) continue
      const renamed = trimmed.match(/\bas\s+([A-Za-z_$][\w$]*)\s*$/)
      names.add(renamed ? renamed[1] : trimmed.split(/\s+/)[0])
    }
  }
  if (/^\s*export\s+default\b/m.test(content)) names.add('default')
  return names
}

/**
 * Symbols the template exports that the materialized copy does not, minus any
 * the entry explicitly sanctions. Sorted; empty when nothing was dropped or
 * when either surface is unknowable.
 */
export function missingExports(templateContent, materializedContent, allowed = []) {
  const expected = exportedSymbols(templateContent)
  const actual = exportedSymbols(materializedContent)
  if (expected === null || actual === null) return []
  const sanctioned = new Set(allowed)
  return [...expected].filter((n) => !actual.has(n) && !sanctioned.has(n)).sort()
}

/**
 * #2327: the whole-file diffHash DOES notice a dropped export — but
 * `--update-divergences` then ABSORBS it. #2324 is the proof: `.claude/hooks/lib.mjs`
 * lost 5 exports the template ships, one of which (`isPathInThisRepo`) a sibling hook
 * imported, and the hook crashed on every Edit/Write for 18 days while each intervening
 * change was met with a re-pin.
 *
 * This check is deliberately NOT derived from the pinned hash, so re-pinning cannot
 * clear it. An approved divergence may ADD, REPLACE or REIMPLEMENT an export — it may
 * never silently DROP one the template ships. A reviewed, intentional drop is declared
 * per-entry in `allowedDroppedExports` (a human-only manifest edit;
 * `--update-divergences` never writes that field).
 *
 * Returns a violation `{reason}` or null. Applies to `.mjs` pairs only.
 */
export function exportSurfaceViolation(entry, materializedPath, templateContent, actualContent) {
  if (!materializedPath.endsWith('.mjs')) return null
  const missing = missingExports(templateContent, actualContent, entry.allowedDroppedExports)
  if (missing.length === 0) return null
  return {
    reason:
      `materialized copy drops export(s) the template ships: ${missing.join(', ')} — an ` +
      'approved divergence may add, replace or reimplement, never drop (#2327, the #2324 ' +
      'class). `--update-divergences` cannot clear this. Restore the export(s), or — if the ' +
      'drop is reviewed and intentional — name them in the entry\'s "allowedDroppedExports".',
  }
}

/**
 * Single entry point for the three corpora (EJS templates, raw hooks, external CI
 * surface) to resolve an ALLOWLISTED pair to a violation or null.
 *
 * Order matters: #2327's export-surface rule runs FIRST and is not derived from the
 * pinned hash, so `--update-divergences` can never clear it. Only when the export
 * surface is intact does the pinned-diff classification decide. A dropped-export path
 * is recorded in `exportDrops` so the re-pin pass skips it entirely.
 */
export function classifyAllowlistedPair({
  entry,
  materialized,
  templateContent,
  actualContent,
  diff,
  exportDrops,
}) {
  const drop = exportSurfaceViolation(entry, materialized, templateContent, actualContent)
  if (drop) {
    exportDrops.add(materialized)
    return drop
  }
  return classifyDivergence(entry, diff)
}

/**
 * Classify a recomputed diff against a divergence entry's pinned diffHash.
 * Returns null when the divergence is still exactly the approved one, or a
 * violation object {reason} otherwise. Exported for unit tests.
 *
 * Dated divergences (T4 dogfood-closure — audit-mode is a STAGE, not a destination):
 * an entry MAY carry an explicit `expires` (ISO `YYYY-MM-DD`). Past its expiry the entry
 * FAILS the gate — forcing a re-decision (reconcile self to the template, or re-date with a
 * fresh rationale) rather than a silently-lapsed carve-out. Checked BEFORE the diff logic so
 * an expired entry fails even while its pinned diff still matches. `now` is injectable for
 * deterministic tests; the gate uses the wall clock.
 */
export function classifyDivergence(entry, diff, now = Date.now()) {
  if (typeof entry.expires === 'string' && entry.expires.length > 0) {
    const expMs = Date.parse(entry.expires)
    if (Number.isNaN(expMs)) {
      return {
        reason: `divergence has an unparseable "expires" value (${entry.expires}) — use ISO YYYY-MM-DD`,
      }
    }
    if (expMs < now) {
      return {
        reason:
          `divergence expired on ${entry.expires} — audit-mode is a stage with a deadline, not a ` +
          'destination. Reconcile self to the template, or re-date the entry with a fresh rationale.',
      }
    }
  }
  const actualHash = hashDiff(diff)
  if (diff === null) {
    return {
      reason:
        'stale divergence entry — template and materialized file now match; ' +
        'remove the entry from .dogfood-divergences.json (a stale entry suppresses all future drift)',
    }
  }
  if (!entry.diffHash) {
    return {
      reason:
        'divergence entry has no pinned diffHash (CANON-14, #1838) — run ' +
        '`node scripts/check-self-dogfood.mjs --update-divergences` and review+commit the result',
    }
  }
  if (entry.diffHash !== actualHash) {
    return {
      reason:
        'divergence CHANGED beyond the approved pin — the template/materialized pair drifted ' +
        'further (or healed partially) since the diff was approved. Review the new diff; if ' +
        'intentional, re-pin with `node scripts/check-self-dogfood.mjs --update-divergences`',
      added: diff.added.slice(0, 5),
      removed: diff.removed.slice(0, 5),
    }
  }
  return null
}

const MANIFEST_PATH = join(repoRoot, '.dogfood-divergences.json')

// Sentinel "removed line" representing a not-yet-materialized file, so an
// allowlisted missing-materialization state is pinned exactly like any diff.
export const MISSING_SENTINEL = '«materialized file missing»'

const UPDATE_DIVERGENCES = process.argv.includes('--update-divergences')

/**
 * Load .dogfood-divergences.json as a Map<absoluteMaterializedPath, entry>.
 * Entries may carry an explicit `dest` root for non-claude template families
 * (e.g. '.arbiter/ship'); default stays '.claude' for backward compatibility (#1290).
 */
function loadDivergences() {
  if (!existsSync(MANIFEST_PATH)) return new Map()
  const entries = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'))
  return new Map(entries.map((e) => [join(repoRoot, e.dest ?? '.claude', e.path), e]))
}

// ─── raw .mjs hook corpus (#1090) ─────────────────────────────────────────────

/**
 * Compare each hook in REQUIRED_RAW_HOOKS (emitted verbatim by
 * src/generators/claude.ts) against its materialized .claude/hooks copy.
 *
 * Hooks whose materialized path is listed in .dogfood-divergences.json are
 * intentional arbiter-internal self-hardening (e.g. enforce-read-only drops
 * AGENTS.md from the read-only set because arbiter authors its own AGENTS.md,
 * whereas a target's AGENTS.md is generated and must stay read-only). Since
 * CANON-14's auto-diff promotion (#1838) the allowlist entry no longer skips
 * the comparison: the ACTUAL diff is recomputed and must hash-match the
 * entry's pinned diffHash — new drift inside an allowlisted hook fails the
 * gate exactly like drift in an unlisted one. Any UNDOCUMENTED drift fails
 * the gate (fail-closed, INV-45/INV-96), which is what makes shipping a
 * silently-weaker hook to targets impossible without an explicit, pinned diff.
 *
 * Returns { checked, skipped, drifted, visited: Map<absPath, diff> } — visited
 * records every allowlisted path this corpus touched (for dead-entry detection
 * and --update-divergences re-pinning).
 */
export async function checkRawHooks(root = repoRoot, divergences = loadDivergences()) {
  const drifted = []
  const visited = new Map()
  const exportDrops = new Set()
  let checked = 0
  let skipped = 0
  for (const name of REQUIRED_RAW_HOOKS) {
    const template = join(root, 'src/templates/claude/hooks', name)
    const materialized = join(root, '.claude/hooks', name)
    if (!existsSync(template)) {
      drifted.push({ name, reason: 'shipped template missing' })
      continue
    }
    if (!existsSync(materialized)) {
      drifted.push({ name, reason: 'materialized .claude/hooks copy missing' })
      continue
    }
    const templateContent = readFileSync(template, 'utf-8')
    const actualContent = readFileSync(materialized, 'utf-8')
    const expected = await normalizeLines(templateContent, template)
    const actual = await normalizeLines(actualContent, materialized)
    const diff = computeDiff(expected, actual)

    const entry = divergences.get(materialized)
    if (entry) {
      visited.set(materialized, diff)
      const violation = classifyAllowlistedPair({
        entry,
        materialized,
        templateContent,
        actualContent,
        diff,
        exportDrops,
      })
      if (violation) {
        drifted.push({ name, ...violation })
      } else {
        skipped++
      }
      continue
    }

    if (diff) {
      drifted.push({ name, added: diff.added.slice(0, 5), removed: diff.removed.slice(0, 5) })
    } else {
      checked++
    }
  }
  return { checked, skipped, drifted, visited, exportDrops }
}

// ─── external CI-surface parity (R-02) ───────────────────────────────────────
//
// #1877/#1894 showed a drift class TEMPLATE_ROOTS cannot see: arbiter swapped its
// OWN CI's dependency scanner (OWASP Dependency-Check → Trivy) in `.github/workflows/`
// and `scripts/check-*.mjs` without the shipped `src/templates/github/workflows/*.ejs` /
// `src/templates/scripts/*.ejs` counterparts moving in lockstep (or vice versa) — invisible
// because no gate ever diffed self against template for these two families.
//
// TEMPLATE_ROOTS' fail-closed "every template must materialize" contract does NOT fit
// here: workflow/script templates are emitted CONDITIONALLY (archetype × governanceLevel ×
// collaborationMode — see src/generators/github.ts), so most have no self counterpart at
// all (e.g. 04-deploy-test.yml.ejs — arbiter is a library, it never deploys), and arbiter's
// own topology deliberately runs RICHER than its declared config would generate (e.g. the
// full 06-nightly/07-weekly/08-monthly cadence despite collaborationMode: trunk-solo — see
// check-ci-tiers.mjs.ejs's "arbiter dogfoods the full suite while remaining trunk-solo").
// Scope is therefore BASENAME-INTERSECTION driven: only a file that exists on BOTH sides is
// compared — exactly the shape of the #1877/#1894 class (a file that exists in both places
// moved on one side without the other), without false-failing on archetype-conditional
// asymmetry that was never wired to exist on both sides in the first place.
//
// check-all.mjs.ejs is excluded: it needs an extra `coverageEnabled` field computed from a
// real lines-of-code count (src/config/thresholds.ts), not a generic ProjectConfig, and
// arbiter's own check-all.mjs is by design a full orchestrator (100+ checks) against a
// starter-stub template — parity at the whole-file level is not a meaningful signal there.
export const EXTERNAL_CI_FAMILIES = [
  {
    key: 'github-workflows',
    templateDir: 'src/templates/github/workflows',
    templateSuffix: '.yml.ejs',
    materializedDir: '.github/workflows',
    materializedSuffix: '.yml',
    renderPath: (base) => `github/workflows/${base}.yml.ejs`,
  },
  {
    key: 'check-scripts',
    templateDir: 'src/templates/scripts',
    templateSuffix: '.mjs.ejs',
    materializedDir: 'scripts',
    materializedSuffix: '.mjs',
    renderPath: (base) => `scripts/${base}.mjs.ejs`,
    // record-* admitted alongside check-* (#1943 residual c): the E1 recorder
    // (record-agent-return.mjs) is a shipped twin exactly like the gates —
    // excluding it from parity scope would let the write path silently drift
    // from the emitted copy while the read path stays pinned.
    // debt-lib / debt-report / capture-debt-baseline admitted alongside them
    // (#2229): the debt toolchain ships .ejs twins whose R-02 render now
    // supplies metricsProfile — a single-sided edit to the materialized debt
    // scripts must trip parity exactly like any gate twin.
    // self-validation admitted alongside them (#2466): it is a zero-interpolation
    // twin exactly like the gates above (INV-53's A/B/C drill harness), but its
    // basename matched neither the check-* nor record-* prefix, so it sat outside
    // R-02 parity — the only thing keeping it in sync with its template was a
    // human running the `diff` TESTING.md documents by hand.
    include: (base) =>
      (base.startsWith('check-') ||
        base.startsWith('record-') ||
        base === 'debt-lib' ||
        base === 'debt-report' ||
        base === 'capture-debt-baseline' ||
        base === 'self-validation') &&
      base !== 'check-all',
  },
  // #1943 residual c: the E1-E7 enforcer twins import shared helpers from
  // scripts/lib/ — a helper that drifts (self vs shipped) changes gate behavior
  // exactly like a drifted gate body, so the lib family joins parity scope.
  // Basename-intersection semantics as above: only helpers shipped as twins are
  // compared (template-only libs like coverage-gate.mjs have no self counterpart).
  {
    key: 'script-libs',
    templateDir: 'src/templates/scripts/lib',
    templateSuffix: '.mjs.ejs',
    materializedDir: 'scripts/lib',
    materializedSuffix: '.mjs',
    renderPath: (base) => `scripts/lib/${base}.mjs.ejs`,
  },
  // #1943 residual c: the agent-return envelope schema is the validation SSOT for
  // both the recorder and the gate — a schema that drifts between self and the
  // shipped twin splits the envelope contract between arbiter and its targets.
  {
    key: 'schemas',
    templateDir: 'src/templates/scripts/schemas',
    templateSuffix: '.schema.json.ejs',
    materializedDir: 'schemas',
    materializedSuffix: '.schema.json',
    renderPath: (base) => `scripts/schemas/${base}.schema.json.ejs`,
  },
]

/** Non-recursive: only direct-child files matching `suffix`. Returns basenames (suffix stripped). */
function listBasenames(absDir, suffix) {
  if (!existsSync(absDir)) return []
  return readdirSync(absDir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(suffix))
    .map((d) => d.name.slice(0, -suffix.length))
}

/**
 * Basenames present on BOTH the template dir and the materialized dir for `family`,
 * filtered by `family.include` when set. Sorted for determinism.
 */
export function matchedFamilyBasenames(rootDir, family) {
  const templateBasenames = new Set(
    listBasenames(join(rootDir, family.templateDir), family.templateSuffix),
  )
  const materializedBasenames = listBasenames(
    join(rootDir, family.materializedDir),
    family.materializedSuffix,
  )
  return materializedBasenames
    .filter((b) => templateBasenames.has(b))
    .filter((b) => !family.include || family.include(b))
    .sort()
}

/**
 * Compare every basename-matched pair across EXTERNAL_CI_FAMILIES. `render(relPath)` renders
 * the named template (e.g. `github/workflows/01-pr-fast.yml.ejs`) with arbiter's OWN resolved
 * config and returns the output string, or throws.
 *
 * Same CANON-14 shape as checkRawHooks/main(): an allowlisted materialized path is not
 * skipped wholesale — its ACTUAL diff must hash-match the entry's pinned diffHash.
 *
 * Returns { checked, skipped, drifted, visited: Map<absPath, diff> }.
 */
export async function checkExternalCiSurfaceParity(rootDir, divergences, render) {
  const drifted = []
  const visited = new Map()
  const exportDrops = new Set()
  let checked = 0
  let skipped = 0

  for (const family of EXTERNAL_CI_FAMILIES) {
    for (const base of matchedFamilyBasenames(rootDir, family)) {
      const templateRelPath = family.renderPath(base)
      const materialized = join(
        rootDir,
        family.materializedDir,
        `${base}${family.materializedSuffix}`,
      )
      const entry = divergences.get(materialized)

      let rendered
      try {
        rendered = render(templateRelPath)
      } catch (err) {
        drifted.push({
          template: templateRelPath,
          materialized: relative(rootDir, materialized),
          reason: `render error: ${err.message}`,
        })
        continue
      }

      const actualContent = readFileSync(materialized, 'utf-8')
      const expectedLines = await normalizeLines(rendered, materialized)
      const actualLines = await normalizeLines(actualContent, materialized)
      const diff = computeDiff(expectedLines, actualLines)

      if (entry) {
        visited.set(materialized, diff)
        const violation = classifyAllowlistedPair({
          entry,
          materialized,
          templateContent: rendered,
          actualContent,
          diff,
          exportDrops,
        })
        if (violation) {
          drifted.push({
            template: templateRelPath,
            materialized: relative(rootDir, materialized),
            ...violation,
          })
        } else {
          skipped++
        }
        continue
      }

      if (diff) {
        drifted.push({
          template: templateRelPath,
          materialized: relative(rootDir, materialized),
          added: diff.added.slice(0, 5),
          removed: diff.removed.slice(0, 5),
        })
      } else {
        checked++
      }
    }
  }
  return { checked, skipped, drifted, visited, exportDrops }
}

// ─── main ────────────────────────────────────────────────────────────────────

/**
 * #2327: the re-pin path rewrites the manifest with JSON.stringify, whose array
 * formatting differs from prettier's — so the first array-valued field
 * (`allowedDroppedExports`) made `--update-divergences` leave the file failing the
 * format gate. Round-tripping through the repo's own prettier config keeps the
 * sanctioned repair format-clean for any field shape. Falls back to the raw JSON if
 * prettier is unavailable — a formatting nicety must never fail the gate.
 */
async function formatManifest(json) {
  try {
    const prettier = await import('prettier')
    const options = (await prettier.resolveConfig(MANIFEST_PATH)) ?? {}
    return await prettier.format(json, { ...options, filepath: MANIFEST_PATH })
  } catch {
    return json
  }
}

async function main() {
  // #1984: R-02 below dynamically imports compiled dist/ (scripts/ cannot
  // import .ts directly, #1267). A missing build already failed closed via
  // the import catch; a STALE build (dist/ built before the current src/
  // changes) previously reported green. Checked first — cheap mtime compare
  // — so a stale build fails before any other work runs, same exit-2 class
  // as check-codex-self-parity.mjs's fail-closed config/environment errors.
  const distFreshness = checkDistFresh(repoRoot)
  if (!distFreshness.fresh) {
    console.error(`[dogfood] FAIL — ${distFreshness.reason}`)
    process.exit(2)
  }

  // Lazy-load ejs so the exported helpers work without it
  const ejs = (await import('ejs')).default

  // Corpus derives from TEMPLATE_ROOTS — the same SSOT that maps paths — so a new
  // family can never be mapped-but-unwalked (vacuous gate, #1290). Each family root is
  // walked with the shared hardened glob-walk helper (cycle-safe lstat + visited-inode
  // guard, #1521), filtered to .ejs, then re-absolutized so templateToMaterialized can
  // locate the family marker. A missing root directory stays a hard error, not a skip
  // (fail-closed): walkRepo returns [] for an absent dir, so guard existence explicitly
  // to preserve the throw the raw readdirSync gave before this migration.
  const templates = Object.keys(TEMPLATE_ROOTS)
    .flatMap((marker) => {
      const root = join(repoRoot, marker)
      if (!existsSync(root)) throw new Error(`dogfood corpus root missing: ${root}`)
      return walkRepo(root)
        .filter((full) => full.endsWith('.ejs'))
        .map((full) => join(root, full))
    })
    .sort()

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
    // ADR-051: inject collaboration-mode axis so trunk-solo conditional blocks render
    // correctly during dogfood parity checks. (#1216)
    collaborationMode: arbiterConfig.collaborationMode,
    automation: arbiterConfig.automation,
    mergeMode: arbiterConfig.solo?.mergeMode,
    languageHooks: [
      {
        name: 'check-no-orphan-todo.mjs',
        description: 'Every TODO must reference a task ID',
        body: '',
      },
    ],
  })

  const divergences = loadDivergences()

  // #2327: materialized paths whose export surface lost a symbol the template
  // ships. Collected across all three corpora so --update-divergences refuses
  // to re-pin them — the drop must be fixed or explicitly sanctioned, never
  // absorbed by the sanctioned repair.
  const exportDrops = new Set()

  let skipped = 0
  let checked = 0
  const drifted = []
  // CANON-14 (#1838): every allowlisted path this run recomputed a diff for,
  // with that diff — feeds dead-entry detection and --update-divergences.
  const visited = new Map()

  for (const templatePath of templates) {
    const materialized = templateToMaterialized(templatePath)
    const entry = divergences.get(materialized)

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

    // Check if materialized file exists. An allowlisted entry may legitimately
    // pin a not-yet-materialized template (e.g. hooks.mjs before its
    // regenerate pass) — MISSING_SENTINEL makes that state hashable so it is
    // still an EXACT pin, not a blanket skip.
    if (!existsSync(materialized)) {
      if (entry) {
        const diff = { added: [], removed: [MISSING_SENTINEL] }
        visited.set(materialized, diff)
        const violation = classifyDivergence(entry, diff)
        if (violation) {
          drifted.push({
            template: relative(repoRoot, templatePath),
            materialized: relative(repoRoot, materialized),
            ...violation,
          })
        } else {
          skipped++
        }
        continue
      }
      drifted.push({
        template: relative(repoRoot, templatePath),
        materialized: relative(repoRoot, materialized),
        reason: 'materialized file does not exist',
      })
      continue
    }

    // Render template. A render error is a template bug, never an approvable
    // divergence — hard drift regardless of allowlist.
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

    // CANON-14 auto-diff: an allowlisted file is not skipped — its ACTUAL diff
    // must hash-match the approved pin. New drift inside it fails like any other.
    if (entry) {
      visited.set(materialized, diff)
      const violation = classifyAllowlistedPair({
        entry,
        materialized,
        templateContent: rendered,
        actualContent: materializedContent,
        diff,
        exportDrops,
      })
      if (violation) {
        drifted.push({
          template: relative(repoRoot, templatePath),
          materialized: relative(repoRoot, materialized),
          ...violation,
        })
      } else {
        skipped++
      }
      continue
    }

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

  // #1090: also verify the raw .mjs hook corpus (copied verbatim, no EJS render).
  const raw = await checkRawHooks(repoRoot, divergences)
  for (const [p, d] of raw.visited) visited.set(p, d)
  for (const p of raw.exportDrops) exportDrops.add(p)

  // R-02: workflow/check-script external CI-surface parity (#1877/#1894 drift class).
  // Needs arbiter's OWN resolved ProjectConfig + the real renderTemplate — scripts/
  // cannot import .ts directly (mirrors check-agent-dispatch.mjs, #1267), so this reads
  // the COMPILED dist. Staleness is already ruled out by the checkDistFresh guard at
  // the top of main() (#1984); this catch remains for a missing/corrupt/unimportable
  // build and fails the gate closed (one drift entry) rather than crashing main()
  // before the .claude-family results above are reported.
  let external = { checked: 0, skipped: 0, drifted: [], visited: new Map(), exportDrops: new Set() }
  let externalCheckFailed = false
  try {
    const distUrl = (p) => pathToFileURL(join(repoRoot, 'dist', p)).href
    const { loadConfig } = await import(distUrl('utils/config.js'))
    const { resolveProjectConfig } = await import(distUrl('config/resolve-project-config.js'))
    const { renderTemplate } = await import(distUrl('utils/render.js'))
    const { computeMetricsProfile } = await import(distUrl('generators/debt-ratchet.js'))
    const stored = loadConfig(repoRoot)
    if (!stored) throw new Error('arbiter.json not found')
    const { config: projectConfig } = resolveProjectConfig(repoRoot, 'arbiter', stored)
    // Script twins render under their owning generators' data contract, not a
    // bare ProjectConfig: the debt toolchain twins use metricsProfile.* keys
    // that only the debt generator derives (#2229). The extra key is harmless
    // to every other script twin (they never reference it).
    const renderData = { ...projectConfig, metricsProfile: computeMetricsProfile(projectConfig) }
    external = await checkExternalCiSurfaceParity(repoRoot, divergences, (relPath) =>
      renderTemplate(relPath, renderData),
    )
  } catch (err) {
    externalCheckFailed = true
    drifted.push({
      template: '(none — R-02 external CI-surface parity)',
      materialized: '(dist/ compiled modules)',
      reason:
        `cannot verify workflow/check-script parity: ${err.message}. Run "npm run build" ` +
        'first — scripts/ cannot import .ts directly (#1267).',
    })
  }
  checked += external.checked
  skipped += external.skipped
  drifted.push(...external.drifted)
  for (const [p, d] of external.visited) visited.set(p, d)
  for (const p of external.exportDrops) exportDrops.add(p)

  // Materialized dirs of EXTERNAL_CI_FAMILIES — used below to suppress cascading
  // "dead entry" noise for this family when the check above hard-failed (one clear
  // fatal reason already reported; 52 duplicate "dead entry" lines would bury it).
  const externalDests = new Set(EXTERNAL_CI_FAMILIES.map((f) => f.materializedDir))

  // CANON-14 (#1838): a divergence entry whose path no corpus ever visits pins
  // nothing — it is either a typo or a leftover from a removed template family.
  // Dead entries fail closed instead of silently rotting in the manifest.
  for (const [absPath, entry] of divergences) {
    if (externalCheckFailed && externalDests.has(entry.dest)) continue
    if (!visited.has(absPath)) {
      drifted.push({
        template: '(none — no template maps to this path)',
        materialized: relative(repoRoot, absPath),
        reason:
          `dead divergence entry "${entry.path}" — no template corpus visits this path; ` +
          'remove it from .dogfood-divergences.json (its rationale survives in git history)',
      })
    }
  }

  // --update-divergences: re-pin diffHash for every LIVE entry, preserving
  // path/dest/reason. Stale (no-diff) and dead entries are NOT auto-deleted —
  // deleting a reasoned allowlist line is a human decision; they keep failing
  // the gate until removed by hand.
  if (UPDATE_DIVERGENCES) {
    const entries = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'))
    let pinned = 0
    for (const e of entries) {
      const absPath = join(repoRoot, e.dest ?? '.claude', e.path)
      // #2327: never re-pin over a dropped export — that is precisely the
      // absorption this gate exists to prevent. The entry keeps its old hash
      // and keeps failing until the export is restored or sanctioned.
      if (exportDrops.has(absPath)) continue
      if (visited.has(absPath)) {
        const diff = visited.get(absPath)
        if (diff !== null) {
          e.diffHash = hashDiff(diff)
          pinned++
        }
      }
    }
    writeFileSync(MANIFEST_PATH, await formatManifest(JSON.stringify(entries, null, 2) + '\n'))
    process.stdout.write(
      `[dogfood] --update-divergences: pinned diffHash for ${pinned}/${entries.length} entr(ies) in .dogfood-divergences.json\n`,
    )
  }

  process.stdout.write(
    `[dogfood] ${skipped} template(s) + ${raw.skipped} raw hook(s) skipped (config-gated or approved divergence).\n`,
  )

  if (drifted.length > 0 || raw.drifted.length > 0) {
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
    }
    if (raw.drifted.length > 0) {
      console.error(
        `\n[dogfood] FAIL — ${raw.drifted.length} raw .mjs hook(s) drift from shipped template:`,
      )
      for (const d of raw.drifted) {
        console.error(`\n  hook:         ${d.name}`)
        if (d.reason) {
          console.error(`  reason:       ${d.reason}`)
        } else {
          if (d.removed && d.removed.length > 0) {
            console.error(`  removed lines (in template but not in .claude copy):`)
            d.removed.forEach((l) => console.error(`    - ${l}`))
          }
          if (d.added && d.added.length > 0) {
            console.error(`  added lines (in .claude copy but not in template):`)
            d.added.forEach((l) => console.error(`    + ${l}`))
          }
        }
      }
    }
    console.error(
      `\n  To approve a known divergence: add {path, reason} to .dogfood-divergences.json, then` +
        `\n  pin its exact diff with: node scripts/check-self-dogfood.mjs --update-divergences` +
        `\n  (CANON-14, #1838 — an entry approves ONE reviewed diff, not the file wholesale)`,
    )
    process.exit(1)
  }

  process.stdout.write(
    `[dogfood] ${checked} template(s) + ${raw.checked} raw hook(s) checked. All match materialized .claude/ files.\n`,
  )
}

// Run only when executed directly (not imported by tests)
const isMain = isMainModule(import.meta.url)
if (isMain) {
  main().catch((err) => {
    console.error('[dogfood] Fatal error:', err.message)
    process.exit(1)
  })
}
