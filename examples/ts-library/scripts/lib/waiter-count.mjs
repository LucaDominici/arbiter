#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// scripts/lib/waiter-count.mjs (#2098) — shared fd-count helper for the
// gate-exec mutex lockfile.
//
// `flock -- <lockfile> cmd` opens the lock file's fd BEFORE blocking in the
// flock() syscall, so every process contending for the lock (the current
// holder plus every process still queued behind it) has the file open for
// the whole time it is blocked. `fuser <lockfile>` lists exactly those PIDs.
//
// ONE canonical implementation, two consumers (#2098 acceptance: "don't
// duplicate it"):
//   - scripts/capacity-probe.mjs imports countLockWaiters() directly.
//   - src/commands/gate-exec.ts's advisory shells out to this file (isMain
//     guard below) instead of importing it: gate-exec.ts compiles into
//     dist/ and ships WITHOUT scripts/ (see package.json "files"), so it
//     cannot statically import a script that only exists in a target
//     project's own checked-out tree. Invoking `node <this file> <lockPath>`
//     from the target project's cwd reaches the SAME implementation.
//
// INV-12 exception: direct child_process use is the documented carve-out for
// .mjs gate-utility libraries that must run pre-build and cannot pull from
// src/ (same pattern as scripts/lib/loud-bypass.mjs).
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/**
 * Count processes holding `lockPath` open. Never throws: `fuser` exits
 * non-zero when nobody holds the file (a legitimate zero, not a fault), and
 * a missing binary or missing path degrade to 0 the same way — this is an
 * advisory signal, not a correctness-critical one.
 * @param {string} lockPath
 * @returns {number}
 */
export function countLockWaiters(lockPath) {
  try {
    const out = execFileSync('fuser', [lockPath], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const trimmed = out.trim()
    return trimmed.length ? trimmed.split(/\s+/).length : 0
    // FAIL-OPEN-INTENT: advisory signal — fuser exits non-zero with no holder (legitimate zero).
  } catch {
    return 0
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  try {
    const lockPath = process.argv[2]
    if (!lockPath) {
      process.stderr.write('usage: waiter-count.mjs <lockPath>\n')
      process.exit(2)
    }
    process.stdout.write(`${countLockWaiters(lockPath)}\n`)
  } catch (e) {
    process.stderr.write(`waiter-count: unexpected error: ${e.stack ?? e}\n`)
    process.exit(1)
  }
}
