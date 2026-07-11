#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// T1 (convergence playbook §T1, plugin packaging): build packages/kernel/hooks/
// from the SAME templates arbiter emits into governed repos — so the kernel
// plugin can never silently drift from what `arbiter init` ships. Renders the
// EJS-templated J1 completion-integrity hooks with a neutral, representative
// config (no project-specific data leaks in); copies the already-standalone
// (non-templated) safety hooks verbatim.
//
// Usage: node scripts/build-kernel-plugin.mjs  (run after `npm run build`)
import { mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { renderTemplate } from '../dist/utils/render.js'
import { resolveCollaborationAxes } from '../dist/config/collaboration-mode-defaults.js'
import { DEFAULT_TASK_TIERS } from '../dist/config/schema.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const outDir = join(root, 'packages', 'kernel', 'hooks')
mkdirSync(outDir, { recursive: true })

// Neutral representative config — deliberately generic (no company/product
// name, per the playbook's no-company-reference rule §0.4). Only the fields
// the four rendered templates actually read need real values; everything
// else uses a safe placeholder.
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

const data = buildRenderContext(config)

// The J1 kernel — completion-integrity, EJS-templated, rendered once here.
// Deliberately does NOT render hooks.mjs.ejs (the full-set dispatcher) — that
// dispatcher's HANDLERS table assumes arbiter's entire ~25-hook emission, so
// invoking it here (a ~10-hook subset) would spawnSync missing files. The
// plugin instead wires each hook DIRECTLY per event in hooks/hooks.json —
// exactly the direct-wiring style arbiter's own dogfooded `.claude/settings.json`
// already uses (see .claude/settings.json at the repo root).
const RENDERED = [
  ['claude/hooks/lib.mjs.ejs', 'lib.mjs'],
  ['claude/hooks/stop-evidence-guard.mjs.ejs', 'stop-evidence-guard.mjs'],
  ['claude/hooks/guard-done-evidence.mjs.ejs', 'guard-done-evidence.mjs'],
]

for (const [tpl, out] of RENDERED) {
  const content = renderTemplate(tpl, data)
  writeFileSync(join(outDir, out), content, 'utf-8')
  process.stdout.write(`  rendered ${tpl} -> hooks/${out}\n`)
}

// Already-standalone (non-templated) safety hooks — copied verbatim, byte-
// identical to what arbiter emits (no divergence possible by construction).
const COPIED = [
  'stop-dangerous.mjs',
  'enforce-read-only.mjs',
  'enforce-gate-before-pr.mjs',
  'pre-edit-ssot-guard.mjs',
  'check-no-orphan-todo.mjs',
  'check-no-placeholders.mjs',
]

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
writeFileSync(
  join(root, 'packages', 'kernel', 'hooks', 'hooks.json'),
  JSON.stringify(hooksJson, null, 2) + '\n',
  'utf-8',
)
process.stdout.write('  wrote    hooks/hooks.json (direct per-event wiring)\n')

// Sanity: no leftover EJS delimiters in the rendered output.
for (const [, out] of RENDERED) {
  const body = readFileSync(join(outDir, out), 'utf-8')
  if (body.includes('<%') || body.includes('%>')) {
    process.stderr.write(`build-kernel-plugin: FAIL — ${out} still contains EJS delimiters\n`)
    process.exit(1)
  }
}
process.stdout.write('build-kernel-plugin: OK — no leftover EJS delimiters\n')

// Reformat the rendered files (EJS output keeps the template's own semicolon
// style; the repo's format gate scans packages/ too) so the build stays
// reproducible without a manual `prettier --write` step afterward.
const fmt = spawnSync('npx', ['prettier', '--write', outDir], { cwd: root, stdio: 'inherit' })
if (fmt.status !== 0) {
  process.stderr.write('build-kernel-plugin: WARN — prettier --write on hooks/ did not exit 0\n')
}
