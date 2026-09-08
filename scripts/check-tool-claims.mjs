#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: Tool-claim truthfulness gate (positioning-truth) — fails when a
// CATALOG: user-facing doc claims the `--accept-beta-tools` flag ENABLES an AI
// CATALOG: tool other than the customer-facing set (claude, codex). The flag
// CATALOG: gates beta *language features* (L3 mutation/contract via isL3Allowed),
// CATALOG: NOT tool selection: `--tools` hard-rejects anything but claude/codex
// CATALOG: with E_INVALID_TOOL regardless of the flag (src/commands/init.ts).
// CATALOG: A doc that tells a reader `arbiter init --tools cursor
// CATALOG: --accept-beta-tools` works is a false public claim — the command errors.
// CATALOG: Distinct from check-install-command.mjs (package-name correctness) and
// CATALOG: check-doc-links.mjs (link resolution): this is capability-claim policy.
//
// Gate: scan user-facing docs for a sentence/line that names a non-core tool AND
// the `--accept-beta-tools` flag together (the false coupling). Allows an
// intentional counter-example marked with `<!-- tool-claim-allow -->` on the same
// or preceding line.
//
// Runs in pre-commit (via check-all.mjs L1+) over the tracked user-facing doc set.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// User-facing surfaces a newcomer reads first, plus the generated kit (templates
// render into every downstream project, so a false claim there ships to consumers).
const SCAN_PREFIXES = [
  'README.md',
  'website/',
  'docs/',
  '.claude/skills/',
  '.claude/commands/',
  'src/templates/',
  'CONTRIBUTING.md',
]

const SKIP_PATHS = [
  'scripts/check-tool-claims.mjs',
  'website/.vitepress/dist/',
  'website/node_modules/',
]

const SENTINEL = 'tool-claim-allow'

// The customer-facing tools that `--tools` actually accepts (src/commands/init.ts
// VALID set). Anything else is an experimental generator NOT selectable via --tools.
const NON_CORE_TOOLS = ['cursor', 'copilot', 'windsurf', 'aider', 'gemini']

// The false-coupling flag: docs must not present this as the enabler for a non-core
// tool. (It gates beta language features, not tool selection.)
const FLAG = 'accept-beta-tools'

function shouldScan(filePath) {
  if (SKIP_PATHS.some((skip) => filePath.startsWith(skip))) return false
  if (!filePath.endsWith('.md') && !filePath.endsWith('.md.ejs')) return false
  return SCAN_PREFIXES.some((p) => (p.endsWith('/') ? filePath.startsWith(p) : filePath === p))
}

function getAllTrackedFiles() {
  try {
    const out = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    return out.trim().split('\n').filter(Boolean)
  } catch (err) {
    // #2418: a failed `git ls-files` used to return an EMPTY corpus — the scan then found
    // nothing and the gate reported OK, the textbook fake green. No corpus, no verdict.
    throw new Error(`cannot enumerate tracked files (git ls-files failed): ${err?.message ?? err}`)
  }
}

// A violation is a single line that BOTH mentions the flag AND names a non-core
// tool — the false coupling "<non-core tool> ... --accept-beta-tools". Lines that
// only describe beta *languages* (Rust/Python) with the flag are correct and never
// match (those names are not in NON_CORE_TOOLS).
function violatesOnLine(line) {
  const lc = line.toLowerCase()
  if (!lc.includes(FLAG)) return null
  const tool = NON_CORE_TOOLS.find((t) => new RegExp(`\\b${t}\\b`, 'i').test(line))
  return tool ?? null
}

// The OTHER false claim: a `--tools <…,non-core,…>` VALUE — a copy-pasteable command
// that passes a non-core tool as the flag's argument (e.g. `--tools claude,codex,cursor`).
// `--tools` accepts ONLY claude,codex (src/commands/init.ts), so that command errors with
// E_INVALID_TOOL the moment a reader runs it. We match the flag's VALUE token only — the
// run of word/comma/space chars immediately after `--tools` — so a truthful PROSE sentence
// ("…experimental, not yet selectable via `--tools`.") that merely mentions a tool name
// elsewhere on the line is NOT flagged. The SENTINEL escape still applies.
function violatesToolsFlagOnLine(line) {
  // Capture the argument value: `--tools <value>` or `--tools=<value>`, value = the
  // contiguous comma/word run (stops at whitespace/backtick/quote/end).
  const m = line.match(/--tools[=\s]+([A-Za-z0-9,_-]+)/)
  if (!m) return null
  const value = m[1]
  const listed = value.split(',').map((t) => t.trim().toLowerCase())
  const tool = NON_CORE_TOOLS.find((t) => listed.includes(t))
  return tool ?? null
}

try {
  const files = getAllTrackedFiles()
  const violations = []

  for (const file of files) {
    if (!shouldScan(file)) continue
    let content
    try {
      content = readFileSync(join(process.cwd(), file), 'utf8')
    } catch (err) {
      // #2418: a tracked doc that could not be read was silently skipped, so the very
      // file carrying a false claim could drop out of the scan and leave the gate green.
      // (A file deleted from the tree but still in the index is the same defect: the
      // index is the corpus this gate promises to have scanned.)
      throw new Error(`tracked file ${file} is listed but unreadable: ${err?.message ?? err}`)
    }
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const prev = i > 0 ? lines[i - 1] : ''
      const allowed = line.includes(SENTINEL) || prev.includes(SENTINEL)
      if (allowed) continue
      const flagTool = violatesOnLine(line)
      if (flagTool) {
        violations.push({ file, line: i + 1, tool: flagTool, kind: 'accept-beta-tools' })
      }
      const toolsFlagTool = violatesToolsFlagOnLine(line)
      if (toolsFlagTool) {
        violations.push({ file, line: i + 1, tool: toolsFlagTool, kind: 'tools-flag' })
      }
    }
  }

  if (violations.length > 0) {
    console.error(
      '\n[check-tool-claims] FAIL — false tool-capability claim(s) in user-facing docs:\n',
    )
    for (const v of violations) {
      if (v.kind === 'tools-flag') {
        console.error(
          `  ${v.file}:${v.line}: shows \`--tools ... ${v.tool}\` — but --tools accepts only claude,codex (E_INVALID_TOOL)`,
        )
      } else {
        console.error(
          `  ${v.file}:${v.line}: claims --${FLAG} enables "${v.tool}" — but --tools rejects it with E_INVALID_TOOL`,
        )
      }
    }
    console.error(
      `\nThe --${FLAG} flag gates beta LANGUAGE features (L3 mutation/contract), not tool\n` +
        'selection. `--tools` accepts only claude,codex; cursor/copilot/windsurf/aider/gemini are\n' +
        'experimental generators NOT selectable via --tools. State that truthfully, or mark an\n' +
        `intentional counter-example with an \`<!-- ${SENTINEL} -->\` comment on the same or preceding line.`,
    )
    process.exit(1)
  }

  console.log(
    '[check-tool-claims] OK — no false --accept-beta-tools tool claims in user-facing docs',
  )
} catch (err) {
  process.stderr.write(
    `[check-tool-claims] unexpected error: ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(1)
}
