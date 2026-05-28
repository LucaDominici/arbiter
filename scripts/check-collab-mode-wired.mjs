#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: INV-100 enforcement. Verifies arbiter.json declares a valid
// CATALOG: collaborationMode field ('trunk-solo' | 'peer-review' | 'gated-review').
// CATALOG: rejected fold-in into check-all.mjs (distinct single-concern script per INV-94).
// CATALOG: rejected fold-in into check-self-dogfood.mjs (different concern: schema vs dogfood parity).
// Usage: node scripts/check-collab-mode-wired.mjs [--config=<path>]

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const VALID_MODES = new Set(['trunk-solo', 'peer-review', 'gated-review'])

function resolveConfigPath(args) {
  const flag = args.find((a) => a.startsWith('--config='))
  if (flag) return resolve(flag.slice('--config='.length))
  return resolve(process.cwd(), 'arbiter.json')
}

try {
  const configPath = resolveConfigPath(process.argv.slice(2))

  if (!existsSync(configPath)) {
    process.stderr.write(`[INV-100] arbiter.json not found at ${configPath}\n`)
    process.exit(0) // not an arbiter project — skip
  }

  let config
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch {
    process.stderr.write(`[INV-100] Failed to parse ${configPath}\n`)
    process.exit(1)
  }

  const mode = config.collaborationMode
  if (mode === undefined || mode === null) {
    process.stderr.write(
      `[INV-100] collaborationMode is absent from arbiter.json.\n` +
        `  Set it to one of: trunk-solo, peer-review, gated-review.\n` +
        `  Run \`arbiter update\` to auto-migrate from soloDevMode.\n`,
    )
    process.exit(1)
  }

  if (!VALID_MODES.has(mode)) {
    process.stderr.write(
      `[INV-100] collaborationMode="${mode}" is not a valid value.\n` +
        `  Must be one of: trunk-solo, peer-review, gated-review.\n`,
    )
    process.exit(1)
  }

  process.stdout.write(`[INV-100] collaborationMode="${mode}" — OK\n`)
} catch (err) {
  process.stderr.write(
    `[INV-100] Unexpected error: ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(1)
}
