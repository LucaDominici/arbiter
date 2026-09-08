#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// T1 (convergence playbook §T1, plugin packaging): build packages/kernel/hooks/
// from the SAME templates arbiter emits into governed repos — so the kernel
// plugin can never silently drift from what `arbiter init` ships. Renders the
// EJS-templated J1 completion-integrity hooks with a neutral, representative
// config (no project-specific data leaks in); copies the already-standalone
// (non-templated) safety hooks verbatim.
//
// Fail-closed (INV-96): all imperative work runs inside buildKernelPlugin(),
// wrapped (at the CLI entrypoint below) in a top-level try/catch that exits
// non-zero on ANY error — a render throw, a missing source hook, or a non-zero
// prettier reformat all abort the build instead of leaving a partial/unformatted
// plugin behind.
//
// Usage: node scripts/build-kernel-plugin.mjs [--out=<dir>]  (run after `npm run build`)
//   --out=<dir>  render into <dir> instead of packages/kernel/hooks/ (#2548 —
//                lets scripts/check-kernel-plugin-parity.mjs, and the CANON-24
//                flip-proof in scripts/lib/guard-flip-registry.mjs, render through
//                this EXACT path into a throwaway directory rather than
//                reimplementing rendering a second time).
//
// buildKernelPlugin() is exported (#2548) for the same reason: one real render
// path, never a second independently-maintained one that could itself drift
// from what actually ships (the #1877/#1894 two-renderers-of-one-output class).
import { mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { renderTemplate } from '../dist/utils/render.js'
import { resolveCollaborationAxes } from '../dist/config/collaboration-mode-defaults.js'
import { DEFAULT_TASK_TIERS } from '../dist/config/schema.js'
import { isMainModule } from './lib/run-helpers.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const DEFAULT_OUT_DIR = join(root, 'packages', 'kernel', 'hooks')

// Neutral representative config — deliberately generic (no company/product
// name, per the playbook's no-company-reference rule §0.4). Only the fields
// the four rendered templates actually read need real values; every other
// field below is a generic stand-in.
const config = {
  targetDir: '/tmp/kernel-plugin-render',
  projectName: 'my-project',
  description: 'A governed project',
  language: 'typescript',
  framework: null,
  archetype: 'library',
  architectureStyle: 'none',
  isMultiTenant: false,
  hasDatabase: false,
  hasPublicApi: false,
  buildTool: 'npm',
  buildCommand: 'npm run build',
  testCommand: 'npm test',
  lintCommand: 'npm run lint',
  formatCommand: 'npx prettier --check .',
  tools: ['claude'],
  governanceLevel: 'L2',
  useGitHub: false,
  githubOwner: null,
  githubRepo: null,
  existing: {
    agentsMd: false,
    claudeDir: false,
    agentsDir: false,
    aiRulez: false,
    settingsJson: false,
    checkAllScript: false,
    geminiDir: false,
    windsurfRules: false,
    aiderConf: false,
  },
  languageHooks: [],
  enableDebtGates: true,
  enableSuppressions: true,
  enableSecurityScanning: true,
  enableSoloDevMode: false,
  enableEvidenceHarness: true,
  invariantTiers: [],
  basePackage: undefined,
}

function buildRenderContext(cfg) {
  const taskTiers = cfg.taskTiers ?? DEFAULT_TASK_TIERS
  const axes = resolveCollaborationAxes(cfg)
  return { ...cfg, taskTiers, ...axes }
}

// The J1 kernel — completion-integrity, EJS-templated, rendered once here.
// Deliberately does NOT render hooks.mjs.ejs (the full-set dispatcher) — that
// dispatcher's HANDLERS table assumes arbiter's entire ~25-hook emission, so
// invoking it here (a ~10-hook subset) would spawnSync missing files. The
// plugin instead wires each hook DIRECTLY per event in hooks/hooks.json —
// exactly the direct-wiring style arbiter's own dogfooded `.claude/settings.json`
// already uses (see .claude/settings.json at the repo root).
export const RENDERED = [
  ['claude/hooks/lib.mjs.ejs', 'lib.mjs'],
  ['claude/hooks/stop-evidence-guard.mjs.ejs', 'stop-evidence-guard.mjs'],
  ['claude/hooks/guard-done-evidence.mjs.ejs', 'guard-done-evidence.mjs'],
  ['claude/hooks/check-no-orphan-todo.mjs.ejs', 'check-no-orphan-todo.mjs'],
  ['claude/hooks/check-no-placeholders.mjs.ejs', 'check-no-placeholders.mjs'],
]

// Already-standalone (non-templated) safety hooks — copied verbatim, byte-
// identical to what arbiter emits (no divergence possible by construction).
// check-no-orphan-todo.mjs and check-no-placeholders.mjs used to live here too,
// but both became EJS-templated (they read `sourceExtensions`) and moved up to
// RENDERED (#2538) — copying their .ejs source verbatim would have shipped raw
// `<% %>` template syntax as an unrunnable hook.
export const COPIED = [
  'stop-dangerous.mjs',
  'enforce-read-only.mjs',
  'enforce-gate-before-pr.mjs',
  'pre-edit-ssot-guard.mjs',
]

/**
 * Render + copy the kernel-plugin hook corpus into `outDir` (default:
 * packages/kernel/hooks/, the tree committed in this repo). Throws on any
 * failure (render error, missing source hook, non-zero prettier) — callers
 * decide how to translate that to an exit code.
 */
export function buildKernelPlugin(outDir = DEFAULT_OUT_DIR) {
  mkdirSync(outDir, { recursive: true })

  const data = buildRenderContext(config)

  for (const [tpl, out] of RENDERED) {
    const content = renderTemplate(tpl, data)
    writeFileSync(join(outDir, out), content, 'utf-8')
    process.stdout.write(`  rendered ${tpl} -> hooks/${out}\n`)
  }

  for (const name of COPIED) {
    const src = join(root, 'src', 'templates', 'claude', 'hooks', name)
    copyFileSync(src, join(outDir, name))
    process.stdout.write(`  copied   claude/hooks/${name} -> hooks/${name}\n`)
  }

  process.stdout.write(
    `\nbuild-kernel-plugin: ${RENDERED.length} rendered + ${COPIED.length} copied -> packages/kernel/hooks/\n`,
  )

  // hooks.json — direct per-event wiring (mirrors arbiter's own dogfooded
  // .claude/settings.json; NOT the full-set hooks.mjs dispatcher, see above).
  // ${CLAUDE_PLUGIN_ROOT} is the documented Claude Code plugin path variable —
  // resolves to this plugin's install directory at load time.
  const ROOT = '${CLAUDE_PLUGIN_ROOT}'
  const cmd = (name) => ({
    type: 'command',
    command: `node ${ROOT}/hooks/${name}`,
    timeout: 5,
  })
  const hooksJson = {
    hooks: {
      PreToolUse: [
        { matcher: 'Bash', hooks: [cmd('stop-dangerous.mjs'), cmd('enforce-gate-before-pr.mjs')] },
        {
          matcher: 'Edit|Write',
          hooks: [cmd('enforce-read-only.mjs'), cmd('pre-edit-ssot-guard.mjs')],
        },
      ],
      PostToolUse: [
        {
          matcher: 'Edit|Write',
          hooks: [cmd('check-no-orphan-todo.mjs'), cmd('check-no-placeholders.mjs')],
        },
      ],
      UserPromptSubmit: [{ hooks: [{ ...cmd('guard-done-evidence.mjs'), timeout: 3 }] }],
      Stop: [{ hooks: [{ ...cmd('stop-evidence-guard.mjs'), timeout: 5 }] }],
    },
  }
  writeFileSync(join(outDir, 'hooks.json'), JSON.stringify(hooksJson, null, 2) + '\n', 'utf-8')
  process.stdout.write('  wrote    hooks/hooks.json (direct per-event wiring)\n')

  // Sanity: no leftover EJS delimiters in the rendered output.
  for (const [, out] of RENDERED) {
    const body = readFileSync(join(outDir, out), 'utf-8')
    if (body.includes('<%') || body.includes('%>')) {
      throw new Error(`${out} still contains EJS delimiters`)
    }
  }
  process.stdout.write('build-kernel-plugin: OK — no leftover EJS delimiters\n')

  // Reformat the rendered files (EJS output keeps the template's own semicolon
  // style; the repo's format gate scans packages/ too) so the build stays
  // reproducible without a manual `prettier --write` step afterward. Fail-closed:
  // a non-zero prettier aborts the build rather than leaving an unformatted plugin.
  //
  // `--config` is EXPLICIT (#2548), not left to prettier's own upward directory
  // search: prettier resolves config by walking up from the FORMATTED FILE's own
  // path, so an `outDir` outside this repo (scripts/check-kernel-plugin-parity.mjs
  // renders into an mkdtemp()'d dir, deliberately never under the repo) would
  // silently fall back to prettier's stock defaults (double quotes, semicolons) —
  // a real reformat, not a no-op, that would make every parity comparison report
  // spurious drift on quote/semicolon style alone. Pinning the repo's own
  // .prettierrc.json keeps rendering identical regardless of where outDir lives.
  const fmt = spawnSync(
    'npx',
    ['prettier', '--write', '--config', join(root, '.prettierrc.json'), outDir],
    { cwd: root, stdio: 'inherit' },
  )
  if (fmt.status !== 0) {
    throw new Error(`prettier --write on ${outDir} exited ${fmt.status ?? 'null (spawn failed)'}`)
  }
}

/** `--out=<dir>` (relative to cwd, or absolute) → that dir; otherwise DEFAULT_OUT_DIR. */
function parseOutDir(argv) {
  const hit = argv.find((a) => a.startsWith('--out='))
  return hit ? resolve(hit.slice('--out='.length)) : DEFAULT_OUT_DIR
}

// Guarded (#2548): scripts/check-kernel-plugin-parity.mjs and the guard-flip fixture in
// scripts/lib/guard-flip-registry.mjs both invoke this file as a CHILD PROCESS (never
// import it), specifically so that merely IMPORTING buildKernelPlugin cannot ever run it
// against the real packages/kernel/hooks/ — a parity check that writes into the tree it
// is checking is not a check. The guard is still correct defense-in-depth either way.
if (isMainModule(import.meta.url)) {
  try {
    buildKernelPlugin(parseOutDir(process.argv.slice(2)))
  } catch (err) {
    process.stderr.write(
      `build-kernel-plugin: FATAL — ${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(1)
  }
}
