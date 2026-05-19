#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Gate: verifies all required languages have an adapter file in src/adapters/.
// INV-88: scripts/check-adapter-coverage.mjs
import { readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const REQUIRED_LANGUAGES = ['typescript', 'java', 'python', 'go', 'rust']
const GIT_CWD = process.env.GIT_CWD ?? process.cwd()
const adaptersDir = resolve(GIT_CWD, 'src/adapters')

if (!existsSync(adaptersDir)) {
  process.stderr.write('ERROR: src/adapters/ directory not found\n')
  process.exit(1)
}

const files = readdirSync(adaptersDir).filter(
  (f) => f.endsWith('.ts') && f !== 'StackAdapter.ts' && !f.startsWith('_') && f !== 'index.ts',
)
const covered = files.map((f) => f.replace(/\.ts$/, ''))
const missing = REQUIRED_LANGUAGES.filter((l) => !covered.includes(l))

if (missing.length > 0) {
  process.stderr.write(`ERROR [INV-88]: missing adapter files for: ${missing.join(', ')}\n`)
  process.stderr.write(
    `  Expected adapter files: ${REQUIRED_LANGUAGES.map((l) => `src/adapters/${l}.ts`).join(', ')}\n`,
  )
  process.exit(1)
}

process.stdout.write(`adapter coverage OK: ${covered.join(', ')}\n`)
