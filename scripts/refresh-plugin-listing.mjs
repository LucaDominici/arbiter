#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Fetches arbiter plugins from npm registry and regenerates website/plugins/index.md.
// Safe to run with no network: falls back gracefully and exits 0.
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'website', 'plugins', 'index.md')

/** @returns {Array<{name: string, version: string, description: string, author: string}>} */
function fetchPlugins() {
  let raw
  try {
    raw = execFileSync('npm', ['search', '--json', '--no-description', 'keywords:arbiter-plugin'], {
      timeout: 30_000,
      encoding: 'utf-8',
    })
  } catch (err) {
    process.stderr.write(`[refresh-plugin-listing] npm search failed: ${String(err)}\n`)
    return []
  }

  try {
    const results = JSON.parse(raw)
    if (!Array.isArray(results)) return []
    return results
      .filter((r) => typeof r === 'object' && r !== null && typeof r['name'] === 'string')
      .map((r) => ({
        name: String(r['name']),
        version: String(r['version'] ?? 'unknown'),
        description: String(r['description'] ?? ''),
        author:
          typeof r['author'] === 'object' && r['author'] !== null
            ? String(r['author']['name'] ?? '')
            : String(r['author'] ?? ''),
      }))
  } catch {
    process.stderr.write('[refresh-plugin-listing] failed to parse npm search output\n')
    return []
  }
}

function buildTable(plugins) {
  if (plugins.length === 0) {
    return '| _(none yet — registry refreshes nightly)_ | | | |\n'
  }
  const header =
    '| Name | Version | Author | Description |\n|------|---------|--------|-------------|\n'
  const rows = plugins.map(
    (p) => `| \`${p.name}\` | ${p.version} | ${p.author} | ${p.description} |`,
  )
  return header + rows.join('\n') + '\n'
}

const plugins = fetchPlugins()
const now = new Date().toISOString().slice(0, 10)

const content = `---
title: Plugin Registry
sidebar_label: Plugins
---

# Plugin Registry

> This page is auto-generated nightly from the npm registry (\`keywords:arbiter-plugin\`).
> Last updated: ${now}

## Discovery convention

Plugins must be published to npm with:
- Keyword: \`arbiter-plugin\`
- Name prefix: \`arbiter-plugin-*\` or scoped \`@arbiter-plugin/*\`

See [\`docs/PLUGIN-API.md\`](../../docs/PLUGIN-API.md) for the full naming and manifest requirements.

## Known plugins

${buildTable(plugins)}
## Submit your plugin

Publish to npm with the \`arbiter-plugin\` keyword. It will appear here within 24 hours.
`

writeFileSync(OUT, content, 'utf-8')
process.stdout.write(`[refresh-plugin-listing] wrote ${plugins.length} plugin(s) to ${OUT}\n`)
