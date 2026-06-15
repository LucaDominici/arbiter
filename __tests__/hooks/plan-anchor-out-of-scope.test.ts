// SPDX-License-Identifier: Apache-2.0
//
// #1402 — pre-edit-plan-anchor out-of-scope SOFT redirect.
//
// Property: when an edit targets a file OUTSIDE the active plan's machine-parseable `files:`
// manifest, the hook emits a SOFT advisory via stdout and exits 0 (NEVER exit 2). This must not
// block legitimate multi-file edits. Editing a file that IS in the manifest, or any edit when the
// plan has no `files:` manifest, produces no redirect. `__tests__/` edits are excluded.
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig, writeTaskStateFile } from '../helpers.js'

function configFor() {
  return makeConfig('/tmp/test', {
    language: 'typescript',
    governanceLevel: 'L2',
    buildTool: 'npm',
    testCommand: 'npm test',
    lintCommand: 'npm run lint',
    formatCommand: 'npx prettier --write',
  })
}

// A valid Context Block with a machine-parseable `files:` manifest.
const PLAN_WITH_MANIFEST = `---
context: >-
  Test plan with a files manifest.
issues: ["#1402"]
type: task
pipeline: ship
branch_convention: "task/#<issue>-<slug>"
base_branch: main
key_constraints:
  - none
red_team_warnings:
  - none
estimate: "S"
files:
  - src/in-scope.ts
  - src/also-in-scope.ts
---

# Plan
Step 1: do something.
`

const PLAN_NO_MANIFEST = `---
context: >-
  Test plan without a files manifest.
issues: ["#1402"]
type: task
pipeline: ship
branch_convention: "task/#<issue>-<slug>"
base_branch: main
key_constraints:
  - none
red_team_warnings:
  - none
estimate: "S"
---

# Plan
Step 1: do something.
`

function setup(planContent: string) {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-oos-'))
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' })
  const hooksDir = join(dir, '.claude', 'hooks')
  mkdirSync(hooksDir, { recursive: true })
  // Pre-create the edited files so the CANON-16 survey gate (new-files-only) never fires here.
  mkdirSync(join(dir, 'src'), { recursive: true })
  for (const f of ['in-scope.ts', 'also-in-scope.ts', 'out-of-scope.ts']) {
    writeFileSync(join(dir, 'src', f), 'export const x = 1;\n')
  }
  writeFileSync(join(hooksDir, 'lib.mjs'), renderTemplate('claude/hooks/lib.mjs.ejs', configFor()))
  const hookPath = join(hooksDir, 'pre-edit-plan-anchor.mjs')
  writeFileSync(hookPath, renderTemplate('claude/hooks/pre-edit-plan-anchor.mjs.ejs', configFor()))

  const planPath = join(dir, '.claude', 'plans', 'task.md')
  mkdirSync(join(dir, '.claude', 'plans'), { recursive: true })
  writeFileSync(planPath, planContent)
  writeTaskStateFile(dir, { phase: 'red', plan: planPath })
  return { dir, hookPath }
}

function run(hookPath: string, cwd: string, targetPath: string) {
  return spawnSync('node', [hookPath], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, CLAUDE_TOOL_INPUT_PATH: targetPath },
  })
}

describe('pre-edit-plan-anchor — out-of-scope soft redirect (#1402)', () => {
  it('emits a SOFT redirect (exit 0 + stdout message) for an out-of-manifest file', () => {
    const { dir, hookPath } = setup(PLAN_WITH_MANIFEST)
    try {
      const result = run(hookPath, dir, 'src/out-of-scope.ts')
      // SOFT: never exit 2 — must not block a legitimate multi-file edit.
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('arbiter note')
      expect(result.stdout.toLowerCase()).toContain('out of scope')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does NOT redirect when the file IS in the manifest', () => {
    const { dir, hookPath } = setup(PLAN_WITH_MANIFEST)
    try {
      const result = run(hookPath, dir, 'src/in-scope.ts')
      expect(result.status).toBe(0)
      expect(result.stdout).not.toContain('out of scope')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('skips silently (no redirect) when the plan has no files manifest', () => {
    const { dir, hookPath } = setup(PLAN_NO_MANIFEST)
    try {
      const result = run(hookPath, dir, 'src/out-of-scope.ts')
      expect(result.status).toBe(0)
      expect(result.stdout).not.toContain('out of scope')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('excludes __tests__/ edits from the redirect (mirrors CANON-16 exclusion)', () => {
    const { dir, hookPath } = setup(PLAN_WITH_MANIFEST)
    try {
      const result = run(hookPath, dir, 'src/__tests__/whatever.test.ts')
      expect(result.status).toBe(0)
      expect(result.stdout).not.toContain('out of scope')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('never blocks: exit 2 is reserved for the existing hard gates, never the redirect', () => {
    const { dir, hookPath } = setup(PLAN_WITH_MANIFEST)
    try {
      // Out-of-scope but existing file — the only possible block would be a hard redirect, which
      // is forbidden by the amendment. Confirm exit is 0.
      const result = run(hookPath, dir, 'src/out-of-scope.ts')
      expect(result.status).not.toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
