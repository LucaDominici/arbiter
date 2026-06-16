// SPDX-License-Identifier: Apache-2.0
//
// #1402 — stop-evidence-guard end-of-task reflection sweep.
//
// Property: when the agent stops on a task/ branch with no completion claim (the natural
// end-of-task moment) AND undrained findings exist in `.arbiter/findings/*.jsonl`, the hook emits
// a non-blocking nudge to `arbiter note` surfacing "N undrained findings". It NEVER changes the
// exit code (stays 0) and emits nothing when there are zero findings (no noise).
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

function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8' }).trim()
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-reflection-'))
  git(dir, ['init', '-b', 'main'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'Test'])
  const hooksDir = join(dir, '.claude', 'hooks')
  mkdirSync(hooksDir, { recursive: true })
  writeFileSync(join(hooksDir, 'lib.mjs'), renderTemplate('claude/hooks/lib.mjs.ejs', configFor()))
  const hookPath = join(hooksDir, 'stop-evidence-guard.mjs')
  writeFileSync(hookPath, renderTemplate('claude/hooks/stop-evidence-guard.mjs.ejs', configFor()))
  writeFileSync(join(dir, 'README.md'), '# fixture\n')
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-m', 'init', '--no-gpg-sign'])
  git(dir, ['checkout', '-b', 'task/1402'])
  writeTaskStateFile(dir, { phase: 'green', tier: 'Standard', taskId: '#1402' })
  return { dir, hookPath }
}

function writeFindings(dir: string, shard: string, count: number) {
  const fd = join(dir, '.arbiter', 'findings')
  mkdirSync(fd, { recursive: true })
  const lines: string[] = []
  for (let i = 0; i < count; i++) {
    lines.push(JSON.stringify({ note: `finding ${i}`, fingerprint: `fp${i}` }))
  }
  writeFileSync(join(fd, `${shard}.jsonl`), lines.join('\n') + '\n')
}

function noClaimTranscript(dir: string): string {
  const p = join(dir, 'transcript.jsonl')
  const obj = {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'still working on the parser' }],
    },
  }
  writeFileSync(p, JSON.stringify(obj) + '\n')
  return p
}

function runHook(hookPath: string, dir: string, transcriptPath: string) {
  return spawnSync('node', [hookPath], {
    cwd: dir,
    input: JSON.stringify({
      hook_event_name: 'Stop',
      session_id: 's1',
      cwd: dir,
      transcript_path: transcriptPath,
    }),
    encoding: 'utf-8',
  })
}

describe('stop-evidence-guard — reflection sweep (#1402)', () => {
  it('surfaces "N undrained findings" and nudges arbiter note, exit 0 (non-blocking)', () => {
    const { dir, hookPath } = setup()
    try {
      writeFindings(dir, '_1402', 3)
      const r = runHook(hookPath, dir, noClaimTranscript(dir))
      expect(r.status).toBe(0)
      expect(r.stderr).toMatch(/3 undrained findings/i)
      expect(r.stderr).toMatch(/arbiter note/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('emits no nudge when there are zero undrained findings (no noise)', () => {
    const { dir, hookPath } = setup()
    try {
      const r = runHook(hookPath, dir, noClaimTranscript(dir))
      expect(r.status).toBe(0)
      expect(r.stderr).not.toMatch(/undrained findings/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('counts findings across multiple shard files', () => {
    const { dir, hookPath } = setup()
    try {
      writeFindings(dir, '_1402', 2)
      writeFindings(dir, 'task_other', 4)
      const r = runHook(hookPath, dir, noClaimTranscript(dir))
      expect(r.status).toBe(0)
      expect(r.stderr).toMatch(/6 undrained findings/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
