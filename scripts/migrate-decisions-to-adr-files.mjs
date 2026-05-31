#!/usr/bin/env node
// One-time migration: extract DECISIONS.md sections into docs/ADR/ per-file format.
// Run once during Wave 2, then keep as evidence artifact.
// Usage: node scripts/migrate-decisions-to-adr-files.mjs [--dry-run]
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve('.')
const DECISIONS_PATH = join(root, 'docs', 'SYSTEM', 'DECISIONS.md')
const ADR_DIR = join(root, 'docs', 'ADR')
const DRY_RUN = process.argv.includes('--dry-run')

const decisionsText = readFileSync(DECISIONS_PATH, 'utf-8')

/** Extract section body for ## ADR-NNN: heading. Returns first match by default, or Nth match. */
function extractSection(text, numStr, occurrence = 1) {
  const re = new RegExp(`^## ADR-${numStr}:[^\\n]+\\n([\\s\\S]*?)(?=^## |^---\\n\\n## |$)`, 'gm')
  let match
  let count = 0
  while ((match = re.exec(text)) !== null) {
    count++
    if (count === occurrence) {
      return {
        heading: match[0].split('\n')[0].replace(/^## /, ''),
        body: match[1].trimEnd(),
      }
    }
  }
  return null
}

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/^adr-\d+[:\s—–-]+/, '') // strip "ADR-NNN: " prefix
    .replace(/\s*\(#\d+[^)]*\)\s*$/, '') // strip trailing "(#NNN, date)"
    .replace(/\s*\(\d{4}-\d{2}-\d{2}\)\s*$/, '') // strip trailing "(date)"
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
    .replace(/-$/, '')
}

function makeAdrFile(num, heading, body) {
  const numStr = String(num).padStart(3, '0')
  const status = /\*\*Status:\*\*\s*Accepted/.test(body) ? 'active' : 'active'
  const title = heading.startsWith('ADR-') ? heading : `ADR-${numStr}: ${heading}`
  const slug = slugify(heading)
  const filename = `${numStr}-${slug}.md`
  const frontmatter = [
    '---',
    `title: '${title.replace(/'/g, "''")}'`,
    `doc_version: '1.0.0'`,
    `status: ${status}`,
    `last_review: '2026-05-31'`,
    `owner: ''`,
    `canonical_id: '${numStr}'`,
    `tags: ['audience/dev', 'kind/adr']`,
    `related: []`,
    '---',
    '',
    `# ${title}`,
    '',
  ].join('\n')
  return { filename, content: frontmatter + body + '\n' }
}

// Mapping: [targetNum, sourceNumStr, occurrence]
const MIGRATIONS = [
  [54, '054', 1],
  [55, '055', 2], // second occurrence = SpotBugs (older, L831) → canonical 055
  [56, '056', 1],
  [57, '057', 1],
  [58, '058', 1],
  [59, '059', 1],
  [60, '060', 1],
  [61, '061', 1],
  [62, '062', 1],
  [63, '063', 1],
  [64, '064', 1],
  [65, '065', 1],
  [66, '066', 1],
  [67, '067', 1],
  [68, '068', 1],
  [69, '069', 1],
  [70, '070', 1],
  [71, '071', 1],
  [72, '072', 1],
  [73, '055', 1], // first occurrence = FE Governance (L19) → reassigned 073
  [74, '050', 2], // second occurrence = Risk register (L129) → reassigned 074
]

try {
  let created = 0
  let skipped = 0

  for (const [targetNum, sourceNum, occurrence] of MIGRATIONS) {
    const section = extractSection(decisionsText, sourceNum, occurrence)
    if (section === null) {
      process.stdout.write(
        `  WARN: no section found for ADR-${sourceNum} (occurrence ${occurrence})\n`,
      )
      continue
    }

    const { filename, content } = makeAdrFile(targetNum, section.heading, section.body)
    const outPath = join(ADR_DIR, filename)

    if (existsSync(outPath)) {
      process.stdout.write(`  skip (exists): ${filename}\n`)
      skipped++
      continue
    }

    if (DRY_RUN) {
      process.stdout.write(`  [dry-run] would create: ${filename}\n`)
    } else {
      writeFileSync(outPath, content, 'utf-8')
      process.stdout.write(`  created: ${filename}\n`)
      created++
    }
  }

  process.stdout.write(`\nDone. Created: ${created}, Skipped: ${skipped}\n`)
} catch (err) {
  process.stdout.write(`  migrate-decisions-to-adr-files: fatal — ${err.message}\n`)
  process.exit(1)
}
