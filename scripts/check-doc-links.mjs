#!/usr/bin/env node
// Gate: verify markdown links in docs/ resolve; follow CANONICAL_PATHS redirects. (INV-55, #255)
// Exits 0: all links resolve (possibly via redirect) or no docs found.
// Exits 1: one or more broken links with no valid redirect.
// Also emits .arbiter/reports/doc-links.json ({ broken, filesScanned }) for the gold-audit
// D-DOCS doc-link-integrity value check (GA-DOC-08) — deterministic, read by the gold engine.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { walkRepo } from './lib/glob-walk.mjs'
import { loadDocGateAllowlist, allowlistSummary } from './lib/doc-gate-allowlist.mjs'

const CWD = process.cwd()
const CANONICAL_PATHS_FILE = join(CWD, 'docs', 'internal', 'METHOD', 'CANONICAL_PATHS.md')
const IGNORE_FILE = join(CWD, '.docs-links-ignore')
const WEBSITE_ROOT = join(CWD, 'website')
const VITEPRESS_CONFIG = join(WEBSITE_ROOT, '.vitepress', 'config.ts')

// Scan roots — extended in P6 to cover every hand-authored markdown tree (was:
// docs/ only), and again in F2 (#1838, item 3) to add website/. website/ was
// excluded until now because VitePress route paths (e.g. `/comparisons/spec-kit`)
// resolve via the site's router, not as a relative filesystem path — plain
// file-existence resolution produced false positives. resolveHref() below
// special-cases `/`-absolute hrefs under website/ with VitePress's own
// route→file convention (trailing `/` or extensionless → index.md) instead of
// excluding the tree outright, which is what let 3 dead links in
// website/governance/index.md pass silently until F1 caught them by hand (#1837).
const SCAN_ROOTS = ['docs', '.claude', '.agents', '.codex', 'examples', 'website']
const ROOT_FILES = [
  'AGENTS.md',
  'README.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'GLOBAL_INVARIANTS.md',
  'OBSIDIAN.md',
]
export const SKIP_PATH_SEGMENTS = [
  `${sep}node_modules${sep}`,
  `${sep}dist${sep}`,
  `${sep}.git${sep}`,
  `${sep}.changeset${sep}`,
  `${sep}api${sep}`,
  `${sep}.coverage-tmp${sep}`,
  `${sep}.evidence${sep}`,
  `${sep}report${sep}`,
  // #2408: `internal` used to sit here, so no gate ever resolved a link under
  // docs/internal/** — the SSOT backbone. What cannot be fixed as a one-liner
  // now lives, dated, in scripts/data/doc-gate-allowlist.json instead.
]

const ignored = new Set()
if (existsSync(IGNORE_FILE)) {
  readFileSync(IGNORE_FILE, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((p) => ignored.add(p))
}

function loadAliases() {
  const aliases = new Map()
  if (!existsSync(CANONICAL_PATHS_FILE)) return aliases
  const lines = readFileSync(CANONICAL_PATHS_FILE, 'utf-8').split('\n')
  for (const line of lines) {
    const m = line.match(/\|\s*`([^`]+)`\s*\|\s*`([^`]+)`/)
    if (m) aliases.set(m[1], m[2])
  }
  return aliases
}

function shouldSkip(absPath) {
  return SKIP_PATH_SEGMENTS.some((seg) => absPath.includes(seg))
}

/**
 * Collect every `.md` file under `dir` (recursively). Traversal is delegated to the shared
 * cycle-safe walkRepo (#1521/#1544); this gate's own SKIP_PATH_SEGMENTS are re-applied to each
 * returned path so the visited set is identical to the old hand-rolled walk (minus the symlink-
 * cycle bug), plus walkRepo's widened SKIP_DIRS (build/coverage/.coverage). Returns absolute paths.
 */
export function findMarkdownFiles(dir) {
  if (!existsSync(dir) || shouldSkip(dir + sep)) return []
  const files = []
  for (const rel of walkRepo(dir)) {
    const full = join(dir, rel)
    if (shouldSkip(full)) continue
    if (rel.endsWith('.md')) files.push(full)
  }
  return files
}

function collectScanFiles() {
  const out = []
  for (const r of SCAN_ROOTS) {
    out.push(...findMarkdownFiles(join(CWD, r)))
  }
  for (const f of ROOT_FILES) {
    const abs = join(CWD, f)
    if (existsSync(abs) && statSync(abs).isFile()) out.push(abs)
  }
  return out
}

function isLocal(href) {
  return (
    !href.startsWith('http://') &&
    !href.startsWith('https://') &&
    !href.startsWith('#') &&
    !href.startsWith('mailto:')
  )
}

function isUnderWebsite(fileAbsPath) {
  return fileAbsPath === WEBSITE_ROOT || fileAbsPath.startsWith(WEBSITE_ROOT + sep)
}

/**
 * Candidate files VitePress would try to serve a route/relative path from,
 * relative to `baseDir`: a literal path (covers extensioned assets), then
 * `<path>.md`, then `<path>/index.md` — VitePress resolves BOTH `/reference/cli`
 * (site-root route) AND a bare relative link like `plugin` (sibling page,
 * `cleanUrls: true` convention — see website/recipes/index.md's `(plugin)`,
 * `(custom-invariant)`, etc.) by trying the same extension-then-index chain.
 * A trailing slash (or the empty path, i.e. the site root) skips straight to
 * `index.md` — VitePress never serves `<dir>.md` for a directory route.
 * Returns the first candidate that exists, or the `.md` candidate (for the
 * error message) when none do.
 */
export function vitePressCandidates(baseDir, cleanPath) {
  if (cleanPath === '' || cleanPath.endsWith('/')) {
    return [join(baseDir, cleanPath, 'index.md')]
  }
  return [
    join(baseDir, cleanPath),
    join(baseDir, `${cleanPath}.md`),
    join(baseDir, cleanPath, 'index.md'),
  ]
}

function firstExistingOrLast(candidates) {
  return candidates.find((c) => existsSync(c)) ?? candidates[candidates.length - 1]
}

/**
 * Resolve a markdown link's href to the filesystem path it claims to point at.
 * Under website/ (see SCAN_ROOTS comment), both `/`-absolute site-root routes
 * and bare relative sibling links get VitePress's own extension-then-index
 * resolution (vitePressCandidates), plus a `public/` asset candidate for
 * absolute routes (VitePress serves website/public/* at the site root).
 * Everywhere else, resolution is exactly what it was before this gate covered
 * website/ (path.resolve, no extension-guessing) — zero regression risk for
 * docs/, .claude/, etc.
 */
function resolveHref(fileAbsPath, fileDir, href) {
  if (!isUnderWebsite(fileAbsPath)) return resolve(fileDir, href)

  if (href.startsWith('/')) {
    const clean = href.slice(1)
    const candidates = vitePressCandidates(WEBSITE_ROOT, clean)
    if (clean !== '' && !clean.endsWith('/')) {
      candidates.splice(1, 0, join(WEBSITE_ROOT, 'public', clean))
    }
    return firstExistingOrLast(candidates)
  }

  return firstExistingOrLast(vitePressCandidates(fileDir, href))
}

// Extract [text](href) links from markdown
const LINK_PATTERN = /\[([^\]]*)\]\(([^)]+)\)/g

function stripCodeSpansAndBlocks(text) {
  // Remove fenced code blocks first (```...```), then inline code spans (`...`).
  const noFences = text.replace(/```[\s\S]*?```/g, '')
  return noFences.replace(/`[^`\n]*`/g, '')
}

// A self-referential https://github.com/<owner>/<repo>/(blob|tree)/<ref>/<path>
// URL is a "local" link wearing a remote costume: isLocal() skips it entirely
// (it starts with https://), so a repo-path move — like the docs/internal/
// split (#1770) — can leave one dangling with no gate ever looking at it.
// website/.vitepress/config.ts's nav/sidebar links use exactly this pattern
// (they can't use a relative markdown link — the target isn't part of the
// VitePress page graph), which is where the F2 audit actually caught 2 dead
// links pointing at the pre-#1770 docs/ADR and docs/SYSTEM/DECISIONS.md paths.
const GITHUB_SELF_LINK_RE =
  /https:\/\/github\.com\/LucaDominici\/arbiter\/(?:blob|tree)\/[^/\s'")]+\/([^\s'")#]+)/g

/**
 * Scan raw file content (unstripped — config.ts has no fences/code-spans to
 * strip, and a genuine link inside a markdown code sample would still be
 * worth catching) for self-referential GitHub blob/tree URLs, and verify
 * each target path exists in this checkout (following CANONICAL_PATHS
 * redirects, same as the relative-link check above).
 */
function checkGithubSelfLinks(files, aliases) {
  let broken = 0
  for (const file of files) {
    if (!existsSync(file)) continue
    const raw = readFileSync(file, 'utf-8')
    const srcRel = relative(CWD, file)
    for (const m of raw.matchAll(GITHUB_SELF_LINK_RE)) {
      const relTarget = m[1]
      if (ignored.has(relTarget)) continue
      if (existsSync(join(CWD, relTarget))) continue

      const redirectTarget = aliases.get(relTarget)
      if (redirectTarget && existsSync(join(CWD, redirectTarget))) continue

      process.stdout.write(
        redirectTarget
          ? `  broken: ${srcRel}: github self-link → ${relTarget} → redirect ${redirectTarget} also missing\n`
          : `  broken: ${srcRel}: github self-link → ${relTarget}\n`,
      )
      broken++
    }
  }
  return broken
}

// #2408: frontmatter `related:` entries are links too — they are how docs/INDEX.md
// and the wiki cross-reference the corpus — but no gate ever resolved one, which is
// how 16 entries survived the docs/ -> docs/internal/ move still pointing at
// `docs/ADR/**` and `docs/SYSTEM/**`.
//
// Only PATH-SHAPED entries are validated. The corpus also uses bare slugs as
// related keys — ADR numbers (`053`), ADR titles (`088-ship-as-orchestration-
// entrypoint`) and skill names (`tdd`, `gold-audit`) — which name a document
// without asserting where it lives; resolving those would be guesswork, and
// guesswork in a gate is noise. A path-shaped entry has a `/` and a file
// extension.
const RELATED_PATH_SHAPE = /\//
const RELATED_HAS_EXTENSION = /\.[A-Za-z0-9]+$/

/**
 * Extract the quoted entries of the frontmatter `related:` key, if any.
 * The block runs from `related:` to the next top-level frontmatter key.
 */
export function extractRelatedEntries(content) {
  if (!content.startsWith('---')) return []
  const end = content.indexOf('\n---', 3)
  if (end < 0) return []
  const frontmatter = content.slice(0, end)
  const start = frontmatter.search(/^related:/m)
  if (start < 0) return []
  const rest = frontmatter.slice(start + 'related:'.length)
  const nextKey = rest.search(/^[A-Za-z_][A-Za-z0-9_]*:/m)
  const block = nextKey < 0 ? rest : rest.slice(0, nextKey)
  return [...block.matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => m[1] ?? m[2])
}

/**
 * Candidate filesystem locations for a `related:` entry. The corpus writes them
 * in four shapes — repo-root (`docs/internal/ADR/050-x.md`), relative to the
 * citing doc (`TARGET.md`), relative to `docs/` (`PRODUCT/PRD.md`) and relative
 * to `docs/internal/` (`METHOD/PROCESS.md`) — and all four are legitimate; the
 * entry resolves if ANY of them exists.
 */
export function relatedCandidates(fileDir, entry) {
  return [
    join(CWD, entry),
    resolve(fileDir, entry),
    join(CWD, 'docs', entry),
    join(CWD, 'docs', 'internal', entry),
  ]
}

function checkRelatedPaths(file, content, aliases) {
  let broken = 0
  const fileDir = dirname(file)
  for (const entry of extractRelatedEntries(content)) {
    if (!RELATED_PATH_SHAPE.test(entry) || !RELATED_HAS_EXTENSION.test(entry)) continue
    if (ignored.has(entry)) continue
    if (relatedCandidates(fileDir, entry).some((c) => existsSync(c))) continue

    const redirectTarget = aliases.get(entry)
    if (redirectTarget && existsSync(join(CWD, redirectTarget))) continue

    process.stdout.write(
      `  broken: ${relative(CWD, file)}: frontmatter related: → ${entry}
`,
    )
    broken++
  }
  return broken
}

// Emit the deterministic report (consumed by gold-audit GA-DOC-08) in both branches.
function writeDocLinksReport(brokenCount, filesScanned) {
  const out = join(CWD, '.arbiter', 'reports', 'doc-links.json')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify({ broken: brokenCount, filesScanned }, null, 2) + '\n')
}

function main() {
  const allow = loadDocGateAllowlist('doc-links')
  process.stdout.write(allowlistSummary('check-doc-links', allow))

  const aliases = loadAliases()
  const markdownFiles = collectScanFiles()

  if (markdownFiles.length === 0 && !existsSync(VITEPRESS_CONFIG)) {
    process.stdout.write('  check-doc-links: no docs found — skipping\n')
    process.exit(0)
  }

  let broken = 0

  for (const file of markdownFiles) {
    if (allow.has(relative(CWD, file))) continue
    const raw = readFileSync(file, 'utf-8')
    broken += checkRelatedPaths(file, raw, aliases)
    const content = stripCodeSpansAndBlocks(raw)
    const fileDir = dirname(file)
    for (const linkMatch of content.matchAll(LINK_PATTERN)) {
      const href = linkMatch[2].split('#')[0]
      if (!href || !isLocal(href)) continue

      const absTarget = resolveHref(file, fileDir, href)
      const relTarget = relative(CWD, absTarget)

      if (ignored.has(relTarget)) continue
      if (existsSync(absTarget)) continue

      const redirectTarget = aliases.get(relTarget)
      if (redirectTarget) {
        const absRedirect = join(CWD, redirectTarget)
        if (existsSync(absRedirect)) continue
        const srcRel = relative(CWD, file)
        process.stdout
          .write(`  broken: ${srcRel}: ${relTarget} → redirect ${redirectTarget} also missing
`)
      } else {
        const srcRel = relative(CWD, file)
        process.stdout.write(`  broken: ${srcRel}: ${relTarget}
`)
      }
      broken++
    }
  }

  // Self-referential GitHub blob/tree URLs: scanned across every collected
  // markdown file plus the VitePress config (its nav/sidebar links are TS
  // string literals, never markdown, so collectScanFiles() never sees it).
  const scannedMarkdown = markdownFiles.filter((f) => !allow.has(relative(CWD, f)))
  const githubSelfLinkFiles = existsSync(VITEPRESS_CONFIG)
    ? [...scannedMarkdown, VITEPRESS_CONFIG]
    : scannedMarkdown
  broken += checkGithubSelfLinks(githubSelfLinkFiles, aliases)

  writeDocLinksReport(broken, markdownFiles.length)

  if (broken === 0) {
    process.stdout.write(
      `  check-doc-links: all links resolve (${markdownFiles.length} files scanned)
`,
    )
    process.exit(0)
  }

  process.stdout.write(`\n  check-doc-links: ${broken} broken link(s) found
`)
  process.exit(1)
}

// Only run main when invoked as CLI (not imported in tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
