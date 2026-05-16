// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const REPO_ROOT = resolve(process.cwd())
const HOOK = join(REPO_ROOT, '.claude/hooks/pre-edit-plan-anchor.mjs')

// Existing file to use as CLAUDE_TOOL_INPUT_PATH (not a new src/ file — avoids CANON-16 gate)
const EXISTING_FILE = join(REPO_ROOT, 'package.json')

const VALID_CONTEXT_BLOCK_SINGULAR = `---
context:
  issue: "#689"
  type: feat
  pipeline: "plan → impl → gate → PR"
  branch_convention: "task/#689-context-block"
  base_branch: main
  key_constraints:
    - "No any type"
  red_team_warnings:
    - "Hook runs without npm deps"
  estimate: "S (2h)"
---

# Plan body
`

const VALID_CONTEXT_BLOCK_PLURAL = `---
context:
  issues:
    - "#689"
    - "#690"
  type: feat
  pipeline: "plan → impl → gate → PR"
  branch_convention: "task/w1-b1"
  base_branch: main
  key_constraints:
    - "No any type"
  red_team_warnings:
    - "Hook runs without npm deps"
  estimate: "M (8h)"
---

# Plan body
`

const MISSING_CONTEXT_BLOCK = `# Plan with no front-matter

Some content here.
`

const CONTEXT_MISSING_FIELDS = `---
context:
  issue: "#689"
  type: feat
---

# Plan body
`

const LEGACY_PLAN = `# [legacy — pre-Context-Block]

# Old plan without Context Block

Some old content here.
`

const LEGACY_PLAN_ENDASH = `# [legacy – pre-Context-Block]

# Old plan (en-dash variant)

Content.
`

const CONTEXT_BLOCK_NO_ISSUE = `---
context:
  type: feat
  pipeline: "plan → impl → gate → PR"
  branch_convention: "task/#NNN"
  base_branch: main
  key_constraints:
    - "constraint"
  red_team_warnings:
    - "warning"
  estimate: "S (2h)"
---

# Plan body
`

function runHook(
  planContent: string,
  opts: { bypass?: boolean } = {},
): { status: number; stderr: string; stdout: string } {
  const tmpDir = mkdtempSync(join(tmpdir(), 'arbiter-plan-anchor-'))
  const claudeDir = join(tmpDir, '.claude')
  const planFile = join(tmpDir, 'plan.md')
  const taskPlanFile = join(claudeDir, '.task-plan')

  mkdirSync(claudeDir, { recursive: true })
  writeFileSync(join(claudeDir, '.task-phase'), 'red\n')
  writeFileSync(planFile, planContent)
  writeFileSync(taskPlanFile, planFile)

  const env = {
    ...process.env,
    CLAUDE_TOOL_INPUT_PATH: EXISTING_FILE,
    ...(opts.bypass ? { ARBITER_PLAN_BYPASS: '1' } : {}),
  }

  const result = spawnSync('node', [HOOK], {
    encoding: 'utf-8',
    cwd: tmpDir,
    env,
  })

  rmSync(tmpDir, { recursive: true, force: true })

  return {
    status: result.status ?? 1,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  }
}

describe('pre-edit-plan-anchor: Context Block validation (#689)', () => {
  it('ARBITER_PLAN_BYPASS=1 exits 0 regardless of plan content', () => {
    const result = runHook(MISSING_CONTEXT_BLOCK, { bypass: true })
    expect(result.status).toBe(0)
  })

  it('plan with valid Context Block (singular issue) exits 0', () => {
    const result = runHook(VALID_CONTEXT_BLOCK_SINGULAR)
    expect(result.status).toBe(0)
  })

  it('plan with valid Context Block (plural issues array) exits 0', () => {
    const result = runHook(VALID_CONTEXT_BLOCK_PLURAL)
    expect(result.status).toBe(0)
  })

  it('plan missing Context Block entirely exits 2', () => {
    const result = runHook(MISSING_CONTEXT_BLOCK)
    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/context block/i)
  })

  it('plan with context: but missing required fields exits 2', () => {
    const result = runHook(CONTEXT_MISSING_FIELDS)
    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/missing.*field|required.*field|field.*missing/i)
  })

  it('error message lists missing fields', () => {
    const result = runHook(CONTEXT_MISSING_FIELDS)
    // Should mention at least one missing field name
    expect(result.stderr).toMatch(
      /pipeline|branch_convention|base_branch|key_constraints|red_team_warnings|estimate/,
    )
  })

  it('legacy plan with em-dash header exits 0 (exempt from Context Block)', () => {
    const result = runHook(LEGACY_PLAN)
    expect(result.status).toBe(0)
  })

  it('legacy plan with en-dash header exits 0 (unicode variant)', () => {
    const result = runHook(LEGACY_PLAN_ENDASH)
    expect(result.status).toBe(0)
  })

  it('context block with no issue or issues field exits 2', () => {
    const result = runHook(CONTEXT_BLOCK_NO_ISSUE)
    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/issue/i)
  })
})
