// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runTaskHostPreflight, runTaskInit } from '../../src/commands/task.js'
import { readUnifiedState } from '../../src/commands/task-state.js'

const roots: string[] = []

function setup() {
  const parent = mkdtempSync(join(tmpdir(), 'arbiter-host-preflight-'))
  roots.push(parent)
  const main = join(parent, 'repo')
  const worktree = join(parent, 'repo.worktrees', '2685-native-host')
  const home = join(parent, 'home')
  mkdirSync(main, { recursive: true })
  execFileSync('git', ['init', '-b', 'main'], { cwd: main, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'test@fixture.invalid'], { cwd: main })
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: main })
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: main, stdio: 'ignore' })
  execFileSync('git', ['worktree', 'add', '-b', 'task/#2685-native-host', worktree], {
    cwd: main,
    stdio: 'ignore',
  })
  mkdirSync(join(main, '.arbiter'), { recursive: true })
  writeFileSync(
    join(main, '.arbiter', 'worktree-open.log.json'),
    JSON.stringify([{ taskId: '#2685', worktreePath: worktree, branch: 'task/#2685-native-host' }]),
  )
  const sessionId = 'session-worktree-2685'
  const projectDir = join(home, '.claude', 'projects', worktree.replace(/[^A-Za-z0-9]/g, '-'))
  mkdirSync(projectDir, { recursive: true })
  const transcriptPath = join(projectDir, `${sessionId}.jsonl`)
  writeFileSync(transcriptPath, '{}\n')
  const host = { cwd: worktree, homeDir: home, env: { CLAUDE_CODE_SESSION_ID: sessionId } }
  return { main, worktree, sessionId, transcriptPath, host }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('task host-preflight (#2685)', () => {
  it('binds the exact logged worktree, branch, session and transcript before task init', () => {
    const { worktree, sessionId, transcriptPath, host } = setup()

    runTaskHostPreflight({ id: '#2685', worktree, dir: worktree, host })
    runTaskInit({ dir: worktree, id: '#2685', host })

    expect(readUnifiedState(worktree)?.hostBinding).toEqual({
      worktreePath: worktree,
      branch: 'task/#2685-native-host',
      sessionId,
      transcriptPath,
    })
  })

  it('rejects a main-root host even when --dir targets the exact worktree and writes no state', () => {
    const { main, worktree, host } = setup()
    const wrongHost = { ...host, cwd: main }

    expect(() =>
      runTaskHostPreflight({ id: '#2685', worktree, dir: worktree, host: wrongHost }),
    ).toThrow(/host root.*worktree/i)
    expect(() => runTaskInit({ dir: worktree, id: '#2685', host: wrongHost })).toThrow(
      /host binding/i,
    )
    expect(readUnifiedState(worktree)).toBeNull()
  })
})
