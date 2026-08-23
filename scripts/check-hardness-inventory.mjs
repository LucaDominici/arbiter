#!/usr/bin/env node
// Arbiter L1 gate: validate hook hardness manifest
// Usage: node scripts/check-hardness-inventory.mjs [--manifest <path>] [--hooks-dir <dir>]
// Checks:
//   1. Drift: every hook file in hooks-dir has a manifest entry; every entry points to existing file
//   2. HARD+spawnable hooks: spawn with fixture, assert exit code matches manifest
//   3. Codex parity: every entry with tools["codex"] is wired in the Codex config template
import { spawnSync } from 'node:child_process'
import {
  readFileSync,
  readdirSync,
  existsSync,
  writeFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
} from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')

// Lazily render the hook lib.mjs once. Hooks now import resolveToolInputPath (and friends)
// from a sibling ./lib.mjs, so a HARD hook spawned in isolation must be staged next to a
// real lib.mjs or it crashes with ERR_MODULE_NOT_FOUND (a false "ceremony regression").
let _renderedLib = null
async function renderHookLib() {
  if (_renderedLib !== null) return _renderedLib
  const libTemplate = join(REPO_ROOT, 'src/templates/claude/hooks/lib.mjs.ejs')
  if (!existsSync(libTemplate)) {
    _renderedLib = ''
    return _renderedLib
  }
  const ejs = (await import('ejs')).default
  _renderedLib = ejs.render(readFileSync(libTemplate, 'utf-8'), { projectName: 'arbiter' })
  return _renderedLib
}

/**
 * Stage a hook into a temp dir alongside a rendered lib.mjs so its `./lib.mjs` import
 * resolves when spawned in isolation. Returns the staged hook path and a cleanup fn.
 */
async function stageHookWithLib(hookPath) {
  let src = readFileSync(hookPath, 'utf-8')
  if (hookPath.endsWith('.ejs')) {
    const ejs = (await import('ejs')).default
    src = ejs.render(src, {
      projectName: 'arbiter',
      sourceExtensions: [
        '.ts',
        '.tsx',
        '.js',
        '.jsx',
        '.java',
        '.py',
        '.go',
        '.rs',
        '.cs',
        '.rb',
        '.php',
      ],
    })
  }
  if (!/from\s+['"]\.\/lib\.mjs['"]/.test(src)) {
    if (!hookPath.endsWith('.ejs')) return { staged: hookPath, cleanup: () => {} }
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-hardness-hook-'))
    const staged = join(
      dir,
      hookPath
        .split('/')
        .pop()
        .replace(/\.ejs$/, ''),
    )
    writeFileSync(staged, src)
    return { staged, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
  }
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-hardness-hook-'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'lib.mjs'), await renderHookLib())
  const staged = join(
    dir,
    hookPath
      .split('/')
      .pop()
      .replace(/\.ejs$/, ''),
  )
  writeFileSync(staged, src)
  return { staged, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

// Parse args
const args = process.argv.slice(2)
let manifestPath = join(REPO_ROOT, '.arbiter/hooks-manifest.json')
let hooksDir = join(REPO_ROOT, 'src/templates/claude/hooks')
let codexTemplatePath = join(REPO_ROOT, 'src/templates/codex/config.toml.ejs')
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--manifest' && args[i + 1]) manifestPath = args[++i]
  if (args[i] === '--hooks-dir' && args[i + 1]) hooksDir = args[++i]
  if (args[i] === '--codex-template' && args[i + 1]) codexTemplatePath = args[++i]
}

let failed = 0
function fail(msg) {
  process.stdout.write(`[FAIL] ${msg}\n`)
  failed++
}
function pass(msg) {
  process.stdout.write(`[PASS] ${msg}\n`)
}

// Load manifest
if (!existsSync(manifestPath)) {
  process.stdout.write(`[hardness-drift] manifest not found: ${manifestPath}\n`)
  process.exit(1)
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
const manifestByFile = new Map(manifest.hooks.map((h) => [h.file, h]))

// ─── #2326: self-surface mode ────────────────────────────────────────────────
// The default surface is `src/templates/claude/hooks` — hooks staged into a tmpdir next
// to a TEMPLATE-rendered lib.mjs. That model is structurally wrong for a project's own
// materialized `.claude/hooks/`, and was measured to produce a VACUOUS GREEN:
//
//   1. Arbiter self-hardens its hooks with repo-root scoping
//      (`if (!file.startsWith(process.cwd())) process.exit(0)`), which the templates do
//      not carry. A fixture in os.tmpdir() makes every such hook exit 0 — the gate then
//      reports a healthy blocker while the hook is dead.
//   2. `.claude/hooks/lib.mjs` imports `../../scripts/lib/suppressions-shared.mjs`, which
//      cannot resolve from a tmpdir; and a hook staged beside the TEMPLATE lib is not the
//      pair that broke in #2324 (a missing export from the SELF lib).
//
// Self mode therefore spawns each hook IN PLACE, with cwd at the repo root that owns the
// hooks dir, and writes its fixture inside that repo. Opt-in via `selfSurface: true` on
// the manifest — never a path heuristic, so the template invocation is byte-identical.
const selfSurface = manifest.selfSurface === true
const ownerRoot = resolve(hooksDir, '..', '..')
const fixtureRoot = join(ownerRoot, '.arb-hardness-tmp')

// ─── 0. HARD blocking-code invariant (#1631) ────────────────────────────────────
// Under the Claude Code hook protocol, exit 2 is the ONLY blocking code: a PreToolUse
// exit 2 aborts the tool call and feeds stderr to the agent; a PostToolUse exit 2 feeds
// the violation back to the agent. Any OTHER non-zero exit (including 1) is NON-BLOCKING
// — the tool call proceeds and the agent never sees the violation. A "HARD" guard that
// declares expectedExitCode 1 is therefore pure ceremony (it certified a non-blocking
// exit as enforcement). Enforce that every HARD hook declaring an expectedExitCode
// declares 2, so a future HARD guard cannot silently regress to a non-blocking exit.
for (const entry of manifest.hooks) {
  if (entry.classification !== 'HARD' || entry.expectedExitCode === undefined) continue
  if (entry.expectedExitCode === 2) {
    pass(`${entry.file} declares blocking exit 2 (HARD)`)
  } else {
    fail(
      `[hardness-blocking] ${entry.file} is HARD but declares expectedExitCode ${entry.expectedExitCode} — ` +
        `HARD guards block only via exit 2 (exit 1 is non-blocking under the Claude Code hook protocol). See #1631.`,
    )
  }
}

// ─── 1. Drift detection ───────────────────────────────────────────────────────

// Every hook file in hooksDir (excluding lib.mjs.ejs) must have a manifest entry
// `hooks.mjs` is the dispatcher and `lib.mjs` a shared helper — neither is a hook, so
// neither owes a hardness classification. The template dir only ever contains the `.ejs`
// forms; a materialized dir contains the rendered ones too.
// NOTE: `hooks.mjs.ejs` stays IN scope for the template surface — it has a manifest entry
// there and dropping it would silently weaken an existing drift assertion.
const NOT_HOOKS = new Set(['lib.mjs.ejs', ...(selfSurface ? ['lib.mjs', 'hooks.mjs'] : [])])
const hookFiles = readdirSync(hooksDir)
  .filter((f) => (f.endsWith('.mjs') || f.endsWith('.mjs.ejs')) && !NOT_HOOKS.has(f))
  .sort()

for (const file of hookFiles) {
  if (!manifestByFile.has(file)) {
    fail(
      `hook file '${file}' has no manifest entry — add it to ${manifestPath} with explicit classification`,
    )
  } else {
    pass(`manifest entry found: ${file}`)
  }
}

// Every manifest entry must point to an existing file in hooksDir
for (const entry of manifest.hooks) {
  const fullPath = join(hooksDir, entry.file)
  if (!existsSync(fullPath)) {
    fail(`manifest entry '${entry.file}' points to non-existent file — drift detected`)
  }
}

// ─── 2. HARD hook empirical assertions ───────────────────────────────────────

const hardSpawnable = manifest.hooks.filter(
  (h) => h.classification === 'HARD' && h.spawnable === true,
)

for (const entry of hardSpawnable) {
  const hookPath = join(hooksDir, entry.file)
  const { fixture, expectedExitCode } = entry

  if (!fixture) {
    fail(`${entry.file} is HARD+spawnable but has no fixture defined in manifest`)
    continue
  }

  const env = { ...process.env }
  // Strip bypass flags so hooks are tested in their natural enforced state. Each of these
  // turns a blocking hook into an exit-0 one, so an operator environment that exports one
  // would otherwise hand the gate a false green.
  delete env['ARBITER_SSOT_BYPASS']
  delete env['ARBITER_ALLOW_CHANNEL_DOWNGRADE']
  if (selfSurface) {
    delete env['ARBITER_PLAN_BYPASS']
    delete env['ARBITER_FINDING_LOSS_HARD']
    delete env['ARBITER_SPAWN_GUARD_HARD']
    // Hooks that debounce on sha1(cwd) would no-op on every run after the first.
    env['ARBITER_HOOK_DEBOUNCE_MS'] = '0'
  }
  const tmpFiles = []

  if (fixture.type === 'path-only') {
    // #2326: point the hook at an existing repo file WITHOUT writing it. Required for
    // guards whose subject is a real protected path (enforce-read-only -> LICENSE,
    // pre-edit-ssot-guard -> AGENTS.md). Resolved to an ABSOLUTE path because the hooks'
    // repo-root guard compares prefixes — a relative fixture silently yields exit 0.
    // This type exists because a writing fixture aimed at a real path truncated a tracked
    // SSOT during development; it must be structurally impossible, not merely avoided.
    env[fixture.envKey] = join(ownerRoot, fixture.path)
  } else if (fixture.type === 'file-with-content') {
    const ext = fixture.extension ?? '.ts'
    // In self mode the fixture MUST live inside the probed repo or the hooks' repo-root
    // guard short-circuits. `fixture.path` places it precisely (e.g. `src/...` for the
    // INV-12 guard, which additionally requires a src/-relative path).
    const target = selfSurface
      ? join(ownerRoot, fixture.path ?? join('.arb-hardness-tmp', `fixture${ext}`))
      : join(mkdtempSync(join(tmpdir(), 'arbiter-hardness-')), `fixture${ext}`)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, fixture.content)
    env[fixture.envKey] = target
    tmpFiles.push(selfSurface ? target : dirname(target))
  } else if (fixture.type === 'env-only') {
    Object.assign(env, fixture.env)
  }

  // Template surface: stage the hook next to a rendered lib.mjs (no-op when it has no lib
  // import). Self surface: run it WHERE IT LIVES, so `./lib.mjs` resolves to the project's
  // own lib — the only arrangement that can observe self-pair drift (#2324) — with cwd at
  // the repo root so `process.cwd()`-based scoping matches production.
  // Empty stdin either way, so resolveToolInputPath falls back to the fixture env var.
  const { staged, cleanup } = selfSurface
    ? { staged: hookPath, cleanup: () => {} }
    : await stageHookWithLib(hookPath)
  let result
  try {
    result = spawnSync('node', [staged], {
      encoding: 'utf-8',
      env,
      input: '',
      ...(selfSurface ? { cwd: ownerRoot } : {}),
    })
  } finally {
    cleanup()
    // Unconditional: a fixture that survives a failing run is worse than no coverage —
    // a leftover child_process import under src/ is itself an INV-12 violation.
    for (const d of tmpFiles) rmSync(d, { recursive: true, force: true })
    if (selfSurface) rmSync(fixtureRoot, { recursive: true, force: true })
  }

  if (result.status === expectedExitCode) {
    pass(`${entry.file} exits ${expectedExitCode} on violation fixture`)
  } else {
    fail(
      `[hardness-drift] ${entry.file} declared HARD (expected exit ${expectedExitCode}) but exited ${result.status} — ceremony regression detected`,
    )
  }
}

// ─── 3. Codex parity check ────────────────────────────────────────────────────

const codexEntries = manifest.hooks.filter(
  (h) => Array.isArray(h.tools) && h.tools.includes('codex'),
)

if (codexEntries.length > 0) {
  if (!existsSync(codexTemplatePath)) {
    for (const entry of codexEntries) {
      fail(
        `manifest entry '${entry.file}' declares tools:["codex"] but Codex config template not found at ${codexTemplatePath}`,
      )
    }
  } else {
    const codexTemplate = readFileSync(codexTemplatePath, 'utf-8')
    for (const entry of codexEntries) {
      // Strip .ejs suffix from static hooks to get the actual hook filename
      const hookFile = entry.file.replace(/\.ejs$/, '')
      if (codexTemplate.includes(hookFile)) {
        pass(`Codex config template wires adapter for: ${hookFile}`)
      } else {
        fail(
          `manifest entry '${entry.file}' declares tools:["codex"] but '${hookFile}' is missing from Codex config template`,
        )
      }
    }
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────────

if (failed > 0) {
  process.stdout.write(`\n=== HARDNESS INVENTORY FAILED: ${failed} check(s) ===\n`)
  process.exit(1)
} else {
  process.stdout.write(
    `\n=== HARDNESS INVENTORY PASSED (${hookFiles.length} hooks, ${hardSpawnable.length} HARD empirically verified, ${codexEntries.length} Codex parity verified) ===\n`,
  )
}
