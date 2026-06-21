#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Post-version hook: rewrites CHANGELOG.md with **Channel:** labels. (#664)
//
// Usage:
//   node scripts/changeset-channel-tag.mjs [--file <path>] [--dry-run]
//
// Default --file: CHANGELOG.md (relative to cwd).
//
// Tagging rules:
//   *-canary.*                      → **Channel:** canary
//   *-rc.* | *-beta.* | *-alpha.*  → **Channel:** beta
//   X.Y.Z (plain semver)           → **Channel:** stable
//   Anything else                  → exits 1
//
// Idempotency: skips sections already correctly labeled.
// Mismatch (wrong existing label) → exits 1.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
let filePath = resolve('CHANGELOG.md')
let dryRun = false

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--file' && args[i + 1]) filePath = resolve(args[++i])
  else if (args[i] === '--dry-run') dryRun = true
}

function channelFor(version) {
  if (/canary/.test(version)) return 'canary'
  if (/-(?:rc|beta|alpha)\./.test(version)) return 'beta'
  if (/^\d+\.\d+\.\d+$/.test(version)) return 'stable'
  return null
}

// Match BOTH a Keep-a-Changelog bracket header `## [X.Y.Z]` (this repo's hand-maintained
// CHANGELOG.md) AND a plain changeset header `## X.Y.Z` (the default @changesets/cli/changelog
// output). Group 1 = bracketed body, group 2 = plain semver. A non-semver bracket section like
// `## [Unreleased]` matches group 1 but channelFor() returns null → it is skipped, not an error.
const HEADER_RE = /^## (?:\[([^\]]+)\]|(\d+\.\d+\.\d+\S*))/
const CHANNEL_LINE_RE = /^\*\*Channel:\*\* (stable|beta|canary)$/

let content
try {
  content = readFileSync(filePath, 'utf-8')
} catch {
  process.stderr.write(`[changeset-channel-tag] error: cannot read ${filePath}\n`)
  process.exit(1)
}

const lines = content.split('\n')
const out = []
let i = 0
let changed = 0

while (i < lines.length) {
  const line = lines[i]
  const headerMatch = HEADER_RE.exec(line)

  if (!headerMatch) {
    out.push(line)
    i++
    continue
  }

  const version = headerMatch[1] ?? headerMatch[2]
  const channel = channelFor(version)

  if (channel === null) {
    // The standard Keep-a-Changelog `## [Unreleased]` section — every CHANGELOG carries one and
    // changeset output keeps it. Skip it (never label, never error); only release-version sections
    // (X.Y.Z / -rc / -beta / -alpha / -canary) get a **Channel:** label.
    if (/^unreleased$/i.test(version)) {
      out.push(line)
      i++
      continue
    }
    // A header that looks like a version section but is a shape we do not recognise — a real
    // authoring error (e.g. a typo'd version), so fail loudly as before.
    process.stderr.write(
      `[changeset-channel-tag] error: unknown version shape "${version}"\n` +
        `  expected: plain X.Y.Z, -rc.N, -beta.N, -alpha.N, -canary.HASH, or [Unreleased]\n`,
    )
    process.exit(1)
  }

  const expectedLabel = `**Channel:** ${channel}`

  out.push(line)
  i++

  // Blank line after header
  if (i < lines.length && lines[i] === '') {
    out.push(lines[i])
    i++
  }

  // Check for existing label
  if (i < lines.length && CHANNEL_LINE_RE.test(lines[i])) {
    const existingLabel = lines[i]
    if (existingLabel !== expectedLabel) {
      process.stderr.write(
        `[changeset-channel-tag] error: label mismatch for [${version}]: ` +
          `found "${existingLabel}", expected "${expectedLabel}"\n`,
      )
      process.exit(1)
    }
    // Already correct — keep as-is
    out.push(lines[i])
    i++
  } else {
    if (dryRun) {
      process.stdout.write(`would prepend "${expectedLabel}" after ## [${version}]\n`)
    }
    out.push(expectedLabel)
    changed++
  }
}

if (dryRun) {
  if (changed === 0) process.stdout.write('no changes needed (all sections already tagged)\n')
  process.exit(0)
}

if (changed === 0) {
  process.stdout.write('[changeset-channel-tag] no changes needed (all sections already tagged)\n')
} else {
  try {
    writeFileSync(filePath, out.join('\n'), 'utf-8')
  } catch (err) {
    process.stderr.write(
      `[changeset-channel-tag] error: cannot write ${filePath}: ${err.message}\n`,
    )
    process.exit(1)
  }
  process.stdout.write(`[changeset-channel-tag] tagged ${changed} section(s) in ${filePath}\n`)
}

// Removed old bare writeFileSync — rewritten below with guard + output
