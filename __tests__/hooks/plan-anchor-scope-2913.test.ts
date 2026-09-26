// SPDX-License-Identifier: Apache-2.0
// RED for arbiter #2913 (direction "neither requires context:"): pre-edit-plan-anchor refuses
// edits outside the repo, and refuses a plan that admission accepts for a missing Context Block.
import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { writeTaskStateFile } from '../helpers.js'

const REPO_ROOT = resolve(process.cwd())
const HOOK = join(REPO_ROOT, '.claude/hooks/pre-edit-plan-anchor.mjs')
const ACCEPTANCE = join(REPO_ROOT, 'scripts/check-acceptance.mjs')
// In-repo target: an existing file under HOOK_OWNER_ROOT (never a new src/ file, so CANON-16 is silent).
const IN_REPO_FILE = join(REPO_ROOT, 'package.json')
const BRANCH = 'task/#2913-plan-anchor-scope'

// A Ship plan with frozen criteria and non-goals but NO `context:` front matter.
const PLAN_NO_CONTEXT = [
  '## Acceptance Criteria',
  '- [ ] AC-2913.1: preserves the requested outcome',
  '## Non-Goals',
  '- out of scope',
  '',
].join('\n')

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(d)
  return d
}

/** A synthetic task repo in the red phase; `plan` is written only when given (else no pointer). */
function taskRepo(plan: string | null): string {
  const dir = tempDir('plan-anchor-scope-2913-')
  execFileSync('git', ['init', '-b', BRANCH], { cwd: dir, stdio: 'ignore' })
  let planPath = ''
  if (plan !== null) {
    planPath = join(dir, 'plan.md')
    writeFileSync(planPath, plan)
  }
  writeTaskStateFile(dir, { taskId: '#2913', branch: BRANCH, phase: 'red', plan: planPath })
  return dir
}

function runHook(dir: string, target: string) {
  const r = spawnSync('node', [HOOK], {
    cwd: dir,
    encoding: 'utf-8',
    env: { ...process.env, ARBITER_PLAN_BYPASS: '', CLAUDE_TOOL_INPUT_PATH: target },
  })
  return { status: r.status ?? 1, stderr: r.stderr ?? '' }
}

describe('#2913 AC-1: the hook only guards paths inside the repository', () => {
  it('control: an in-repo edit with no plan pointer is refused', () => {
    expect(runHook(taskRepo(null), IN_REPO_FILE).status).toBe(2)
  })

  it('an edit to an absolute path outside the repo is not refused, even with no plan pointer', () => {
    const outside = join(tempDir('outside-repo-2913-'), 'scratch.txt')
    writeFileSync(outside, 'scratch\n')
    const r = runHook(taskRepo(null), outside)
    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
  })
})

describe('#2913 AC-2: a plan admission accepts is not refused for a missing Context Block key', () => {
  it('check-acceptance --plan accepts the plan, and the hook allows an in-repo edit under it', () => {
    const dir = taskRepo(PLAN_NO_CONTEXT)
    const adm = spawnSync(process.execPath, [ACCEPTANCE, '--plan', 'plan.md'], {
      cwd: dir,
      encoding: 'utf-8',
    })
    expect(adm.status).toBe(0)
    const r = runHook(dir, IN_REPO_FILE)
    expect(r.stderr).not.toMatch(/Context Block|"context:"/)
    expect(r.status).toBe(0)
  })
})

describe('#2913 AC-3: the remaining refusals name their exact remedy command', () => {
  it('the no-plan-pointer refusal names `node dist/cli.js lifecycle start --plan <path>`', () => {
    const r = runHook(taskRepo(null), IN_REPO_FILE)
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('node dist/cli.js lifecycle start --plan <path>')
  })
})
