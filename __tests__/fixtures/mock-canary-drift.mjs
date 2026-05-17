#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Mock arbiter binary: outputs drift-like content and exits 0
process.stdout.write('  [create]\n')
process.stdout.write('  + AGENTS.md\n')
process.stdout.write('  + .claude/settings.json\n')
process.exit(0)
