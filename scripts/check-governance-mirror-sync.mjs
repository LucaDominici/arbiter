#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: Validates website/governance/AGENTS.md is a byte-for-byte mirror of root AGENTS.md (#1805).
// CATALOG: Rejected fold-in into check-doc-links.mjs because that gate validates link targets, not file-content parity between a SSOT and its published mirror.
// CATALOG: Rejected fold-in into check-workflow-docs-sync.mjs because that gate checks workflow-name mentions in docs/, not verbatim mirror equality; merging would conflate two unrelated drift models.
//
// arbiter — governance mirror drift checker (#1805)
//
// AGENTS.md is the SSOT for governance content. scripts/sync-public-governance.mjs
// copies it verbatim into website/governance/AGENTS.md for public-site rendering
// (wired into `npm run docs:build`). Nothing previously caught the mirror going
// stale pre-merge — an edit to root AGENTS.md (e.g. the Iron Laws section) could
// land without the website copy ever being regenerated (#1805).
//
// This check re-derives the expected mirror content the same way
// sync-public-governance.mjs does (byte-for-byte copy) and fails if the
// committed website/governance/AGENTS.md diverges from it.
//
// Usage:
//   node scripts/check-governance-mirror-sync.mjs            # check CWD
//   node scripts/check-governance-mirror-sync.mjs --dir <path>
// Exits 0 if in sync (or bootstrap: source/mirror not present yet); exits 1 on drift.

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

try {
  const args = process.argv.slice(2)
  const dirArg = args.indexOf('--dir')
  const ROOT = dirArg >= 0 && args[dirArg + 1] ? resolve(args[dirArg + 1]) : process.cwd()

  const SOURCE = join(ROOT, 'AGENTS.md')
  const MIRROR = join(ROOT, 'website', 'governance', 'AGENTS.md')

  if (!existsSync(SOURCE)) {
    process.stdout.write('check-governance-mirror-sync: SKIP — no AGENTS.md (bootstrap mode)\n')
    process.exit(0)
  }

  if (!existsSync(MIRROR)) {
    process.stderr.write(
      'check-governance-mirror-sync: FAIL — website/governance/AGENTS.md missing (#1805)\n' +
        '  Fix: node scripts/sync-public-governance.mjs\n',
    )
    process.exit(1)
  }

  const source = readFileSync(SOURCE, 'utf-8')
  const mirror = readFileSync(MIRROR, 'utf-8')

  if (source !== mirror) {
    process.stderr.write(
      'check-governance-mirror-sync: FAIL — website/governance/AGENTS.md is stale vs AGENTS.md (#1805)\n' +
        '  Fix: node scripts/sync-public-governance.mjs\n',
    )
    process.exit(1)
  }

  process.stdout.write('check-governance-mirror-sync: OK — mirror matches AGENTS.md\n')
  process.exit(0)
} catch (err) {
  process.stderr.write(
    `check-governance-mirror-sync: fatal — ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(1)
}
