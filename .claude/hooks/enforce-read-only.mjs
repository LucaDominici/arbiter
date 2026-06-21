#!/usr/bin/env node
// Arbiter hook: guard designated read-only files
// Fires on: PreToolUse → Edit|Write
import { resolveToolInputPath } from './lib.mjs'

const file = resolveToolInputPath()

// Only enforce on files within this repo
const repoRoot = process.cwd()
if (file && !file.startsWith(repoRoot)) process.exit(0)

const READ_ONLY_PATTERNS = ['LICENSE', 'package-lock.json', 'Cargo.lock']

for (const pattern of READ_ONLY_PATTERNS) {
  if (file.includes(pattern)) {
    process.stderr.write(
      `[arbiter] Read-only file — edit requires explicit justification: ${file}\n`,
    )
    process.exit(1)
  }
}
