#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// CATALOG: External-tool parity gate. Aggregates the policy that every non-npm
// CATALOG: binary the gate depends on (gitleaks, actionlint) is pinned in exactly
// CATALOG: one SSOT (scripts/ci-tools.json), is actually installed by CI, and is
// CATALOG: actually used by the gate — so a tool can never silently drift between
// CATALOG: the gate, the CI workflow, and the local installer. No sibling check-*
// CATALOG: script reconciles these three surfaces: check-local-ci-parity.mjs
// CATALOG: compares CHECK coverage (not tool versions) and sync-action-pins.mjs
// CATALOG: (INV-76) only covers GitHub Action `uses:` pins, not curl-installed
// CATALOG: tools, so this gate cannot fold into either.
//
// Why this exists: a gate tool absent locally makes runToolCheck SKIP (or a plain
// runCheck hard-fail), hiding real CI errors until a CI round-trip. Pinning every
// such tool in one manifest — consumed by CI install, the local installer
// (scripts/install-ci-tools.mjs), and this gate — makes "local gate runs the same
// tools as CI" structurally enforceable.
//
// Exits 0: manifest <-> gate <-> CI workflow are aligned.
// Exits 1: a manifest tool is unused/uninstalled/unpinned, or a gate tool is
//          missing from the manifest.
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = join(REPO_ROOT, 'scripts', 'ci-tools.json')
const CHECK_ALL = join(REPO_ROOT, 'scripts', 'check-all.mjs')
const WORKFLOW = join(REPO_ROOT, '.github', 'workflows', '01-pr-fast.yml')

function main() {
  const problems = []

  if (!existsSync(MANIFEST)) {
    process.stderr.write('check-ci-tool-parity: scripts/ci-tools.json not found\n')
    process.exit(1)
  }

  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8'))
  const tools = manifest.tools ?? []
  const checkAllSrc = readFileSync(CHECK_ALL, 'utf-8')
  const workflowSrc = existsSync(WORKFLOW) ? readFileSync(WORKFLOW, 'utf-8') : ''

  // 1. Every manifest tool must be USED by the gate AND PINNED-INSTALLED in CI.
  const manifestBinaries = new Set()
  for (const tool of tools) {
    manifestBinaries.add(tool.binary)
    // used by the gate: the binary appears as a runCheck/runToolCheck command arg
    const usedRe = new RegExp(`run(Tool)?Check\\([^)]*['"]${tool.binary}['"]`)
    if (!usedRe.test(checkAllSrc)) {
      problems.push(
        `manifest tool "${tool.name}" is not used by any gate check in scripts/check-all.mjs`,
      )
    }
    // installed + version-pinned in CI
    if (workflowSrc && !workflowSrc.includes(tool.url)) {
      problems.push(
        `manifest tool "${tool.name}" v${tool.version} is not installed at this exact URL in .github/workflows/01-pr-fast.yml (drift between manifest and CI)`,
      )
    }
  }

  // 2. Every external tool the gate runs via runToolCheck must be in the manifest.
  //    (runToolCheck is the CI-aware path; its tools are exactly the ones CI must install.)
  const toolCheckRe = /runToolCheck\(\s*['"][^'"]+['"]\s*,\s*['"]([^'"]+)['"]/g
  let m
  while ((m = toolCheckRe.exec(checkAllSrc)) !== null) {
    const binary = m[1]
    if (!manifestBinaries.has(binary)) {
      problems.push(
        `gate runs runToolCheck on "${binary}" but it is not pinned in scripts/ci-tools.json (add it so CI install + local installer stay in sync)`,
      )
    }
  }

  if (problems.length > 0) {
    process.stderr.write('check-ci-tool-parity: FAIL\n')
    for (const p of problems) process.stderr.write(`  - ${p}\n`)
    process.exit(1)
  }

  process.stdout.write(
    `check-ci-tool-parity: OK (${tools.length} tool(s) aligned: manifest <-> gate <-> CI)\n`,
  )
  process.exit(0)
}

try {
  main()
} catch (err) {
  // Fail closed: an unexpected parsing/IO error must block the gate, never pass.
  process.stderr.write(`check-ci-tool-parity: unexpected error: ${err?.stack ?? err}\n`)
  process.exit(1)
}
