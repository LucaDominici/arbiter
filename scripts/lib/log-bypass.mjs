#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// scripts/lib/log-bypass.mjs
//
// Tiny CLI wrapper around checkBypass() for shell hooks (e.g. .githooks/pre-push).
//
// Usage:   node scripts/lib/log-bypass.mjs <ENV_NAME> [reason]
//
// Optional env overrides (mostly for tests / consumer customization):
//   ARBITER_BYPASS_LOG_PATH    override JSONL log path
//   ARBITER_BYPASS_BRANCH      override branch detection
//
// Exit code is ALWAYS 0 — bypass decisions are signaled by stderr + JSONL,
// not by exit code. This keeps the wrapper safe to invoke from `set -e` hooks.

import { checkBypass } from './loud-bypass.mjs'

function usage() {
  process.stderr.write(
    'usage: node scripts/lib/log-bypass.mjs <ENV_NAME> [reason]\n' +
      '       env name argument is required\n',
  )
  process.exit(0)
}

const envName = process.argv[2]
const reason = process.argv[3]

if (!envName) {
  usage()
}

checkBypass(envName, {
  reason: reason && reason.length > 0 ? reason : 'bypass requested',
  logPath: process.env.ARBITER_BYPASS_LOG_PATH,
  branch: process.env.ARBITER_BYPASS_BRANCH,
})

process.exit(0)
