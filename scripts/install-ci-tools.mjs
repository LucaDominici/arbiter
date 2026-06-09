#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Install the external (non-npm) binaries the gate uses — gitleaks, actionlint —
// at the exact versions CI pins, into ~/.local/bin. This closes the #1 local<->CI
// blind spot: a gate tool that is absent locally makes `runToolCheck` SKIP (or a
// plain `runCheck` hard-fail), so a real CI error (e.g. an actionlint workflow
// violation) is invisible until the CI round-trip. Run this once and the local
// gate runs the SAME tools as CI.
//
// Source of truth: scripts/ci-tools.json (also consumed by check-ci-tool-parity.mjs
// and mirrored by the CI install steps in .github/workflows/01-pr-fast.yml).
//
// Usage: node scripts/install-ci-tools.mjs [--help]
// Linux x64 only (matches the CI runner). No-ops gracefully on other platforms.
import { spawnSync } from 'node:child_process'
import { readFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = join(REPO_ROOT, 'scripts', 'ci-tools.json')
const BIN_DIR = join(homedir(), '.local', 'bin')

function printHelp() {
  process.stdout.write(
    'Usage: node scripts/install-ci-tools.mjs\n' +
      '  Installs the gate’s external tools (gitleaks, actionlint) at the CI-pinned\n' +
      '  versions from scripts/ci-tools.json into ~/.local/bin. Ensure ~/.local/bin is\n' +
      '  on your PATH so the local gate runs the same tools as CI.\n',
  )
}

function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp()
    process.exit(0)
  }

  if (process.platform !== 'linux') {
    process.stdout.write(
      `install-ci-tools: platform ${process.platform} is not linux — skipping ` +
        '(CI pins linux x64 binaries; install equivalents manually if needed).\n',
    )
    process.exit(0)
  }

  /** @type {{ tools: { name: string; binary: string; version: string; url: string; member: string }[] }} */
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8'))
  mkdirSync(BIN_DIR, { recursive: true })

  let failed = 0
  for (const tool of manifest.tools) {
    process.stdout.write(
      `Installing ${tool.name} v${tool.version} -> ${BIN_DIR}/${tool.binary} ... `,
    )
    // curl the pinned tarball and extract the single binary member directly into BIN_DIR.
    const r = spawnSync(
      'bash',
      [
        '-c',
        `set -o pipefail; curl -sSfL "${tool.url}" | tar -xz -C "${BIN_DIR}" "${tool.member}"`,
      ],
      { encoding: 'utf-8', timeout: 120_000 },
    )
    if (r.status === 0) {
      process.stdout.write('OK\n')
    } else {
      failed++
      process.stdout.write('FAILED\n')
      if (r.stderr) process.stderr.write(r.stderr)
    }
  }

  if (failed > 0) {
    process.stderr.write(`\ninstall-ci-tools: ${failed} tool(s) failed to install.\n`)
    process.exit(1)
  }

  process.stdout.write(
    `\nDone. Ensure ${BIN_DIR} is on your PATH, then re-run the gate so actionlint/gitleaks run locally:\n` +
      `  export PATH="${BIN_DIR}:$PATH"\n`,
  )
}

try {
  main()
} catch (err) {
  // Fail closed: a partial/failed install must exit non-zero, never appear to succeed.
  process.stderr.write(`install-ci-tools: unexpected error: ${err?.stack ?? err}\n`)
  process.exit(1)
}
