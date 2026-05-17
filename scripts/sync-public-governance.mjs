#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Syncs AGENTS.md into website/governance/ at docs build time.
// Run automatically via the docs:build script.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join, resolve, extname } from 'node:path'

const ROOT = resolve('.')
const WEBSITE_GOVERNANCE_DIR = join(ROOT, 'website', 'governance')

mkdirSync(WEBSITE_GOVERNANCE_DIR, { recursive: true })

// Copy AGENTS.md into website/governance/ for public site rendering
copyFileSync(join(ROOT, 'AGENTS.md'), join(WEBSITE_GOVERNANCE_DIR, 'AGENTS.md'))

// Count ADR files for diagnostic output
const ADR_DIR = join(ROOT, 'docs', 'adr')
let adrCount = 0
try {
  adrCount = readdirSync(ADR_DIR).filter((f) => extname(f) === '.md' && f !== 'README.md').length
} catch {
  // ADR dir may not exist yet
}

process.stdout.write(`sync-public-governance: ok — AGENTS.md synced, ${adrCount} ADR(s) found\n`)
