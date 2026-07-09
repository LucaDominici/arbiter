#!/usr/bin/env bash
# setup-hooks.sh: configure git to use .githooks/ directory
# Run once after cloning: bash scripts/setup-hooks.sh
set -e

git config core.hooksPath .githooks
chmod +x .githooks/*
echo "Git hooks installed from .githooks/ directory."
