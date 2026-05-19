#!/bin/sh
# run.sh — thin shim so hooks, CI, and contributors call the same command.
# Part of INV-87 (#879, W3). Pass any check-all.mjs subcommand as $1.
set -e
exec node scripts/check-all.mjs "$@"
