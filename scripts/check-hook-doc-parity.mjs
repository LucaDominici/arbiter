#!/usr/bin/env node
// CATALOG: reconciles .claude/settings.json registered hooks against the .claude/CLAUDE.md hooks table (CANON-10).
// CATALOG: rejected fold-in into check-hook-contracts.mjs (validates hook FILE exit-code/stdin contracts, not doc parity).
// CATALOG: rejected fold-in into check-settings-coverage.mjs (configure.ts↔settings.ts settable-path parity, different SSOT pair).
//
// Gate (CANON-10, docs/internal/SYSTEM/CANON.md): every hook registered in
// .claude/settings.json must appear as a row in the hooks table of
// .claude/CLAUDE.md (event, matcher, filename), and every documented row
// must correspond to a real registered hook (no phantom row, no missing one).
//
// CANON-10's enforcement was previously "Prose — checked at PR review when
// settings.json changes" (#177) — this gate promotes it to wired, matching
// CANON-08/CANON-09's catalog<->doc parity pattern (check-catalog-agents-
// parity.mjs) applied to the hooks table instead of the invariant catalog.
//
// Usage:
//   node scripts/check-hook-doc-parity.mjs
//   node scripts/check-hook-doc-parity.mjs --settings=path --doc=path  (test fixtures)
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isMainModule } from './lib/run-helpers.mjs'

const settingsArg = process.argv.find((a) => a.startsWith('--settings='))
const docArg = process.argv.find((a) => a.startsWith('--doc='))

const SETTINGS_PATH = settingsArg
  ? resolve(settingsArg.split('=')[1])
  : resolve('.claude/settings.json')
const CLAUDE_MD_PATH = docArg ? resolve(docArg.split('=')[1]) : resolve('.claude/CLAUDE.md')

/**
 * Extract {event, matcher, filename} triples from settings.json's hooks object.
 * matcher defaults to '*' when the group omits it (e.g. PreCompact groups
 * match every invocation of that event, mirroring commander's own convention
 * for the doc table's `\*` cell).
 */
export function parseSettingsHooks(settingsJson) {
  const hooksByEvent = settingsJson.hooks ?? {}
  const out = []
  for (const [event, groups] of Object.entries(hooksByEvent)) {
    for (const group of groups ?? []) {
      const matcher = group.matcher ?? '*'
      for (const hook of group.hooks ?? []) {
        const m = /([\w.-]+\.mjs)/.exec(hook.command ?? '')
        if (!m) continue
        out.push({ event, matcher, filename: m[1] })
      }
    }
  }
  return out
}

/**
 * Extract {event, matcher, filename} triples from the CLAUDE.md hooks markdown
 * table. Rows look like:
 *   | `PreToolUse` → Edit\|Write  | `pre-edit-ssot-guard.mjs` | description |
 * The matcher cell may contain a markdown-escaped `\|` (Edit\|Write) or `\*`
 * (wildcard) — both are unescaped before comparison.
 */
export function parseClaudeMdTable(markdown) {
  const rowRe = /^\s*\|\s*`(\w+)`\s*→\s*((?:[^|\\]|\\.)+?)\s*\|\s*`([\w.-]+\.mjs)`\s*\|/gm
  const out = []
  for (const m of markdown.matchAll(rowRe)) {
    const event = m[1].trim()
    const matcher = m[2].trim().replace(/\\([|*])/g, '$1')
    const filename = m[3].trim()
    out.push({ event, matcher, filename })
  }
  return out
}

function hookKey(h) {
  return `${h.event}::${h.matcher}::${h.filename}`
}

/**
 * Symmetric diff between settings.json hooks and CLAUDE.md documented rows.
 * Returns { missingFromDoc, staleInDoc } — both empty arrays means parity.
 */
export function diffHookParity(settingsHooks, docRows) {
  const docKeys = new Set(docRows.map(hookKey))
  const settingsKeys = new Set(settingsHooks.map(hookKey))
  return {
    missingFromDoc: settingsHooks.filter((h) => !docKeys.has(hookKey(h))),
    staleInDoc: docRows.filter((h) => !settingsKeys.has(hookKey(h))),
  }
}

function main() {
  const settingsJson = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'))
  const claudeMd = readFileSync(CLAUDE_MD_PATH, 'utf-8')

  const settingsHooks = parseSettingsHooks(settingsJson)
  const docRows = parseClaudeMdTable(claudeMd)

  // Fail closed: an empty extraction on either side means the source shape
  // changed under the parser's feet — the gate must not pass vacuously.
  if (settingsHooks.length === 0) {
    throw new Error('extracted zero hooks from settings.json — parser out of date')
  }
  if (docRows.length === 0) {
    throw new Error('extracted zero rows from CLAUDE.md hooks table — parser out of date')
  }

  const { missingFromDoc, staleInDoc } = diffHookParity(settingsHooks, docRows)

  let violations = 0
  for (const h of missingFromDoc) {
    process.stdout.write(
      `  MISSING from CLAUDE.md hooks table: ${h.event} → ${h.matcher} : ${h.filename}\n`,
    )
    violations++
  }
  for (const h of staleInDoc) {
    process.stdout.write(
      `  STALE in CLAUDE.md (no matching settings.json hook): ${h.event} → ${h.matcher} : ${h.filename}\n`,
    )
    violations++
  }

  if (violations > 0) {
    process.stdout.write(
      `[check-hook-doc-parity] FAIL: ${violations} CANON-10 parity violation(s) between .claude/settings.json and .claude/CLAUDE.md\n`,
    )
    process.exit(1)
  }
  process.stdout.write(
    `[check-hook-doc-parity] OK — all ${settingsHooks.length} hooks documented, CANON-10 parity holds\n`,
  )
}

const isMain = isMainModule(import.meta.url)
if (isMain) {
  try {
    main()
  } catch (err) {
    process.stderr.write(
      `[check-hook-doc-parity] ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(1)
  }
}
