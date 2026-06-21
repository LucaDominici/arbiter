#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Syncs root CHANGELOG.md → website/changelog/stable.md. (#664)
//
// Usage:
//   node scripts/sync-changelog.mjs [--changelog <path>] [--out <path>]
//
// - Reads root CHANGELOG.md
// - Strips the leading "# Changelog" H1 (avoid VitePress title conflict)
// - Prepends VitePress frontmatter
// - Filters: keeps only stable entries (tagged **Channel:** stable or legacy with no channel tag)
// - Writes output file (fails loudly on I/O error)
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
let changelogPath = resolve('CHANGELOG.md')
let outPath = resolve('website/changelog/stable.md')

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--changelog' && args[i + 1]) changelogPath = resolve(args[++i])
  else if (args[i] === '--out' && args[i + 1]) outPath = resolve(args[++i])
}

let content
try {
  content = readFileSync(changelogPath, 'utf-8')
} catch {
  process.stderr.write(`[sync-changelog] error: cannot read ${changelogPath}\n`)
  process.exit(1)
}

// Match both `## [X.Y.Z]` (KAC) and `## X.Y.Z` (changeset output) so this works regardless of
// which changelog format `changeset version` emits upstream.
const HEADER_RE = /^## (?:\[([^\]]+)\]|(\d+\.\d+\.\d+\S*))/
const CHANNEL_LINE_RE = /^\*\*Channel:\*\* (stable|beta|canary)$/

/**
 * Preserve the target file's existing YAML frontmatter (doc_version / status / last_review / tags
 * that the docs convention + doc-style gate require) instead of clobbering it with a title-only
 * stub. Returns the verbatim `---\n…\n---\n` block, or null if the file is absent / has no
 * frontmatter (fresh-file bootstrap falls back to the default).
 */
function existingFrontmatter(path) {
  let text
  try {
    text = readFileSync(path, 'utf-8')
  } catch {
    return null
  }
  const m = /^(---\n[\s\S]*?\n---\n)/.exec(text)
  return m ? m[1] : null
}

const lines = content.split('\n')
let i = 0

// Strip leading "# Changelog" H1
if (lines[0]?.startsWith('# ')) i++

// Collect sections, filtering to stable-only
const stableLines = []
let inSection = false
let sectionIsStable = false
let sectionBuf = []

function flushSection() {
  if (inSection && sectionIsStable) {
    stableLines.push(...sectionBuf)
  }
  sectionBuf = []
  inSection = false
  sectionIsStable = false
}

while (i < lines.length) {
  const line = lines[i]
  const headerMatch = HEADER_RE.exec(line)

  if (headerMatch) {
    flushSection()
    inSection = true

    // Collect header + blank line + possible channel label to determine stability
    sectionBuf.push(line)
    i++

    // Blank line after header
    if (i < lines.length && lines[i] === '') {
      sectionBuf.push(lines[i])
      i++
    }

    // Channel label line?
    if (i < lines.length && CHANNEL_LINE_RE.test(lines[i])) {
      const label = lines[i]
      sectionBuf.push(label)
      i++
      sectionIsStable = label === '**Channel:** stable'
    } else {
      // No channel tag — treat as legacy stable
      sectionIsStable = true
    }
  } else {
    if (inSection) sectionBuf.push(line)
    i++
  }
}
flushSection()

const frontmatter = existingFrontmatter(outPath) ?? '---\ntitle: Stable Releases\n---\n'
const body = stableLines.join('\n')

try {
  if (stableLines.length === 0) {
    process.stderr.write(
      `[sync-changelog] warning: no stable sections found in ${changelogPath} — output will be empty\n` +
        `  Run node scripts/changeset-channel-tag.mjs first to ensure sections are tagged.\n`,
    )
  }

  writeFileSync(outPath, frontmatter + '\n' + body, 'utf-8')
} catch (err) {
  process.stderr.write(
    `[sync-changelog] error: cannot write ${outPath}: ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(1)
}
