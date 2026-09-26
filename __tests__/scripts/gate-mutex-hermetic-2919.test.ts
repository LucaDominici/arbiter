/**
 * #2919 — the gate-mutex fixture git calls must be hermetic. A parent that
 * exports git config (GIT_CONFIG_COUNT/KEY/VALUE, as a hook-driven Full Gate
 * can) must not make `git commit` / `git worktree add` in the throwaway fixture
 * repo run the parent's hooks: that is the unbounded work behind the 30 s
 * timeout of "every worktree of one repo converges on ONE lock path".
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

describe('#2919 gate-mutex fixture git is hermetic', () => {
  it('a hostile parent core.hooksPath never runs inside the fixture repo', () => {
    const root = mkdtempSync(join(tmpdir(), 'arbiter-2919-'))
    dirs.push(root)
    const hooks = join(root, 'hooks')
    const marker = join(root, 'hook-ran')
    spawnSync('mkdir', ['-p', hooks])
    for (const name of ['pre-commit', 'post-commit', 'post-checkout']) {
      const hook = join(hooks, name)
      writeFileSync(hook, `#!/bin/sh\necho ${name} >> '${marker}'\n`)
      chmodSync(hook, 0o755)
    }
    const r = spawnSync(
      'npx',
      ['vitest', 'run', '__tests__/scripts/gate-mutex.test.ts', '-t', 'ONE lock path'],
      {
        encoding: 'utf-8',
        timeout: 120_000,
        env: {
          ...process.env,
          GIT_CONFIG_COUNT: '1',
          GIT_CONFIG_KEY_0: 'core.hooksPath',
          GIT_CONFIG_VALUE_0: hooks,
        },
      },
    )
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(existsSync(marker)).toBe(false)
  })
})
