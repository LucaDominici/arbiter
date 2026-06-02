#!/usr/bin/env node
// Generates and validates the CLI command-reference region in website/reference/cli.md.
// Source of truth: src/cli.ts (all 72 .command() calls live there; no build step needed).
//
// Usage:
//   node scripts/gen-cli-ref.mjs           # write marker region into cli.md
//   node scripts/gen-cli-ref.mjs --check   # exit 1 if region is out of date; exit 2 on error
//
// Exit codes (INV-53): 0 = OK / 1 = drift / 2 = invocation error
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const CHECK = process.argv.includes('--check')

// Allow overriding paths via --cli=path and --doc=path (used by tests with fixtures).
const cliArg = process.argv.find((a) => a.startsWith('--cli='))
const docArg = process.argv.find((a) => a.startsWith('--doc='))

const root = resolve('.')
const CLI_TS = cliArg ? resolve(cliArg.split('=')[1]) : resolve(root, 'src', 'cli.ts')
const CLI_MD = docArg
  ? resolve(docArg.split('=')[1])
  : resolve(root, 'website', 'reference', 'cli.md')

const BEGIN_MARKER = '<!-- BEGIN GENERATED:cli -->'
const END_MARKER = '<!-- END GENERATED:cli -->'

// ── Source reading ──────────────────────────────────────────────────────────

function readSources() {
  if (!existsSync(CLI_TS)) {
    process.stdout.write(`  gen-cli-ref: error — cli source not found: ${CLI_TS}\n`)
    process.exit(2)
  }
  if (!existsSync(CLI_MD)) {
    process.stdout.write(`  gen-cli-ref: error — cli doc not found: ${CLI_MD}\n`)
    process.exit(2)
  }
  return {
    clsSrc: readFileSync(CLI_TS, 'utf-8'),
    docSrc: readFileSync(CLI_MD, 'utf-8'),
  }
}

// ── CLI.ts parser ───────────────────────────────────────────────────────────

/**
 * Extract top-level commands registered on `program` from cli.ts source.
 * Returns [{name, description, options: [{flags, desc}], subcommands: [{name, description}]}]
 *
 * Strategy: join the source into a single string (preserving newlines), then
 * locate blocks that contain `program` followed by `.command('X')`. Multi-line
 * method chains are handled by looking ahead up to 50 chars for the .command call.
 */
function parseCliTs(src) {
  // Strip single-line comments to avoid matching commented-out code.
  const stripped = src.replace(/\/\/.*/g, '')

  // Find top-level commands: `program` (possibly with `const X =` assignment)
  // followed (within ~50 chars, across potential newlines) by `.command('name')`.
  // This intentionally does NOT match `varName.command(...)` (sub-commands on variables).
  const topLevelRe = /\bprogram\s*[\s\S]{0,50}?\.command\('([^'<>\n]+?)'\)/g
  const topLevelNames = new Set()
  for (const m of stripped.matchAll(topLevelRe)) {
    // Strip argument specs (<required> [optional]) — use only the base command name.
    const baseName = m[1].trim().split(/[\s<[]/)[0]
    topLevelNames.add(baseName)
  }

  // Build per-command info: for each top-level command, find description and options.
  // We do a second pass to find command registration blocks.
  const commands = []
  for (const name of [...topLevelNames].sort()) {
    // Find the block for this specific command.
    // Look for the `.command('name')` line, then scan forward for .description and .option calls.
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const blockRe = new RegExp(
      `\\.command\\('${escapedName}'\\)([\\s\\S]{0,2000}?)(?=\\.command\\('|const |var |let |\\bprogram\\b|$)`,
    )
    const blockMatch = blockRe.exec(stripped)
    let description = ''
    const options = []
    const subNames = []

    if (blockMatch) {
      const block = blockMatch[0]

      // Extract description.
      const descMatch =
        /\.description\('([^']+)'\)/.exec(block) ?? /\.description\("([^"]+)"\)/.exec(block)
      if (descMatch) description = descMatch[1]

      // Extract options.
      for (const om of block.matchAll(/\.option\(\s*'([^']+)'\s*,\s*'([^']+)'/g)) {
        options.push({ flags: om[1], desc: om[2] })
      }
      for (const om of block.matchAll(/\.option\(\s*'([^']+)'\s*,\s*"([^"]+)"/g)) {
        options.push({ flags: om[1], desc: om[2] })
      }
    }

    // Find subcommands: look for `varName.command('sub')` patterns where varName
    // is a variable that holds this top-level command. We look for variables
    // whose name is assigned from `program.command('name')`.
    // Use strict adjacency (`varName\s*\.command`) to avoid matching the original
    // `const varName = program\n  .command('name')` assignment as a subcommand.
    const varRe = new RegExp(`const\\s+(\\w+)\\s*=[\\s\\S]{0,30}?\\.command\\('${escapedName}'\\)`)
    const varMatch = varRe.exec(stripped)
    if (varMatch) {
      const varName = varMatch[1]
      const subRe = new RegExp(`\\b${varName}\\s*\\.command\\('([^'<>]+)'\\)`, 'g')
      for (const sm of stripped.matchAll(subRe)) {
        const subName = sm[1].trim()
        // Skip if the captured subcommand name is the same as the top-level command name
        // (this avoids the self-referencing artifact from the variable assignment).
        if (subName === name) continue
        // Get description for the subcommand
        const subEscaped = subName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const subBlockRe = new RegExp(
          `\\.command\\('${subEscaped}'\\)([\\s\\S]{0,500}?)(?=\\.command\\('|$)`,
        )
        const subBlock = subBlockRe.exec(stripped)
        let subDesc = ''
        if (subBlock) {
          const sdm =
            /\.description\('([^']+)'\)/.exec(subBlock[0]) ??
            /\.description\("([^"]+)"\)/.exec(subBlock[0])
          if (sdm) subDesc = sdm[1]
        }
        subNames.push({ name: subName, description: subDesc })
      }
    }

    commands.push({ name, description, options, subcommands: subNames })
  }

  return commands
}

// ── Region generator ────────────────────────────────────────────────────────

/** Escape angle brackets in free text for VitePress/Vue (interprets < > as HTML tags). */
function escHtml(s) {
  return s.replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function generateRegion(commands) {
  const lines = []

  lines.push('## Command Reference')
  lines.push('')
  lines.push('| Command | Description |')
  lines.push('|---------|-------------|')
  for (const cmd of commands) {
    lines.push(`| \`arbiter ${cmd.name}\` | ${escHtml(cmd.description || '—')} |`)
  }
  lines.push('')

  for (const cmd of commands) {
    lines.push(`## arbiter ${cmd.name}`)
    lines.push('')
    if (cmd.description) {
      lines.push(escHtml(cmd.description) + '.')
      lines.push('')
    }

    if (cmd.subcommands.length > 0) {
      lines.push('**Subcommands:**')
      lines.push('')
      for (const sub of cmd.subcommands) {
        const subDesc = sub.description ? ` — ${escHtml(sub.description)}` : ''
        lines.push(`- \`arbiter ${cmd.name} ${sub.name}\`${subDesc}`)
      }
      lines.push('')
    }

    if (cmd.options.length > 0) {
      lines.push('**Options:**')
      lines.push('')
      for (const opt of cmd.options) {
        // Flags stay in backtick span (safe); escape angle brackets in free-text description.
        lines.push(`- \`${opt.flags}\` — ${escHtml(opt.desc)}`)
      }
      lines.push('')
    }
  }

  return lines.join('\n')
}

// ── Marker region helpers ───────────────────────────────────────────────────

function extractMarkerRegion(docSrc) {
  const beginIdx = docSrc.indexOf(BEGIN_MARKER)
  const endIdx = docSrc.indexOf(END_MARKER)
  if (beginIdx === -1 || endIdx === -1) return null
  // Return the content between the markers (exclusive of markers themselves).
  return docSrc.slice(beginIdx + BEGIN_MARKER.length, endIdx)
}

function replaceMarkerRegion(docSrc, newContent) {
  const beginIdx = docSrc.indexOf(BEGIN_MARKER)
  const endIdx = docSrc.indexOf(END_MARKER)
  if (beginIdx === -1 || endIdx === -1) {
    // Append markers at end if not present.
    return docSrc.trimEnd() + '\n\n' + BEGIN_MARKER + '\n' + newContent + END_MARKER + '\n'
  }
  return docSrc.slice(0, beginIdx + BEGIN_MARKER.length) + '\n' + newContent + docSrc.slice(endIdx)
}

// ── Main ────────────────────────────────────────────────────────────────────

try {
  const { clsSrc, docSrc } = readSources()

  const commands = parseCliTs(clsSrc)
  if (commands.length === 0) {
    process.stdout.write(`  gen-cli-ref: error — no commands parsed from ${CLI_TS}\n`)
    process.exit(2)
  }

  const generated = generateRegion(commands)

  if (CHECK) {
    const existing = extractMarkerRegion(docSrc)
    if (existing === null) {
      process.stdout.write(
        `  gen-cli-ref: FAIL — BEGIN GENERATED:cli marker not found in ${CLI_MD}\n`,
      )
      process.exit(1)
    }

    const existingCommands = new Set([...existing.matchAll(/^## arbiter (\S+)/gm)].map((m) => m[1]))
    const registeredCommands = new Set(commands.map((c) => c.name))

    const missing = [...registeredCommands].filter((n) => !existingCommands.has(n))
    const phantom = [...existingCommands].filter((n) => !registeredCommands.has(n))

    if (missing.length === 0 && phantom.length === 0) {
      process.stdout.write(`  gen-cli-ref: OK — ${commands.length} commands documented, no drift\n`)
      process.exit(0)
    }

    if (missing.length > 0) {
      process.stdout.write(
        `  gen-cli-ref: FAIL — ${missing.length} registered command(s) missing from generated region: ${missing.join(', ')}\n`,
      )
    }
    if (phantom.length > 0) {
      process.stdout.write(
        `  gen-cli-ref: FAIL — ${phantom.length} phantom command(s) in generated region (not registered): ${phantom.join(', ')}\n`,
      )
    }
    process.exit(1)
  }

  // Write mode: replace or insert the marker region.
  const updated = replaceMarkerRegion(docSrc, generated)
  writeFileSync(CLI_MD, updated, 'utf-8')
  process.stdout.write(
    `  gen-cli-ref: wrote ${commands.length}-command CLI reference region to ${CLI_MD}\n`,
  )
} catch (err) {
  process.stdout.write(`  gen-cli-ref: fatal — ${err.message}\n`)
  process.exit(2)
}
