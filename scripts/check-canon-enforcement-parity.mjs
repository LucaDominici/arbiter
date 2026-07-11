#!/usr/bin/env node
// CATALOG: B1 (docs/audit/ACTION_PLAN.md, 2026-07-11) — CANON-parity enforcement gate.
// CATALOG: Rejected fold-in into check-inv-enforcement-wired.mjs (that gate matches catalog
// CATALOG: INV script *citations*, not CANON.md Enforcement-field *promotion state*) and into
// CATALOG: check-catalog-agents-parity.mjs (that gate matches title/presence between CANON.md
// CATALOG: and AGENTS.md, not whether an Enforcement field is a real gate or a dated promise).
//
// CANON-parity gate: every `## CANON-NN` entry in docs/internal/SYSTEM/CANON.md must have an
// Enforcement field that EITHER (a) cites a gate/hook/test that exists AND is wired, OR
// (b) declares an explicit dated promotion `promotion: #NNNN by YYYY-MM-DD` that has not expired.
// A field that is prose with neither → FAIL (kills advisory-forever, Kyverno: audit-mode is a
// stage with a promotion date, not a destination). An expired promotion also FAILs, forcing a
// re-decision instead of a silently-lapsed deadline.
//
// Usage: node scripts/check-canon-enforcement-parity.mjs [--canon=path] [--gate=path]
//   [--settings=path] [--root=dir] [--now=YYYY-MM-DD]
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

/** Split CANON.md into { id, body } blocks, one per `## CANON-NN` heading. */
function splitEntries(src) {
  const heads = [...src.matchAll(/^## (CANON-\d+)\b.*$/gm)]
  const entries = []
  for (let i = 0; i < heads.length; i++) {
    const start = heads[i].index
    const end = i + 1 < heads.length ? heads[i + 1].index : src.length
    entries.push({ id: heads[i][1], body: src.slice(start, end) })
  }
  return entries
}

/** Extract the **Enforcement:** field text, stopping at the next bold field or EOF. */
function extractEnforcement(body) {
  const m = body.match(/\*\*Enforcement:\*\*\s*([\s\S]*?)(?=\n\*\*[A-Za-z][A-Za-z ]*:\*\*|\n---|$)/)
  return m ? m[1].trim() : null
}

function scriptWired(root, gateSrc, name) {
  return existsSync(resolve(root, 'scripts', name)) && gateSrc.includes(name)
}

function hookRegistered(root, settingsSrc, name) {
  return existsSync(resolve(root, '.claude/hooks', name)) && settingsSrc.includes(name)
}

/** Does any citation in the enforcement text resolve to a real, wired mechanism? */
function findsWiredCitation(root, gateSrc, settingsSrc, text) {
  const hits = []

  // scripts/<name>.mjs — must exist AND be called from check-all.mjs.
  for (const m of text.matchAll(/scripts\/([a-z][a-z0-9-]+\.mjs)(?!\.ejs)/g)) {
    if (scriptWired(root, gateSrc, m[1])) hits.push(`scripts/${m[1]}`)
  }

  // Bare check-*.mjs (no scripts/ prefix) — script (wired) or hook (registered).
  const scriptsPrefixed = new Set(
    [...text.matchAll(/scripts\/([a-z0-9-]+\.mjs)/g)].map((m) => m[1]),
  )
  for (const m of text.matchAll(/(check-[a-z0-9-]+\.mjs)(?!\.ejs)/gi)) {
    const name = m[1].toLowerCase()
    if (scriptsPrefixed.has(name)) continue
    if (scriptWired(root, gateSrc, name) || hookRegistered(root, settingsSrc, name)) hits.push(name)
  }

  // .claude/hooks/<name> explicit path.
  for (const m of text.matchAll(/\.claude\/hooks\/([a-z][a-z0-9-]+\.mjs)/g)) {
    if (hookRegistered(root, settingsSrc, m[1])) hits.push(`.claude/hooks/${m[1]}`)
  }

  // __tests__/... file or directory reference — existence is sufficient (vitest
  // auto-discovers test files; no separate "wired" registry to check).
  for (const m of text.matchAll(/__tests__\/[^\s`,)]+/g)) {
    const cleaned = m[0].replace(/[.,;:]+$/, '')
    if (existsSync(resolve(root, cleaned))) hits.push(cleaned)
  }

  return hits
}

/** Explicit dated promotion: `promotion: #NNNN by YYYY-MM-DD`. Returns {issue, date} or null. */
function findPromotion(text) {
  const m = text.match(/promotion:\s*#(\d+)\s+by\s+(\d{4}-\d{2}-\d{2})/i)
  if (!m) return null
  return { issue: m[1], date: new Date(m[2]), dateStr: m[2] }
}

function parseArgs(argv) {
  const get = (name) => {
    const flag = argv.find((a) => a.startsWith(`--${name}=`))
    return flag ? flag.slice(`--${name}=`.length) : undefined
  }
  const root = resolve(get('root') ?? '.')
  return {
    root,
    canonPath: resolve(root, get('canon') ?? 'docs/internal/SYSTEM/CANON.md'),
    gatePath: resolve(root, get('gate') ?? 'scripts/check-all.mjs'),
    settingsPath: resolve(root, get('settings') ?? '.claude/settings.json'),
    now: get('now') ? new Date(get('now')) : new Date(),
  }
}

function main() {
  const { root, canonPath, gatePath, settingsPath, now } = parseArgs(process.argv.slice(2))

  const canonSrc = readFileSync(canonPath, 'utf-8')
  const gateSrc = existsSync(gatePath) ? readFileSync(gatePath, 'utf-8') : ''
  const settingsSrc = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf-8') : ''

  const entries = splitEntries(canonSrc)
  if (entries.length === 0) {
    process.stderr.write(
      `[check-canon-enforcement-parity] ERROR: no CANON-NN headings found in ${canonPath}\n`,
    )
    process.exit(2)
  }

  let violations = 0
  let gated = 0
  let staged = 0
  for (const { id, body } of entries) {
    const enforcement = extractEnforcement(body)
    if (enforcement == null) {
      process.stdout.write(`  ${id}: MISSING Enforcement field\n`)
      violations++
      continue
    }

    const hits = findsWiredCitation(root, gateSrc, settingsSrc, enforcement)
    if (hits.length > 0) {
      gated++
      continue
    }

    const promotion = findPromotion(enforcement)
    if (promotion) {
      if (promotion.date.getTime() >= now.getTime()) {
        staged++
        continue
      }
      process.stdout.write(
        `  ${id}: EXPIRED promotion (#${promotion.issue} was due ${promotion.dateStr}) — re-decide: ship the gate or extend with a reason\n`,
      )
      violations++
      continue
    }

    process.stdout.write(
      `  ${id}: PROSE-FOREVER — Enforcement cites no wired gate/hook/test and no dated promotion\n`,
    )
    violations++
  }

  if (violations > 0) {
    process.stdout.write(
      `[check-canon-enforcement-parity] FAIL: ${violations} CANON entr${violations === 1 ? 'y' : 'ies'} without wired enforcement or a live promotion date\n`,
    )
    process.exit(1)
  }
  process.stdout.write(
    `[check-canon-enforcement-parity] OK — ${entries.length} CANON entries (${gated} gated, ${staged} staged with a live promotion date)\n`,
  )
}

try {
  main()
} catch (err) {
  // Fail-closed (INV-96): an unexpected error must block, never silently pass.
  process.stderr.write(
    `[check-canon-enforcement-parity] unexpected error: ${err instanceof Error ? err.stack : String(err)}\n`,
  )
  process.exit(1)
}
