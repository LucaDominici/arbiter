/**
 * #2280 — stale runner image leaves slots Up-but-offline and the queue hangs forever.
 *
 * Observed 2026-08-15: the 3 `arbiter-slot-build-*` containers ran a locally cached
 * `myoung34/github-runner` at runner 2.334.0, which GitHub deprecated. Docker reported
 * every container Up; GitHub reported every runner offline ("Runner version v2.334.0 is
 * deprecated and cannot receive messages"), so every `docker-ci-build` job sat queued.
 * `farm.sh ensure` kept restarting the same stale local image, so the failure was
 * self-healing-proof.
 *
 * Behavioural test (precedent: __tests__/githooks/pre-push.test.ts) — `farm.sh` is bash and
 * string assertions on its source silently pass on operator-precedence and `set -e` bugs.
 * The real script is copied into a temp dir alongside a fake `docker`/`gh` on PATH so the
 * health parser and the start path can be driven from fixtures.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, chmodSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const FARM_SRC = join(REPO_ROOT, 'scripts', 'runner', 'farm.sh')
const COMPOSE_SRC = join(REPO_ROOT, 'scripts', 'runner', 'docker-compose.runners.yml')

const DEPRECATION_LOG = `
runner-build-2  | √ Connected to GitHub
runner-build-2  | Runner version v2.334.0 is deprecated and cannot receive messages.
runner-build-2  | Runner listener exited with error code 1
`.trim()

const HEALTHY_LOG = `
runner-build  | √ Connected to GitHub
runner-build  | Listening for Jobs
`.trim()

function runnersJson(online: number, total = 4): string {
  const runners = Array.from({ length: total }, (_, i) => ({
    name: `arbiter-slot-build${i === 0 ? '' : `-${i + 1}`}`,
    status: i < online ? 'online' : 'offline',
    busy: false,
    labels: [{ name: 'docker-ci-build' }],
  }))
  return JSON.stringify({ total_count: total, runners })
}

interface Fixture {
  containers: number
  online: number
  logs: string
}

const dirs: string[] = []

function setup(fx: Fixture): { dir: string; shimLog: string } {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-farm-'))
  dirs.push(dir)
  const runnerDir = join(dir, 'runner')
  const binDir = join(dir, 'bin')
  mkdirSync(runnerDir, { recursive: true })
  mkdirSync(binDir, { recursive: true })

  copyFileSync(FARM_SRC, join(runnerDir, 'farm.sh'))
  chmodSync(join(runnerDir, 'farm.sh'), 0o755)
  copyFileSync(COMPOSE_SRC, join(runnerDir, 'docker-compose.runners.yml'))
  writeFileSync(join(runnerDir, '.env'), 'REPO_URL=https://github.com/LucaDominici/arbiter\n')

  writeFileSync(join(dir, 'logs.txt'), fx.logs + '\n')
  writeFileSync(join(dir, 'runners.json'), runnersJson(fx.online))

  const shimLog = join(dir, 'shim.log')
  const containerIds = Array.from({ length: fx.containers }, (_, i) => `container${i + 1}`).join('\n')
  const services = ['runner-build', 'runner-build-2', 'runner-build-3', 'runner-build-4']
    .slice(0, fx.containers)
    .join('\n')

  writeFileSync(
    join(binDir, 'docker'),
    `#!/usr/bin/env bash
echo "docker $*" >> "${shimLog}"
case "$*" in
  *"ps --status running --quiet"*) printf '%s\\n' '${containerIds}' | grep -v '^$' || true ;;
  *"ps --status running --services"*) printf '%s\\n' '${services}' | grep -v '^$' || true ;;
  *" logs"*|*" logs "*) cat "${join(dir, 'logs.txt')}" ;;
  *"compose pull"*) echo "pulled" ;;
  *"compose up"*) echo "started" ;;
  *"compose ps"*) echo "(ps table)" ;;
  info) echo "Server Version: 99" ;;
  *) : ;;
esac
exit 0
`,
    { mode: 0o755 },
  )

  writeFileSync(
    join(binDir, 'gh'),
    `#!/usr/bin/env bash
echo "gh $*" >> "${shimLog}"
case "$*" in
  *registration-token*) echo "AAAATESTTOKEN" ;;
  *actions/runners*) cat "${join(dir, 'runners.json')}" ;;
  *) echo '{}' ;;
esac
exit 0
`,
    { mode: 0o755 },
  )

  return { dir, shimLog }
}

function farm(dir: string, cmd: string): { status: number; out: string } {
  const r = spawnSync('bash', [join(dir, 'runner', 'farm.sh'), cmd], {
    encoding: 'utf-8',
    env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}` },
  })
  return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('farm.sh — stale-image / Up-but-offline detection (#2280)', () => {
  it('AC-2: health names the runner-deprecation root cause when containers are Up but runners are offline', () => {
    const { dir } = setup({ containers: 4, online: 0, logs: DEPRECATION_LOG })
    const { status, out } = farm(dir, 'health')

    expect(status).toBe(1)
    // Not just "0 online" — the remedy for a deprecated cached image is a pull, not a restart.
    expect(out).toMatch(/deprecat/i)
    expect(out).toMatch(/pull/i)
  })

  it('AC-3: an Up-but-offline farm with clean logs is reported as plain degraded, not misdiagnosed as deprecation', () => {
    const { dir } = setup({ containers: 4, online: 1, logs: HEALTHY_LOG })
    const { status, out } = farm(dir, 'health')

    expect(status).toBe(1)
    expect(out).toMatch(/expected 4 online runner/)
    expect(out).not.toMatch(/deprecat/i)
  })

  it('AC-3: a fully converged farm stays healthy and says nothing about deprecation', () => {
    const { dir } = setup({ containers: 4, online: 4, logs: HEALTHY_LOG })
    const { status, out } = farm(dir, 'health')

    expect(status).toBe(0)
    expect(out).toMatch(/HEALTHY/)
    expect(out).not.toMatch(/deprecat/i)
  })

  it('AC-1: start pulls the runner image before bringing a stopped slot up', () => {
    const { dir, shimLog } = setup({ containers: 0, online: 0, logs: HEALTHY_LOG })
    const { status } = farm(dir, 'start')
    expect(status).toBe(0)

    const log = existsSync(shimLog) ? readFileSync(shimLog, 'utf-8') : ''
    const pullAt = log.search(/compose .*\bpull\b/)
    const upAt = log.search(/compose .*\bup\b/)
    expect(pullAt, `no image pull in:\n${log}`).toBeGreaterThan(-1)
    expect(upAt).toBeGreaterThan(-1)
    expect(pullAt).toBeLessThan(upAt)
  })

  it('AC-1: start leaves already-running slots untouched — no pull, no recreate (mid-job recreate incident)', () => {
    const { dir, shimLog } = setup({ containers: 4, online: 4, logs: HEALTHY_LOG })
    const { status } = farm(dir, 'start')
    expect(status).toBe(0)

    const log = existsSync(shimLog) ? readFileSync(shimLog, 'utf-8') : ''
    expect(log).not.toMatch(/compose .*\bpull\b/)
    expect(log).not.toMatch(/compose .*\bup\b/)
  })

  it('AC-2: doctor reports the deprecation signature with its remedy', () => {
    const { dir } = setup({ containers: 4, online: 0, logs: DEPRECATION_LOG })
    const { status, out } = farm(dir, 'doctor')

    expect(status).toBe(1)
    expect(out).toMatch(/deprecat/i)
    expect(out).toMatch(/pull/i)
  })
})
