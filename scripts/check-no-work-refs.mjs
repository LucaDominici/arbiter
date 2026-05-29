#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: Privacy gate — rejects files containing provenance strings from
// CATALOG: private work repositories. Cannot fold into check-pii.mjs (PII scan
// CATALOG: targets personal data patterns, not repo-provenance strings) nor into
// CATALOG: check-inline-suppressions.mjs (different policy domain). Standalone
// CATALOG: because the forbidden-string set is project-specific and changes
// CATALOG: independently of PII or suppression policy.
//
// Gate: reject any committed file containing provenance strings from
// private work repositories. Runs in pre-commit (via check-all.mjs L1+).
//
// Patterns are intentionally broad — false positives are cheap; leaks are not.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const FORBIDDEN = [
  /\bmainsim\b/i,
  /\bms5\b/i,
  /cloud\.ms5/i,
  /\bcmms\b/i,
  /\bcowork\b/i,
  /ci-fleet/i,
]

const SCAN_EXTENSIONS = new Set([
  '.ts',
  '.js',
  '.mjs',
  '.cjs',
  '.ejs',
  '.md',
  '.yml',
  '.yaml',
  '.json',
  '.sh',
  '.txt',
  '.toml',
])

// Skip only the enforcement infrastructure that legitimately contains the
// forbidden tokens by design: this gate's own pattern list, the redaction
// lexicon, and the redaction unit-test fixtures. Everything else — including
// .arbiter/ manager scratchpad + audit history — is in scope (the gate runs in
// `all` mode from check-all.mjs, so already-committed leaks are caught too).
const SKIP_PATHS = [
  'scripts/check-no-work-refs.mjs',
  'scripts/data/redaction-lexicon.json',
  '__tests__/kit/redaction.test.ts',
  '.claude/',
]

function shouldScan(filePath) {
  const lower = filePath.toLowerCase()
  if (SKIP_PATHS.some((skip) => lower.includes(skip))) return false
  return SCAN_EXTENSIONS.has(lower.slice(lower.lastIndexOf('.')))
}

function getStagedFiles() {
  try {
    const out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
      encoding: 'utf8',
    })
    return out.trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

function getAllTrackedFiles() {
  try {
    const out = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    return out.trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

try {
  const mode = process.argv[2] ?? 'staged'
  const files = mode === 'all' ? getAllTrackedFiles() : getStagedFiles()

  const violations = []

  for (const file of files) {
    if (!shouldScan(file)) continue
    let content
    try {
      content = readFileSync(join(process.cwd(), file), 'utf8')
    } catch {
      continue
    }
    for (const pattern of FORBIDDEN) {
      const match = content.match(pattern)
      if (match) {
        violations.push({ file, pattern: pattern.source, match: match[0] })
        break
      }
    }
  }

  if (violations.length > 0) {
    console.error('\n[check-no-work-refs] FAIL — private work-repo strings detected:\n')
    for (const v of violations) {
      console.error(`  ${v.file}: matched /${v.pattern}/ ("${v.match}")`)
    }
    console.error('\nReplace with generic terms before committing.')
    process.exit(1)
  }

  console.log('[check-no-work-refs] OK — no private provenance strings found')
} catch (err) {
  process.stderr.write(
    `[check-no-work-refs] unexpected error: ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(1)
}
