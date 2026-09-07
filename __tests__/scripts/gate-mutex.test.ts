// SPDX-License-Identifier: Apache-2.0
/**
 * #2427 AC-2 / AC-3 — one gate per repo, and a killed parent kills the gate.
 *
 * The incident: a killed `git push` left its pre-push L2 running as an orphan.
 * A second push then started a SECOND L2 in the same worktree; the two
 * interfered (`docs:build` tripped over a half-deleted vitepress temp file, a
 * subprocess-heavy unit test flaked under the doubled load) and the orphan went
 * on to stamp a green marker.
 *
 * AC-2: the gate runs under the per-repo `arbiter gate-exec` mutex, so a second
 * gate in the same repo waits (announcing itself) or fails closed.
 * AC-3: the gate runs in the FOREGROUND process group — no setsid, no detach —
 * so signal delivery reaches it, and it independently aborts when the process it
 * was launched to serve is gone.
 *
 * These tests are DEFEAT-oriented: each proves a specific way the old shape let
 * two gates run at once or let one survive its parent.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  GATE_MUTEX_BUSY_EXIT,
  GATE_MUTEX_HELD_ENV,
  gateLockPathFor,
  isProcessAlive,
} from '../../scripts/lib/gate-mutex.mjs'
import { deriveGateKey, gateLockPath } from '../../src/commands/gate-exec.js'

const GATE_MUTEX = resolve(process.cwd(), 'scripts/lib/gate-mutex.mjs')
const RUN_HELPERS = resolve(process.cwd(), 'scripts/lib/run-helpers.mjs')

const dirs: string[] = []
function track(dir: string): string {
  dirs.push(dir)
  return dir
}
afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function makeRepo(): string {
  const dir = track(realpathSync(mkdtempSync(join(tmpdir(), 'arbiter-2427-mutex-'))))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  return dir
}

/** A private XDG_RUNTIME_DIR so a test never contends with the real gate lock. */
function isolatedEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    XDG_RUNTIME_DIR: track(realpathSync(mkdtempSync(join(tmpdir(), 'arbiter-2427-xdg-')))),
    [GATE_MUTEX_HELD_ENV]: '',
  }
}

/**
 * Tear a wrapper down the way a real signal does. SIGKILL on the wrapper alone
 * would orphan `flock` and the gate beneath it — the exact leak #2427 exists to
 * remove, and a test (least of all a FAILING one) must not manufacture it.
 */
async function terminate(child: { pid?: number; kill: (s: NodeJS.Signals) => boolean }) {
  const pid = child.pid ?? 0
  if (pid <= 0 || !isProcessAlive(pid)) return
  child.kill('SIGTERM')
  if (!(await waitFor(() => !isProcessAlive(pid), 10_000))) child.kill('SIGKILL')
}

async function waitFor(predicate: () => boolean, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return false
}

describe('#2427 AC-2 — the gate mutex is gate-exec s mutex, not a second one', () => {
  it('derives the byte-identical lock path to src/commands/gate-exec.ts', () => {
    const dir = makeRepo()
    expect(gateLockPathFor(dir)).toBe(gateLockPath(deriveGateKey(dir)))
  })

  it('every worktree of one repo converges on ONE lock path', () => {
    const dir = makeRepo()
    const sub = join(dir, 'nested')
    execFileSync('git', ['-C', dir, 'commit', '-q', '--allow-empty', '-m', 'init'], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'T',
        GIT_AUTHOR_EMAIL: 't@t.dev',
        GIT_COMMITTER_NAME: 'T',
        GIT_COMMITTER_EMAIL: 't@t.dev',
      },
    })
    execFileSync('git', ['-C', dir, 'worktree', 'add', '-q', '-b', 'wt', sub])
    expect(gateLockPathFor(sub)).toBe(gateLockPathFor(dir))
  })

  it('the CLI prints the same path it locks', () => {
    const dir = makeRepo()
    const env = isolatedEnv()
    const r = spawnSync('node', [GATE_MUTEX, 'path', '--dir', dir], { env, encoding: 'utf-8' })
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe(gateLockPathFor(dir, env))
  })
})

describe('#2427 AC-2 — a second gate in the same repo never runs concurrently', () => {
  it('serialises two concurrent gates (no interleaving)', async () => {
    const dir = makeRepo()
    const env = isolatedEnv()
    const log = join(dir, 'order.log')
    const payload = join(dir, 'payload.mjs')
    writeFileSync(
      payload,
      `import { appendFileSync } from 'node:fs'
const tag = process.argv[2]
appendFileSync(process.argv[3], tag + '-enter\\n')
await new Promise((r) => setTimeout(r, 700))
appendFileSync(process.argv[3], tag + '-exit\\n')
`,
    )
    const run = (tag: string) =>
      new Promise<number>((res) => {
        const c = spawn(
          'node',
          [GATE_MUTEX, 'run', '--dir', dir, '--', 'node', payload, tag, log],
          { env, stdio: 'ignore' },
        )
        c.on('close', (code) => res(code ?? -1))
      })
    const codes = await Promise.all([run('A'), run('B')])
    expect(codes).toEqual([0, 0])
    const lines = readFileSync(log, 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(4)
    // Serialised means each gate's enter/exit pair is contiguous — never A,B,A,B.
    expect(lines[0].slice(-5)).toBe('enter')
    expect(lines[1]).toBe(`${lines[0][0]}-exit`)
    expect(lines[2].slice(-5)).toBe('enter')
    expect(lines[3]).toBe(`${lines[2][0]}-exit`)
  }, 40_000)

  it('fails CLOSED (never runs the gate) when the mutex is busy and mode=fail', async () => {
    const dir = makeRepo()
    const env = isolatedEnv()
    const marker = join(dir, 'should-not-exist')
    const holder = spawn(
      'node',
      [GATE_MUTEX, 'run', '--dir', dir, '--', 'node', '-e', 'setTimeout(() => {}, 8000)'],
      { env, stdio: 'ignore' },
    )
    try {
      await waitFor(() => existsSync(gateLockPathFor(dir, env)))
      await new Promise((r) => setTimeout(r, 700))
      const r = spawnSync(
        'node',
        [
          GATE_MUTEX,
          'run',
          '--dir',
          dir,
          '--',
          'node',
          '-e',
          `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`,
        ],
        { env: { ...env, ARBITER_GATE_MUTEX_MODE: 'fail' }, encoding: 'utf-8' },
      )
      expect(r.status).toBe(GATE_MUTEX_BUSY_EXIT)
      expect(existsSync(marker)).toBe(false)
      expect(r.stderr).toMatch(/another gate/i)
    } finally {
      await terminate(holder)
    }
  }, 40_000)

  it('announces the wait on stderr IMMEDIATELY rather than blocking silently', async () => {
    const dir = makeRepo()
    const env = isolatedEnv()
    const holder = spawn(
      'node',
      [GATE_MUTEX, 'run', '--dir', dir, '--', 'node', '-e', 'setTimeout(() => {}, 3000)'],
      { env, stdio: 'ignore' },
    )
    try {
      await waitFor(() => existsSync(gateLockPathFor(dir, env)))
      await new Promise((r) => setTimeout(r, 700))
      const waiter = spawn('node', [GATE_MUTEX, 'run', '--dir', dir, '--', 'node', '-e', '0'], {
        env,
        stdio: ['ignore', 'ignore', 'pipe'],
      })
      let stderr = ''
      waiter.stderr.on('data', (d: Buffer) => {
        stderr += d.toString()
      })
      // The announcement must arrive while still WAITING, long before the holder ends.
      const announced = await waitFor(() => /waiting/i.test(stderr), 2000)
      await terminate(waiter)
      expect(announced).toBe(true)
      expect(stderr).toMatch(/gate/i)
    } finally {
      await terminate(holder)
    }
  }, 40_000)

  it('does NOT re-acquire (and so cannot self-deadlock) when the mutex is already held', () => {
    const dir = makeRepo()
    const env = isolatedEnv()
    const lockPath = gateLockPathFor(dir, env)
    const marker = join(dir, 'nested-ran')
    // Simulate `arbiter gate-exec` having taken the lock for this process tree.
    const r = spawnSync(
      'node',
      [
        GATE_MUTEX,
        'run',
        '--dir',
        dir,
        '--',
        'node',
        '-e',
        `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`,
      ],
      {
        env: { ...env, [GATE_MUTEX_HELD_ENV]: lockPath, ARBITER_GATE_MUTEX_MODE: 'fail' },
        encoding: 'utf-8',
        timeout: 20_000,
      },
    )
    expect(r.status).toBe(0)
    expect(existsSync(marker)).toBe(true)
  }, 30_000)
})

describe('#2427 AC-3 — killing the parent kills the gate, with no surviving child', () => {
  it('never detaches: the gate child shares the wrapper process group', async () => {
    const dir = makeRepo()
    const env = isolatedEnv()
    const pidFile = join(dir, 'gate.pid')
    const pgidFile = join(dir, 'gate.pgid')
    const payload = join(dir, 'long.mjs')
    writeFileSync(
      payload,
      // Node exposes no getpgrp(); field 5 of /proc/self/stat is the process
      // group, read after the last ')' so a comm containing parens cannot shift it.
      `import { readFileSync, writeFileSync } from 'node:fs'
const stat = readFileSync('/proc/self/stat', 'utf-8')
const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
writeFileSync(process.argv[2], String(process.pid))
writeFileSync(process.argv[3], fields[2])
setInterval(() => {}, 1000)
`,
    )
    const wrapper = spawn(
      'node',
      [GATE_MUTEX, 'run', '--dir', dir, '--', 'node', payload, pidFile, pgidFile],
      { env, stdio: 'ignore' },
    )
    try {
      expect(await waitFor(() => existsSync(pgidFile))).toBe(true)
      // The wrapper must NOT have started a new session/group for the gate.
      expect(Number(readFileSync(pgidFile, 'utf-8'))).toBe(
        Number(
          execFileSync('ps', ['-o', 'pgid=', '-p', String(wrapper.pid)])
            .toString()
            .trim(),
        ),
      )
    } finally {
      await terminate(wrapper)
      const pid = existsSync(pidFile) ? Number(readFileSync(pidFile, 'utf-8')) : 0
      if (pid > 0 && isProcessAlive(pid)) process.kill(pid, 'SIGKILL')
    }
  }, 40_000)

  it('SIGTERM to the wrapper leaves NO surviving gate process', async () => {
    const dir = makeRepo()
    const env = isolatedEnv()
    const pidFile = join(dir, 'gate.pid')
    const payload = join(dir, 'long.mjs')
    writeFileSync(
      payload,
      `import { writeFileSync } from 'node:fs'
writeFileSync(process.argv[2], String(process.pid))
setInterval(() => {}, 1000)
`,
    )
    const wrapper = spawn(
      'node',
      [GATE_MUTEX, 'run', '--dir', dir, '--', 'node', payload, pidFile],
      {
        env,
        stdio: 'ignore',
      },
    )
    let died: boolean | undefined
    let gatePid = 0
    try {
      expect(await waitFor(() => existsSync(pidFile))).toBe(true)
      gatePid = Number(readFileSync(pidFile, 'utf-8'))
      expect(isProcessAlive(gatePid)).toBe(true)

      wrapper.kill('SIGTERM')
      died = await waitFor(() => !isProcessAlive(gatePid), 15_000)
    } finally {
      if (gatePid > 0 && isProcessAlive(gatePid)) process.kill(gatePid, 'SIGKILL')
      await terminate(wrapper)
    }
    expect(died).toBe(true)
  }, 40_000)

  it('releases the mutex on the signal path — the next gate acquires immediately', async () => {
    const dir = makeRepo()
    const env = isolatedEnv()
    const pidFile = join(dir, 'gate.pid')
    const payload = join(dir, 'long.mjs')
    writeFileSync(
      payload,
      `import { writeFileSync } from 'node:fs'
writeFileSync(process.argv[2], String(process.pid))
setInterval(() => {}, 1000)
`,
    )
    const wrapper = spawn(
      'node',
      [GATE_MUTEX, 'run', '--dir', dir, '--', 'node', payload, pidFile],
      {
        env,
        stdio: 'ignore',
      },
    )
    let released: boolean | undefined
    let gatePid = 0
    try {
      expect(await waitFor(() => existsSync(pidFile))).toBe(true)
      gatePid = Number(readFileSync(pidFile, 'utf-8'))
      wrapper.kill('SIGTERM')
      released = await waitFor(() => !isProcessAlive(gatePid), 15_000)
    } finally {
      if (gatePid > 0 && isProcessAlive(gatePid)) process.kill(gatePid, 'SIGKILL')
      await terminate(wrapper)
    }
    expect(released).toBe(true)

    const r = spawnSync('node', [GATE_MUTEX, 'run', '--dir', dir, '--', 'node', '-e', '0'], {
      env: { ...env, ARBITER_GATE_MUTEX_MODE: 'fail' },
      encoding: 'utf-8',
      timeout: 20_000,
    })
    expect(r.status).toBe(0)
  }, 40_000)
})

describe('#2427 AC-3 — the gate itself aborts when the process it serves is gone', () => {
  it('isProcessAlive distinguishes a live pid from a reaped one', () => {
    expect(isProcessAlive(process.pid)).toBe(true)
    const dead = spawnSync('node', ['-e', '0'])
    expect(dead.pid).toBeGreaterThan(0)
    // A reaped child's pid is no longer signalable from here.
    expect(isProcessAlive(2_147_483_646)).toBe(false)
  })

  it('run-helpers aborts the gate between checks once the watched process dies', () => {
    const dir = makeRepo()
    const probe = join(dir, 'probe.mjs')
    const ran = join(dir, 'ran')
    writeFileSync(
      probe,
      `import { runCheck } from ${JSON.stringify(RUN_HELPERS)}
import { setOrphanGuard } from ${JSON.stringify(RUN_HELPERS)}
setOrphanGuard(2147483646)
runCheck('after-orphan', 'node', ['-e', 'require("fs").writeFileSync(process.argv[1],"x")', ${JSON.stringify(ran)}])
`,
    )
    const r = spawnSync('node', [probe], { encoding: 'utf-8', timeout: 20_000 })
    expect(r.status).not.toBe(0)
    expect(`${r.stderr}${r.stdout}`).toMatch(/orphan/i)
    expect(existsSync(ran)).toBe(false)
  }, 30_000)

  it('run-helpers runs normally while the watched process is alive (negative control)', () => {
    const dir = makeRepo()
    const probe = join(dir, 'probe-ok.mjs')
    const ran = join(dir, 'ran-ok')
    writeFileSync(
      probe,
      `import { runCheck, getFailed, setOrphanGuard } from ${JSON.stringify(RUN_HELPERS)}
setOrphanGuard(process.pid)
runCheck('ok', 'node', ['-e', 'require("fs").writeFileSync(${JSON.stringify(ran)},"x")'])
process.exit(getFailed())
`,
    )
    const r = spawnSync('node', [probe], { encoding: 'utf-8', timeout: 20_000 })
    expect(r.status).toBe(0)
    expect(existsSync(ran)).toBe(true)
  }, 30_000)
})

describe('#2427 AC-2 — BOTH pre-push gate branches run under the mutex', () => {
  const HOOK = resolve(process.cwd(), '.githooks/pre-push')
  const HOOK_TEMPLATE = resolve(process.cwd(), 'src/templates/githooks/pre-push.ejs')

  /** Every line that actually launches the heavy gate. */
  function gateInvocations(body: string): string[] {
    return body
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => !l.startsWith('#') && /check-all\.mjs/.test(l) && !/^ARBITER_PREPUSH/.test(l))
  }

  it('the self hook launches the gate only through gate-mutex.mjs (both branches)', () => {
    const body = readFileSync(HOOK, 'utf-8')
    const calls = gateInvocations(body)
    // The plain branch and the '#'-in-path rsync branch.
    expect(calls.length).toBeGreaterThanOrEqual(2)
    for (const call of calls) expect(call).toMatch(/gate-mutex\.mjs/)
  })

  it('the shipped template hook does the same, so consumers are not left unlocked', () => {
    const body = readFileSync(HOOK_TEMPLATE, 'utf-8')
    const calls = gateInvocations(body)
    expect(calls.length).toBeGreaterThanOrEqual(2)
    for (const call of calls) expect(call).toMatch(/gate-mutex\.mjs/)
  })

  it('the rsync branch keys the mutex off the ORIGINAL repo, not the temp copy', () => {
    for (const path of [HOOK, HOOK_TEMPLATE]) {
      const body = readFileSync(path, 'utf-8')
      const rsyncCall = gateInvocations(body).find((l) => /ARBITER_HOOK_GIT_CWD/.test(l))
      expect(rsyncCall, `${path} has no rsync-branch gate call`).toBeDefined()
      expect(rsyncCall).toMatch(/--dir\s+"\$ORIG_DIR"/)
    }
  })

  it('neither hook detaches the gate (no setsid/nohup/background)', () => {
    for (const path of [HOOK, HOOK_TEMPLATE]) {
      for (const call of gateInvocations(readFileSync(path, 'utf-8'))) {
        expect(call).not.toMatch(/\bsetsid\b|\bnohup\b|&\s*$/)
      }
    }
  })
})
