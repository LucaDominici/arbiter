#!/usr/bin/env node
// Arbiter hook: guard designated read-only files
// Fires on: PreToolUse → Edit|Write
import { resolveToolInputPath } from './lib.mjs'

const file = resolveToolInputPath()

// Fail closed (INV-96): an unresolvable edit path must BLOCK, not fall through to
// allow. A guard that protects read-only files must not disarm on uncertainty.
if (!file) {
  process.stderr.write(
    '[arbiter] Read-only guard: unresolvable edit path — blocking (fail-closed, INV-96).\n',
  )
  process.exit(2)
}

const READ_ONLY_PATTERNS = ['AGENTS.md', 'LICENSE', 'package-lock.json', 'Cargo.lock']

for (const pattern of READ_ONLY_PATTERNS) {
  if (file.includes(pattern)) {
    process.stderr.write(
      `[arbiter] Read-only file — edit requires explicit justification: ${file}\n`,
    )
    // Exit 2 BLOCKS the edit (#1631). Exit 1 was non-blocking — the protected-file
    // edit proceeded, and the guard was inverted vs the fail-closed path above (exit 2).
    process.exit(2)
  }
}
