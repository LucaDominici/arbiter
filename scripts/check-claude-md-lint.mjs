#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// arbiter — claude-md-lint: thin context-file linter (INV-89, #1266)
//
// CATALOG: P8 context-file lint gate (anti-drift, INV-89). Lints AI context files
// CATALOG: (CLAUDE.md/AGENTS.md, incl. nested .claude/CLAUDE.md) for hardcoded paths,
// CATALOG: required @import of the shared layer, line budget, verbatim duplication
// CATALOG: of imported content, and volatile facts (versions/counts) that belong in SSOT.
// CATALOG: Distinct from check-doc-style.mjs (frontmatter/H1 on all .md) — this targets
// CATALOG: ONLY context files and their import/portability rules.
//
// Rules:
//   - HARD: no hardcoded absolute machine paths (/home/, /Users/, /root/, drive-letter X:\)
//   - HARD: a *delegating* context file (non-root CLAUDE.md) must @import a shared layer
//   - HARD: a delegating file that @imports a layer must not copy a verbatim >=N-line block
//           from that layer (defeats the import)
//   - SOFT (warn-only): per-file line budget
//   - SOFT (warn-only): no volatile facts — literal semver (X.Y.Z) or hardcoded counts
//           ("N invariants/hooks/...") in body prose. These drift; keep them in SSOT
//           (config/code) and point at it. Frontmatter, fenced code, and lines that already
//           reference an SSOT file are exempt. (ported from the internal-ref context linter)
//
// Exits 0 when no hard violations (warnings don't fail); exits 1 on any hard violation.
//
// Usage: node scripts/check-claude-md-lint.mjs [--help]

import { existsSync, readFileSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    [
      'Usage: node scripts/check-claude-md-lint.mjs [options]',
      '',
      'Lints AI context files (CLAUDE.md / AGENTS.md) for hardcoded paths, a required',
      '@import of the shared layer in delegating files, a line budget (soft), verbatim',
      'duplication of imported shared-layer content, and volatile facts (soft).',
      'Exits 0 when no hard violations; exits 1 otherwise. (INV-89)',
      '',
      'Options:',
      '  --help, -h      Show this help and exit',
      '',
    ].join('\n'),
  )
  process.exit(0)
}

const CWD = process.cwd()

// Tunables (thin linter — generous, warn-biased).
const LINE_BUDGET = 600 // soft ceiling per context file
const DUP_BLOCK_LINES = 12 // consecutive non-trivial lines copied verbatim ⇒ duplication

// Absolute machine paths only — anchored so substrings (URLs, ../relative, command refs
// like `node scripts/...`) do not match. A POSIX abs path must be preceded by a
// non-path char and start at a filesystem root segment.
const ABS_POSIX = /(^|[\s"'`(=])(\/(home|Users|root|etc|var|opt|tmp|usr\/local)\/)/
const ABS_WINDOWS = /(^|[\s"'`(=])([A-Za-z]:[\\/])/

// Volatile facts (SOFT). A three-part version literal, or a count bound to a governance noun.
// `v?` allows an optional leading v; trailing pre-release/build is ignored on purpose.
const VOLATILE_SEMVER = /\bv?\d+\.\d+\.\d+\b/
const VOLATILE_COUNT =
  /\b\d+\s+(invariants?|hooks?|rules?|skills?|commands?|checks?|gates?|dimensions?|agents?|templates?|adapters?)\b/i
// A line that already names an SSOT source file is a pointer, not a hardcoded fact — exempt.
const SSOT_POINTER =
  /(\.(ts|tsx|js|mjs|cjs|json|ya?ml|toml)\b|pom\.xml|package\.json|Cargo\.toml|go\.mod|build\.gradle|catalog\b)/i

/** Discover in-scope context files (repo-relative only; never the user's global ~/.claude). */
function discover() {
  const out = []
  for (const f of ['AGENTS.md', 'CLAUDE.md']) {
    const p = join(CWD, f)
    if (existsSync(p)) out.push(p)
  }
  // .claude/CLAUDE.md (the canonical delegating file in arbiter + generated targets).
  const dotClaude = join(CWD, '.claude')
  if (existsSync(dotClaude)) {
    const p = join(dotClaude, 'CLAUDE.md')
    if (existsSync(p)) out.push(p)
  }
  return out
}

/** A file is "delegating" when it is a non-root CLAUDE.md (i.e. lives under a dir, e.g. .claude/). */
function isDelegating(absPath) {
  return basename(absPath) === 'CLAUDE.md' && dirname(absPath) !== CWD
}

/** The shared layer a delegating file is expected to import (root AGENTS.md). */
function sharedLayerPath() {
  const p = join(CWD, 'AGENTS.md')
  return existsSync(p) ? p : null
}

/** Lines worth comparing for duplication (skip blanks, headings, separators, fences). */
function significantLines(content) {
  return content
    .split('\n')
    .map((l) => l.trim())
    .filter(
      (l) => l.length > 0 && !/^#{1,6}\s/.test(l) && !/^[-=*_]{3,}$/.test(l) && !/^```/.test(l),
    )
}

/** True if `child` copies a verbatim run of >= DUP_BLOCK_LINES significant lines from `parent`. */
function hasVerbatimBlock(childContent, parentContent) {
  const child = significantLines(childContent)
  const parentSet = new Set(significantLines(parentContent))
  let run = 0
  for (const line of child) {
    run = parentSet.has(line) ? run + 1 : 0
    if (run >= DUP_BLOCK_LINES) return true
  }
  return false
}

/**
 * Warn-only: volatile facts in body prose. Skips the YAML frontmatter block and any fenced
 * code; exempts lines that already point at an SSOT file. Returns `${rel}:${line}: ...` strings.
 */
function volatileFactWarnings(content, rel) {
  const out = []
  const lines = content.split('\n')
  let inFrontmatter = lines[0]?.trim() === '---'
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    // Frontmatter: from the leading `---` to its closing `---` (exempt — doc_version lives here).
    if (inFrontmatter) {
      if (i > 0 && trimmed === '---') inFrontmatter = false
      continue
    }
    // Fenced code blocks (``` or ~~~) — exempt.
    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    if (SSOT_POINTER.test(line)) continue // a pointer to where the fact lives — allowed
    if (VOLATILE_SEMVER.test(line)) {
      out.push(
        `${rel}:${i + 1}: volatile fact — version literal "${line.match(VOLATILE_SEMVER)[0]}" belongs in SSOT (config/code), point at it instead`,
      )
    } else if (VOLATILE_COUNT.test(line)) {
      out.push(
        `${rel}:${i + 1}: volatile fact — hardcoded count "${line.match(VOLATILE_COUNT)[0].trim()}" drifts; derive it from SSOT instead`,
      )
    }
  }
  return out
}

function main() {
  const files = discover()
  if (files.length === 0) {
    process.stdout.write('check-claude-md-lint: SKIP — no context files found (INV-89)\n')
    // #2052: recognized marker so runCheck surfaces SKIP, not PASS, in the gate summary.
    process.stdout.write('[SKIP] no context files found (INV-89)\n')
    return 0
  }

  const errors = []
  const warnings = []
  const layerPath = sharedLayerPath()
  const layerContent = layerPath ? readFileSync(layerPath, 'utf-8') : null

  for (const file of files) {
    const rel = file.slice(CWD.length + 1)
    const content = readFileSync(file, 'utf-8')
    const lines = content.split('\n')

    // HARD: hardcoded absolute paths.
    lines.forEach((line, i) => {
      if (ABS_POSIX.test(line) || ABS_WINDOWS.test(line)) {
        errors.push(`${rel}:${i + 1}: hardcoded absolute path — context files must be portable`)
      }
    })

    // Delegating-file rules.
    if (isDelegating(file)) {
      const hasImport = /^@[\w./-]+/m.test(content)
      if (!hasImport) {
        errors.push(
          `${rel}: delegating context file must @import its shared layer (e.g. @AGENTS.md)`,
        )
      } else if (layerContent && file !== layerPath && hasVerbatimBlock(content, layerContent)) {
        errors.push(
          `${rel}: duplicates a verbatim >=${DUP_BLOCK_LINES}-line block from the imported shared layer — delegate via @import instead of copying`,
        )
      }
    }

    // SOFT: line budget.
    if (lines.length > LINE_BUDGET) {
      warnings.push(`${rel}: ${lines.length} lines exceeds soft line budget (${LINE_BUDGET})`)
    }

    // SOFT: volatile facts (versions/counts) belong in SSOT, not in context prose.
    for (const w of volatileFactWarnings(content, rel)) warnings.push(w)
  }

  if (errors.length === 0) {
    if (warnings.length > 0) {
      process.stdout.write(
        `check-claude-md-lint: ${files.length} file(s) OK; ${warnings.length} soft warning(s) (INV-89)\n`,
      )
      for (const w of warnings) process.stdout.write(`    [warn] ${w}\n`)
    } else {
      process.stdout.write(
        `check-claude-md-lint: all ${files.length} context file(s) OK (INV-89)\n`,
      )
    }
    return 0
  }

  process.stdout.write(
    `check-claude-md-lint: ${errors.length} hard error(s) across ${files.length} file(s) (INV-89)\n`,
  )
  for (const e of errors) process.stdout.write(`    ${e}\n`)
  for (const w of warnings) process.stdout.write(`    [warn] ${w}\n`)
  return 1
}

// Fail-closed (INV-96): any unexpected error exits 1 rather than passing silently.
try {
  process.exit(main())
} catch (err) {
  process.stderr.write(`check-claude-md-lint: unexpected error — ${err?.message ?? err} (INV-89)\n`)
  process.exit(1)
}
