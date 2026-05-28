#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// INV-100: Verifies arbiter.json declares a valid collaborationMode field.
// Valid values: 'trunk-solo' | 'peer-review' | 'gated-review'.
// Usage: node scripts/check-collab-mode-wired.mjs [--config=<path>]

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const VALID_MODES = new Set(['trunk-solo', 'peer-review', 'gated-review'])

function resolveConfigPath(args) {
  const flag = args.find((a) => a.startsWith('--config='))
  if (flag) return resolve(flag.slice('--config='.length))
  return resolve(process.cwd(), 'arbiter.json')
}

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
