#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// CATALOG: P5 tag-backfill. Adds tags from docs/METHOD/TAG_TAXONOMY.md to the
// `tags:` frontmatter field, derived from each file's path. Idempotent. Cannot
// fold into scripts/docs-add-frontmatter.mjs (frontmatter creation) — this
// runs AFTER frontmatter exists; it only mutates the `tags:` field.
//
// Usage:
//   node scripts/docs-backfill-tags.mjs --dry-run
//   node scripts/docs-backfill-tags.mjs --check    # exit 1 if any change pending
//   node scripts/docs-backfill-tags.mjs --apply

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'

const REPO_ROOT = resolve(new URL('..', import.meta.url).pathname)
const SCAN_ROOTS = ['docs', '.claude', '.agents', '.codex', 'examples']
const ROOT_FILES = [
  'AGENTS.md',
  'README.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'GLOBAL_INVARIANTS.md',
  'OBSIDIAN.md',
]
const SKIP_PATH_SEGMENTS = [
  `${sep}node_modules${sep}`,
  `${sep}dist${sep}`,
  `${sep}.git${sep}`,
  `${sep}.changeset${sep}`,
  `${sep}api${sep}`,
  `${sep}.coverage-tmp${sep}`,
  `${sep}.evidence${sep}`,
  `${sep}report${sep}`,
]

// Path → tags. First match wins for `kind/*`; multiple non-kind tags accumulate.
// All tags must exist in docs/METHOD/TAG_TAXONOMY.md.
const KIND_RULES = [
  [/^docs\/ADR\//, 'kind/adr'],
  [/^docs\/RUNBOOKS\//, 'kind/runbook'],
  [/^docs\/audits\//, 'kind/audit'],
  [/^docs\/MIGRATION\//, 'kind/migration'],
  [/^docs\/SECURITY\//, 'kind/security'],
  [/^docs\/GOVERNANCE\//, 'kind/governance'],
  [/^docs\/api\//, 'kind/api'],
  [/^docs\/REFERENCE\//, 'kind/reference'],
  [/^docs\/99-ARCHIVE\//, 'kind/archive'],
  [/^docs\/architecture\/README\.md$/, 'kind/spine'],
  [/^docs\/architecture\//, 'kind/method'],
  [/^docs\/SYSTEM\/CANON\.md$/, 'kind/canon'],
  [/^docs\/SYSTEM\/DECISIONS\.md$/, 'kind/adr'],
  [/^docs\/SYSTEM\//, 'kind/method'],
  [/^docs\/METHOD\/(SSOT_CORE_SET|KNOWLEDGE_MAP|CANONICAL_PATHS)\.md$/, 'kind/ssot'],
  [/^docs\/METHOD\//, 'kind/method'],
  [/^docs\/install\//, 'kind/setup'],
  [/^docs\/SETUP\.md$/, 'kind/setup'],
  [/^docs\/QUICKSTART\.md$/, 'kind/setup'],
  [/^docs\/SEMVER\.md$/, 'kind/reference'],
  [/^docs\/FAQ\.md$/, 'kind/reference'],
  [/^docs\/CHANNELS\.md$/, 'kind/reference'],
  [/^docs\/TEST_TAXONOMY\.md$/, 'kind/method'],
  [/^docs\/TESTING_POLICY\.md$/, 'kind/method'],
  [/^docs\/SECURE_CODING_CHECKLIST\.md$/, 'kind/security'],
  [/^docs\/PLUGIN-API\.md$/, 'kind/api'],
  [/^docs\/MASTER_TEST_PLAN\.md$/, 'kind/method'],
  [/^docs\/CODING_STANDARDS\.md$/, 'kind/method'],
  [/^docs\/sponsors\.md$/, 'kind/reference'],
  [/^docs\/case-studies\//, 'kind/reference'],
  [/^docs\/i18n\//, 'kind/reference'],
  [/^docs\/internal\//, 'kind/internal'],
  [/^docs\/plans\//, 'kind/method'],
  [/^docs\/rfc\//, 'kind/method'],
  [/^docs\/testing\//, 'kind/method'],
  [/^docs\/DEVELOPMENT\//, 'kind/method'],
  [/^docs\/development\//, 'kind/method'],
  [/^docs\/CI_GOVERNANCE\.md$/, 'kind/governance'],
  [/^docs\/CONTRIBUTING\.md$/, 'kind/governance'],
  [/^docs\//, 'kind/reference'],
  [/^\.claude\//, 'kind/internal'],
  [/^\.agents\//, 'kind/internal'],
  [/^\.codex\//, 'kind/internal'],
  [/^examples\//, 'kind/reference'],
  [/^AGENTS\.md$/, 'kind/governance'],
  [/^GLOBAL_INVARIANTS\.md$/, 'kind/invariant'],
  [/^README\.md$/, 'kind/spine'],
  [/^OBSIDIAN\.md$/, 'kind/setup'],
  [/^CODE_OF_CONDUCT\.md$/, 'kind/governance'],
  [/^CONTRIBUTING\.md$/, 'kind/governance'],
  [/^SECURITY\.md$/, 'kind/security'],
]

const AUDIENCE_RULES = [
  [/^\.claude\/|^\.agents\/|^\.codex\//, 'audience/agent'],
  [/^docs\/SECURITY\//, 'audience/auditor'],
  [/^docs\/audits\//, 'audience/auditor'],
  [/^docs\/RUNBOOKS\//, 'audience/ops'],
]

const SCOPE_RULES = [
  [/^src\/templates\//, 'scope/framework'],
  [/^docs\/architecture\/dual-track-contract\.md$/, 'scope/dual-track'],
]

function shouldSkip(absPath) {
  return SKIP_PATH_SEGMENTS.some((s) => absPath.includes(s))
}

function walk(dir, out = []) {
  if (!existsSync(dir) || shouldSkip(dir + sep)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (shouldSkip(p + sep)) continue
      walk(p, out)
    } else if (e.isFile() && e.name.endsWith('.md')) out.push(p)
  }
  return out
}

function collectFiles() {
  const out = []
  for (const r of SCAN_ROOTS) walk(join(REPO_ROOT, r), out)
  for (const f of ROOT_FILES) {
    const abs = join(REPO_ROOT, f)
    if (existsSync(abs) && statSync(abs).isFile()) out.push(abs)
  }
  return out
}

function computeTags(relPath) {
  const tags = new Set()
  tags.add('audience/dev')
  for (const [re, t] of KIND_RULES) {
    if (re.test(relPath)) {
      tags.add(t)
      break
    }
  }
  for (const [re, t] of AUDIENCE_RULES) {
    if (re.test(relPath)) tags.add(t)
  }
  for (const [re, t] of SCOPE_RULES) {
    if (re.test(relPath)) tags.add(t)
  }
  return [...tags].sort()
}

function parseFrontmatterBlock(content) {
  if (!content.startsWith('---')) return null
  const lines = content.split('\n')
  if (lines[0] !== '---') return null
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') return { lines, endIdx: i }
  }
  return null
}

function replaceTagsLine(content, tags) {
  const parsed = parseFrontmatterBlock(content)
  if (!parsed) return null
  const blockStart = 1
  const blockEnd = parsed.endIdx
  const blockLines = parsed.lines.slice(blockStart, blockEnd)
  const tagsIdx = blockLines.findIndex((ln) => /^tags\s*:/.test(ln))
  if (tagsIdx < 0) return null
  const formatted = tags.length === 0 ? '[]' : `[${tags.map((t) => `'${t}'`).join(', ')}]`
  blockLines[tagsIdx] = `tags: ${formatted}`
  return [
    ...parsed.lines.slice(0, blockStart),
    ...blockLines,
    ...parsed.lines.slice(blockEnd),
  ].join('\n')
}

const { values } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    check: { type: 'boolean', default: false },
    apply: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' },
  },
})

if (values.help || (!values['dry-run'] && !values.check && !values.apply)) {
  console.error('Usage: docs-backfill-tags.mjs (--dry-run | --check | --apply)')
  process.exit(values.help ? 0 : 2)
}

const files = collectFiles()
let changed = 0
let unchanged = 0
const changedFiles = []

for (const f of files) {
  const rel = f.replace(REPO_ROOT + sep, '')
  const content = readFileSync(f, 'utf-8')
  const tags = computeTags(rel)
  const next = replaceTagsLine(content, tags)
  if (next === null) {
    unchanged++
    continue
  }
  if (next === content) {
    unchanged++
    continue
  }
  changed++
  changedFiles.push(rel)
  if (values.apply) writeFileSync(f, next)
}

const mode = values.apply ? 'APPLY' : values.check ? 'CHECK' : 'DRY-RUN'
console.error(`docs-backfill-tags [${mode}]`)
console.error(`  scanned   : ${files.length}`)
console.error(`  unchanged : ${unchanged}`)
console.error(`  changed   : ${changed}`)
if (changed > 0 && !values.apply) {
  for (const f of changedFiles.slice(0, 20)) console.error(`    ${f}`)
  if (changedFiles.length > 20) console.error(`    ... +${changedFiles.length - 20} more`)
}

if (values.check && changed > 0) process.exit(1)
