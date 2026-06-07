#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: §17.5 rec 3 — workflow cache-strategy gate (ADR-090).
// CATALOG: Scans EJS workflow templates for archetype-specific cache patterns.
// CATALOG: Java/Maven: reactor-m2 upload+download artifact handoff.
// CATALOG: Node/TypeScript: setup-node-pnpm composite OR setup-node with cache.
// CATALOG: Python: setup-python with cache: pip or poetry.
// CATALOG: Rust: Swatinem/rust-cache or actions/cache for cargo.
// CATALOG: Heartbeat/utility templates with no archetype triggers → SKIP.
// CATALOG: Cannot fold into check-workflow-parallelism.mjs (different concern:
// CATALOG:   parallelism validates structural needs: chains; this validates
// CATALOG:   presence of archetype-specific dependency cache patterns — ADR-090).
//
// Exit codes (INV-53): 0 PASS, 1 FAIL (violations found), 2 ERROR (templates dir missing).
//
// Usage: node scripts/check-workflow-cache-strategy.mjs [--dir <repo-root>] [--help]

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    [
      'Usage: node scripts/check-workflow-cache-strategy.mjs [options]',
      '',
      'Scans EJS workflow templates for archetype-specific cache patterns.',
      'Exits 0 when all checks pass; exits 1 when violations found;',
      'exits 2 when templates directory not found (fail-closed, INV-53).',
      '',
      'Options:',
      '  --dir <path>    Repo root to scan (default: cwd)',
      '  --help, -h      Show this help and exit',
      '',
    ].join('\n'),
  )
  process.exit(0)
}

const dirArg = args.indexOf('--dir')
const CWD = dirArg >= 0 && args[dirArg + 1] ? resolve(args[dirArg + 1]) : process.cwd()

const WORKFLOWS_TPL = join(CWD, 'src', 'templates', 'github', 'workflows')

// ─── Input-set guard (fail-closed, INV-53) ────────────────────────────────────

if (!existsSync(WORKFLOWS_TPL)) {
  process.stderr.write(
    'check-workflow-cache-strategy: ERROR — workflow templates directory not found: ' +
      `${WORKFLOWS_TPL}\n`,
  )
  process.exit(2)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Collect all *.yml.ejs files directly under `dir` (non-recursive, top-level only).
 * Subdirectories like _cosign-copy/ are skipped — they are partials, not standalone workflows.
 */
function collectEjsTemplates(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.yml.ejs'))
    .map((e) => join(dir, e.name))
}

/**
 * Read a file; return null on IO error.
 * @param {string} filePath
 * @returns {string | null}
 */
function readFile(filePath) {
  try {
    return readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

// ─── Archetype detection helpers ──────────────────────────────────────────────

/**
 * Returns true when the template explicitly contains the reactor-m2 artifact name,
 * indicating it uses the Maven reactor handoff pattern (as opposed to deploy/release
 * templates that use inline `cache: maven` on setup-java).
 *
 * Detection strategy: the reactor-m2 pattern is identified by the presence of the
 * `reactor-m2-` artifact name prefix in any context. Templates that just use
 * `cache: maven` on setup-java (like deploy-test) will not contain this string.
 */
function hasJavaMavenSection(content) {
  // The reactor pattern is present when the template explicitly references the
  // reactor-m2 artifact. Deploy/release templates use setup-java cache: maven instead.
  return content.includes('reactor-m2-')
}

/**
 * Returns true when the template has a TypeScript/Node archetype block.
 */
function hasTypescriptSection(content) {
  return (
    content.includes("language === 'typescript'") || content.includes('language === "typescript"')
  )
}

/**
 * Returns true when the template has a Python archetype block.
 */
function hasPythonSection(content) {
  return content.includes("language === 'python'") || content.includes('language === "python"')
}

/**
 * Returns true when the template has a Rust archetype block.
 */
function hasRustSection(content) {
  return content.includes("language === 'rust'") || content.includes('language === "rust"')
}

// ─── Cache pattern assertions ─────────────────────────────────────────────────

/**
 * Java/Maven: must have upload-artifact + download-artifact for reactor-m2-${{ github.run_id }}
 * This asserts that the reactor handoff pattern is present in the template.
 */
function assertJavaMavenReactor(content) {
  const hasUpload =
    content.includes('reactor-m2-${{ github.run_id }}') && content.includes('upload-artifact')
  const hasDownload =
    content.includes('reactor-m2-${{ github.run_id }}') && content.includes('download-artifact')
  return hasUpload && hasDownload
}

/**
 * Node/TypeScript: must use either:
 *   (a) ./.github/actions/setup-node-pnpm composite (which internally caches npm), OR
 *   (b) actions/setup-node with cache: 'npm' or cache: 'pnpm'
 */
function assertNodeCache(content) {
  if (content.includes('setup-node-pnpm')) return true
  if (content.includes("cache: 'npm'") || content.includes('cache: "npm"')) return true
  if (content.includes("cache: 'pnpm'") || content.includes('cache: "pnpm"')) return true
  return false
}

/**
 * Python: must use actions/setup-python with cache: pip (or quoted variants)
 * or cache: poetry. Handles both unquoted (cache: pip) and quoted (cache: 'pip') forms.
 */
function assertPythonCache(content) {
  // Unquoted: cache: pip or cache: poetry
  if (/cache:\s*pip\b/.test(content)) return true
  if (/cache:\s*poetry\b/.test(content)) return true
  // Quoted variants
  if (content.includes("cache: 'pip'") || content.includes('cache: "pip"')) return true
  if (content.includes("cache: 'poetry'") || content.includes('cache: "poetry"')) return true
  return false
}

/**
 * Rust: must use Swatinem/rust-cache (the standard Rust caching action) OR
 * actions/cache with cargo-specific paths (~/.cargo, target/)
 */
function assertRustCache(content) {
  if (content.includes('Swatinem/rust-cache')) return true
  if (content.includes('actions/cache') && content.includes('.cargo')) return true
  return false
}

// ─── Template scope ────────────────────────────────────────────────────────────
//
// The cache-strategy gate focuses on the PRIMARY PR WORKFLOW templates
// (01-pr-fast.yml.ejs, 02-pr-extended.yml.ejs). These are the workflows that
// directly impact PR cycle time and are governed by ADR-090's performance budget.
//
// Other templates (nightly, weekly, monthly, release, deploy-test, heartbeat)
// have their own caching strategies appropriate to their use case — for example:
//   - deploy-test: uses `cache: maven` on setup-java (no reactor needed)
//   - release: may skip cache intentionally for reproducible builds
//   - nightly: scheduled runs with different SLA expectations
//   - heartbeat: no build at all
//
// The gate is deliberately scoped to avoid false-positives on non-PR templates.
//
// NOTE: Non-PR templates are NOT exempt from caching best practices — they are
// simply outside the scope of this gate's assertions. Teams SHOULD add caching
// to other templates, but violations there are tracked separately.
const PRIMARY_PR_TEMPLATES = new Set(['01-pr-fast.yml.ejs', '02-pr-extended.yml.ejs'])

// ─── Main scan ────────────────────────────────────────────────────────────────

function main() {
  const allTemplates = collectEjsTemplates(WORKFLOWS_TPL)
  const templates = allTemplates.filter((t) => {
    const name = t.split('/').at(-1) ?? ''
    return PRIMARY_PR_TEMPLATES.has(name)
  })

  if (allTemplates.length === 0) {
    process.stderr.write(
      'check-workflow-cache-strategy: ERROR — no *.yml.ejs templates found in ' +
        `${WORKFLOWS_TPL} (fail-closed, INV-53)\n`,
    )
    process.exit(2)
  }

  if (templates.length === 0) {
    process.stderr.write(
      'check-workflow-cache-strategy: ERROR — primary PR workflow templates not found in ' +
        `${WORKFLOWS_TPL} (expected 01-pr-fast.yml.ejs and/or 02-pr-extended.yml.ejs — fail-closed)\n`,
    )
    process.exit(2)
  }

  /** @type {{ file: string; archetype: string; missing_cache_pattern: string }[]} */
  const violations = []

  for (const tplPath of templates) {
    const relPath = tplPath.replace(CWD + '/', '')
    const content = readFile(tplPath)
    if (content === null) {
      process.stderr.write(`[WARN] check-workflow-cache-strategy: could not read ${relPath}\n`)
      continue
    }

    // Java/Maven: only assert reactor handoff when template has maven-specific conditional
    if (hasJavaMavenSection(content)) {
      if (!assertJavaMavenReactor(content)) {
        violations.push({
          file: relPath,
          archetype: 'java/maven',
          missing_cache_pattern:
            'reactor-m2-${{ github.run_id }} upload+download artifact handoff not found ' +
            '(upload-artifact + download-artifact with reactor-m2-${run_id} name required)',
        })
      }
    }

    // Node/TypeScript: assert cache when typescript section present
    if (hasTypescriptSection(content)) {
      if (!assertNodeCache(content)) {
        violations.push({
          file: relPath,
          archetype: 'node/typescript',
          missing_cache_pattern:
            'no node cache found: require ./.github/actions/setup-node-pnpm, ' +
            "or actions/setup-node with cache: 'npm'/'pnpm'",
        })
      }
    }

    // Python: assert cache when python section present
    if (hasPythonSection(content)) {
      if (!assertPythonCache(content)) {
        violations.push({
          file: relPath,
          archetype: 'python',
          missing_cache_pattern:
            "no pip cache found: require actions/setup-python with cache: 'pip' or cache: 'poetry'",
        })
      }
    }

    // Rust: assert cache when rust section present
    if (hasRustSection(content)) {
      if (!assertRustCache(content)) {
        violations.push({
          file: relPath,
          archetype: 'rust',
          missing_cache_pattern:
            'no rust cache found: require Swatinem/rust-cache or actions/cache for ~/.cargo',
        })
      }
    }
  }

  // ─── Result ───────────────────────────────────────────────────────────────────

  if (violations.length > 0) {
    process.stderr.write(
      `check-workflow-cache-strategy: FAIL — ${violations.length} cache-strategy violation(s) found:\n`,
    )
    for (const v of violations) {
      process.stderr.write(`  [FAIL] ${v.archetype}: ${v.file}\n`)
      process.stderr.write(`         missing: ${v.missing_cache_pattern}\n`)
    }
    process.exit(1)
  }

  process.stdout.write(
    `check-workflow-cache-strategy: OK — cache-strategy invariants satisfied ` +
      `(${templates.length} primary PR templates scanned, ${allTemplates.length} total in dir, §17.5 rec 3, ADR-090)\n`,
  )
  process.exit(0)
}

try {
  main()
} catch (err) {
  process.stderr.write(
    `check-workflow-cache-strategy: ERROR — ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(1)
}
