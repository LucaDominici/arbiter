#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// arbiter — emitted-markdown reference resolver (#2415, M-B consumer parity)
//
// CATALOG: resolves every script / package-script / arbiter-command / hook
// CATALOG: reference cited inside an EMITTED markdown playbook against the
// CATALOG: EMITTED tree that ships it (examples/<name>/), not against arbiter's
// CATALOG: own repo. Catches the "playbook verified in arbiter's tree, ENOENT in
// CATALOG: the consumer's" class: the emitted wave-drain skill called three
// CATALOG: scripts consumers never receive, and the emitted configure skill said
// CATALOG: `bun run arbiter` in an npm project with no `arbiter` script.
// CATALOG: rejected fold-in into check-emission-coherence.mjs (INV-123): that gate
// CATALOG: walks a freshly generated TMPDIR and resolves MACHINE surfaces
// CATALOG: (check-all.mjs, hooks.mjs, githooks, workflows, settings.json, Makefile,
// CATALOG: .claude/commands/*.md) — its markdown reach is one directory and it has
// CATALOG: no notion of a package manager or of the arbiter CLI surface. This gate
// CATALOG: walks the CHECKED-IN example corpus (skills/agents/AGENTS.md/README
// CATALOG: included), resolves `npm|bun|pnpm|yarn run <s>` against the emitted
// CATALOG: package.json AND the emitted lockfile, and resolves `arbiter <cmd> <sub>`
// CATALOG: against src/cli.ts. Different input root, different reference classes,
// CATALOG: different failure model.
// CATALOG: rejected fold-in into check-phantom-command-scan.mjs (INV-111 ext): that
// CATALOG: gate is backtick-anchored over arbiter's OWN prose + template SOURCES and
// CATALOG: is blind to fenced blocks (ADEQUACY-MAP §2). This one reads fenced blocks
// CATALOG: and asks a question that gate cannot ask — "does the target exist in the
// CATALOG: tree the reader is standing in". Its command-surface assembly was
// CATALOG: extracted to lib/cli-command-names.mjs and is SHARED, not duplicated.
//
// Dual-track (Track A self / Track B emitted): NOT APPLICABLE. The subject is
// arbiter's generator corpus (examples/ — the materialized emissions). A governed
// target has no generator corpus and no examples/ tree, so an emitted twin would be
// a gate with no subject. Declared permanently in scripts/canon01-self-only.json.
//
// Semantics
//   - Roots are auto-discovered: every directory under examples/ carrying an
//     `.arbiter-generated-manifest.json` (the marker `arbiter init` writes). A tree
//     without one is a hand-written sample, not an emission.
//   - Markdown surface: .claude/commands/*.md, .claude/skills/**/*.md,
//     .claude/agents/*.md, .agents/**/*.md, AGENTS.md, README.md.
//   - References inside fenced code blocks COUNT (that is where playbooks put their
//     commands, and exactly the blind spot behind #2415).
//   - `arbiter <cmd> [sub]` is read only inside code context (inline backticks or a
//     fenced block); prose like "arbiter emits X" is not an invocation. The other
//     three classes have shapes specific enough to scan raw.
//   - GUARDED absence is accepted: a file that also contains `[ -f <path> ]` or
//     `existsSync('<path>')` for the SAME path has declared the skip (the ship.md
//     issue-readiness pattern). Same doctrine as check-emission-coherence.mjs.
//
// Exit codes (INV-53): 0 PASS, 1 unresolved reference, 2 invocation/IO error
// (missing examples dir, missing cli source, a root with no markdown, or fewer
// roots than the floor — a required input missing is an ERROR, never a pass).
//
// Usage:
//   node scripts/check-emitted-markdown-refs.mjs
//   node scripts/check-emitted-markdown-refs.mjs --examples=dir --cli=path
//   node scripts/check-emitted-markdown-refs.mjs --json
//   node scripts/check-emitted-markdown-refs.mjs --self-test   # pure fixtures
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { globToRegExp, walkRepo } from './lib/glob-walk.mjs'
import { loadCommandSurface } from './lib/cli-command-names.mjs'
import { findPhantomCommands, findPhantomSubcommands } from './check-phantom-command-scan.mjs'
import { isMainModule } from './lib/run-helpers.mjs'

const LABEL = '[check-emitted-markdown-refs]'

// The marker `arbiter init` writes into every generated tree. Presence of this
// file is what makes a directory under examples/ an EMISSION rather than a
// hand-written sample (examples/plugins, examples/arbiter-starter).
const EMISSION_MARKER = '.arbiter-generated-manifest.json'

// Floor for discovery (fail-closed): arbiter ships three GA living examples
// (regenerate-examples.mjs LIVING_EXAMPLES). If discovery finds fewer, the scan
// silently narrowed — an ERROR, not a pass.
const MIN_ROOTS = 3

const MARKDOWN_GLOBS = [
  '.claude/commands/*.md',
  '.claude/skills/**/*.md',
  '.claude/agents/*.md',
  '.agents/**/*.md',
  'AGENTS.md',
  'README.md',
].map(globToRegExp)

// Lockfile → the package manager the emitted tree actually installs with. A
// playbook telling the reader `bun run test` in a package-lock.json project sends
// them to a tool the project does not use (#2415, the emitted configure skill).
const LOCKFILES = [
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
]

// pnpm's own verbs, which its bare `pnpm <x>` form resolves BEFORE a package
// script. Everything else in that position is a script citation.
const PNPM_BUILTINS = new Set([
  'install',
  'i',
  'add',
  'remove',
  'rm',
  'update',
  'up',
  'exec',
  'dlx',
  'why',
  'link',
  'publish',
  'store',
  'audit',
  'list',
  'ls',
  'outdated',
  'prune',
  'run',
])

// A handful of verbs that read naturally after "arbiter" in styled prose rather
// than citing an invocation. Mirrors check-phantom-command-scan.mjs's stoplist.
const PROSE_STOPWORDS = new Set(['governs', 'is', 'was', 'does', 'has', 'runs', 'works'])

const SCRIPT_RE = /\bnode\s+(scripts\/[\w./-]+\.mjs)\b/g
const PM_RUN_RE = /\b(npm|bun|pnpm|yarn)\s+run\s+([\w:.-]+)/g
const PNPM_BARE_RE = /\bpnpm\s+([\w:.-]+)/g
const HOOK_RE = /(\.claude\/hooks\/[\w.-]+\.mjs)\b/g
// `arbiter <cmd> [sub]` at a COMMAND POSITION: the start of a (masked) line or
// just after a shell separator, optionally behind a `$` prompt or an npx/bunx/dlx
// runner. Position is what separates an invocation from prose that merely contains
// the word — "Companion: ponytail (full) · arbiter gates remain the safety net" and
// "# existing arbiter project" both sit mid-line and are correctly not invocations.
// Tokens are separated by [ \t] only: `\s` would cross a newline and glue an inline
// `arbiter task` span to an unrelated word masked out three lines below.
const ARBITER_RE =
  /(?:^|[;|&(])[ \t]*(?:\$[ \t]+)?(?:(?:npx|bunx)(?:[ \t]+--no-install)?[ \t]+|(?:pnpm|yarn)[ \t]+dlx[ \t]+)?(?:@arbiter\/cli|arbiter)[ \t]+([a-z][a-z0-9-]*)(?:[ \t]+([a-z][a-z0-9-]*))?/gm

function argValue(flag) {
  const arg = process.argv.find((a) => a.startsWith(`--${flag}=`))
  return arg === undefined ? null : arg.slice(flag.length + 3)
}

function lineOf(text, index) {
  let line = 1
  for (let i = 0; i < index; i++) if (text[i] === '\n') line++
  return line
}

/**
 * Blank out everything that is NOT code context, preserving byte offsets (and
 * therefore line numbers) so a match index still maps to its source line. Code
 * context = a fenced block body or an inline-backtick span — the only places a
 * playbook actually cites an invocation. Exported for unit reuse/testing.
 */
export function maskToCodeContext(text) {
  const out = new Array(text.length).fill(' ')
  const keep = (from, to) => {
    for (let i = from; i < to && i < text.length; i++) out[i] = text[i]
  }
  // Fenced blocks first: an inline-backtick scan inside a fence would mis-pair.
  const fence = /^([ \t]*)(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^\1?\2[^\n]*$/gm
  const fenced = []
  for (const m of text.matchAll(fence)) {
    const bodyStart = m.index + m[0].indexOf('\n', 0) + 1
    keep(bodyStart, bodyStart + m[3].length)
    fenced.push([m.index, m.index + m[0].length])
  }
  const inFence = (i) => fenced.some(([a, b]) => i >= a && i < b)
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    if (inFence(m.index)) continue
    keep(m.index + 1, m.index + 1 + m[1].length)
  }
  // Newlines always survive so line numbers stay exact.
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') out[i] = '\n'
  return out.join('')
}

/**
 * True when `text` declares an existence guard for `path` — the
 * `[ -f scripts/x.mjs ] && node scripts/x.mjs` shape emitted playbooks use to
 * make an optional step's skip explicit. Same doctrine as
 * check-emission-coherence.mjs: a guard can excuse an absence, prose cannot.
 */
export function isGuarded(text, path) {
  const esc = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(\\[\\s*-f\\s+\\.?/?${esc}\\s*\\]|existsSync\\(['"\`]\\.?/?${esc})`).test(text)
}

/** Package manager + declared scripts of an emitted tree. */
export function readPackageSurface(root) {
  const pkgPath = join(root, 'package.json')
  if (!existsSync(pkgPath)) return { hasPackageJson: false, manager: null, scripts: new Set() }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(pkgPath, 'utf-8'))
  } catch (err) {
    throw new Error(`${root}/package.json is not valid JSON: ${err.message}`)
  }
  const found = LOCKFILES.find(([file]) => existsSync(join(root, file)))
  return {
    hasPackageJson: true,
    manager: found === undefined ? null : found[1],
    scripts: new Set(Object.keys(parsed.scripts ?? {})),
  }
}

/** Every markdown file in the emitted surface, as root-relative POSIX paths. */
export function emittedMarkdownFiles(root) {
  return walkRepo(root)
    .filter((rel) => MARKDOWN_GLOBS.some((re) => re.test(rel)))
    .sort()
}

/** `node scripts/<x>.mjs` and `.claude/hooks/<x>.mjs` — both resolve to a path in the tree. */
function checkPathRefs(root, text, at, problems) {
  for (const [re, label] of [
    [SCRIPT_RE, 'script'],
    [HOOK_RE, 'hook'],
  ]) {
    for (const m of text.matchAll(re)) {
      if (existsSync(join(root, m[1])) || isGuarded(text, m[1])) continue
      problems.push(`${at(m.index)} → missing ${label}: ${m[1]}`)
    }
  }
}

/** Every `<pm> run <script>` / bare `pnpm <script>` citation, as [index, manager, script]. */
function packageManagerCitations(text) {
  const citations = [...text.matchAll(PM_RUN_RE)].map((m) => [m.index, m[1], m[2]])
  for (const m of text.matchAll(PNPM_BARE_RE)) {
    if (!PNPM_BUILTINS.has(m[1])) citations.push([m.index, 'pnpm', m[1]])
  }
  return citations
}

/** The one rule a package-manager citation breaks, or null when it resolves. */
function packageRefProblem(pkg, manager, script) {
  if (!pkg.hasPackageJson) {
    return `\`${manager} run ${script}\`: the emitted tree has no package.json`
  }
  if (pkg.manager !== null && manager !== pkg.manager) {
    return `wrong package manager \`${manager}\`: the emitted lockfile is ${pkg.manager}`
  }
  if (!pkg.scripts.has(script)) {
    return `\`${manager} run ${script}\`: no such script in package.json`
  }
  return null
}

function checkPackageRefs(text, pkg, at, problems) {
  for (const [index, manager, script] of packageManagerCitations(text)) {
    const problem = packageRefProblem(pkg, manager, script)
    if (problem !== null) problems.push(`${at(index)} → ${problem}`)
  }
}

/**
 * Collect `arbiter <cmd> [sub]` citations from the code-context-masked text into the
 * shape findPhantomCommands / findPhantomSubcommands consume, plus the first source
 * offset per citation so a phantom can be reported at its own line.
 */
function collectArbiterCitations(masked) {
  const cited = new Set()
  const pairs = new Map()
  const firstIndex = new Map()
  const remember = (key, index) => {
    if (!firstIndex.has(key)) firstIndex.set(key, index)
  }
  for (const m of masked.matchAll(ARBITER_RE)) {
    if (PROSE_STOPWORDS.has(m[1])) continue
    // The separator alternative can consume the preceding newline; step past it so
    // the reported line is the invocation's own.
    const index = masked[m.index] === '\n' ? m.index + 1 : m.index
    cited.add(m[1])
    remember(m[1], index)
    if (m[2] === undefined) continue
    if (!pairs.has(m[1])) pairs.set(m[1], new Set())
    pairs.get(m[1]).add(m[2])
    remember(`${m[1]} ${m[2]}`, index)
  }
  return { cited, pairs, firstIndex }
}

function checkArbiterRefs(masked, surface, at, problems) {
  const { cited, pairs, firstIndex } = collectArbiterCitations(masked)
  const report = (phantom, label) =>
    problems.push(
      `${at(firstIndex.get(phantom) ?? 0)} → unknown arbiter ${label}: \`arbiter ${phantom}\``,
    )
  for (const phantom of findPhantomCommands(cited, surface.realCommandNames)) {
    report(phantom, 'command')
  }
  for (const phantom of findPhantomSubcommands(
    pairs,
    surface.subcommandsByCommand,
    surface.aliasToCanonical,
  )) {
    report(phantom, 'subcommand')
  }
}

function checkFile(root, rel, text, pkg, surface, problems) {
  const at = (index) => `${basename(root)}/${rel}:${lineOf(text, index)}`
  checkPathRefs(root, text, at, problems)
  checkPackageRefs(text, pkg, at, problems)
  // `arbiter <cmd> [sub]` — code context only (see header).
  checkArbiterRefs(maskToCodeContext(text), surface, at, problems)
}

/**
 * Resolve every reference in one emitted tree. `surface` comes from
 * loadCommandSurface(src/cli.ts). Throws on a tree with no markdown at all — a
 * silent empty scan is the failure this gate exists to prevent.
 */
export function checkEmittedTree(root, surface) {
  const files = emittedMarkdownFiles(root)
  if (files.length === 0) {
    throw new Error(`${root}: no emitted markdown found — the scan surface is empty`)
  }
  const pkg = readPackageSurface(root)
  const problems = []
  for (const rel of files) {
    checkFile(root, rel, readFileSync(join(root, rel), 'utf-8'), pkg, surface, problems)
  }
  return { files, problems }
}

/** Absolute paths of every generated tree under `examplesDir`. */
export function discoverEmittedRoots(examplesDir) {
  if (!existsSync(examplesDir)) throw new Error(`examples dir not found: ${examplesDir}`)
  return walkRepo(examplesDir)
    .filter((rel) => rel.endsWith(`/${EMISSION_MARKER}`) && rel.split('/').length === 2)
    .map((rel) => join(examplesDir, rel.split('/')[0]))
    .sort()
}

export function checkEmittedMarkdownRefs({ examplesDir, cliSrc }) {
  const surface = loadCommandSurface(cliSrc)
  const roots = discoverEmittedRoots(examplesDir)
  if (roots.length < MIN_ROOTS) {
    throw new Error(
      `discovered ${roots.length} emitted example tree(s) under ${examplesDir}, expected >= ${MIN_ROOTS}`,
    )
  }
  const problems = []
  let scanned = 0
  for (const root of roots) {
    const result = checkEmittedTree(root, surface)
    scanned += result.files.length
    problems.push(...result.problems)
  }
  return { roots, scanned, problems }
}

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'emitted-md-refs-self-test-'))
  const write = (rel, content) => {
    mkdirSync(join(dir, rel, '..'), { recursive: true })
    writeFileSync(join(dir, rel), content, 'utf-8')
  }
  try {
    const surface = loadCommandSurface(readFileSync(resolve('src', 'cli.ts'), 'utf-8'))
    write('package.json', JSON.stringify({ scripts: { test: 'vitest' } }))
    write('package-lock.json', '{}')
    write('scripts/check-all.mjs', '// emitted')
    write('.claude/commands/ok.md', '```bash\nnode scripts/check-all.mjs L1\nnpm run test\n```\n')
    const clean = checkEmittedTree(dir, surface).problems
    if (clean.length !== 0) {
      process.stderr.write(`${LABEL} self-test FAILED: coherent tree reported ${clean}\n`)
      return 1
    }
    write('.claude/commands/bad.md', '```bash\nnode scripts/ghost.mjs\nbun run test\n```\n')
    write('.claude/agents/bad.md', '`arbiter ghostcmd`\n')
    const dirty = checkEmittedTree(dir, surface).problems
    const wanted = ['scripts/ghost.mjs', 'wrong package manager', 'ghostcmd']
    const missed = wanted.filter((w) => !dirty.some((p) => p.includes(w)))
    if (missed.length !== 0 || dirty.length !== 3) {
      process.stderr.write(
        `${LABEL} self-test FAILED: expected 3 problems covering ${wanted}, got ${JSON.stringify(dirty)}\n`,
      )
      return 1
    }
    process.stdout.write(`${LABEL} self-test OK (coherent tree passes, 3 ghost classes caught)\n`)
    return 0
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function main() {
  if (process.argv.includes('--self-test')) process.exit(selfTest())
  const examplesDir = resolve(argValue('examples') ?? 'examples')
  const cliPath = resolve(argValue('cli') ?? join('src', 'cli.ts'))
  const asJson = process.argv.includes('--json')
  let result
  try {
    result = checkEmittedMarkdownRefs({ examplesDir, cliSrc: readFileSync(cliPath, 'utf-8') })
  } catch (err) {
    process.stderr.write(`${LABEL} ERROR: ${err.message}\n`)
    process.exit(2)
  }
  if (asJson) {
    process.stdout.write(
      // `.map(basename)` would hand Array.map's index to basename's `suffix`
      // parameter and throw — the arrow keeps it unary.
      `${JSON.stringify({ roots: result.roots.map((r) => basename(r)), scanned: result.scanned, problems: result.problems }, null, 2)}\n`,
    )
  } else if (result.problems.length === 0) {
    process.stdout.write(
      `${LABEL} OK — ${result.scanned} emitted markdown file(s) across ${result.roots.length} tree(s), every reference resolves\n`,
    )
  } else {
    for (const p of result.problems) process.stdout.write(`${LABEL} ${p}\n`)
    process.stdout.write(`${LABEL} FAIL — ${result.problems.length} unresolved reference(s)\n`)
  }
  process.exit(result.problems.length === 0 ? 0 : 1)
}

if (isMainModule(import.meta.url)) main()
