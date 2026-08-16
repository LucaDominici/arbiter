// SPDX-License-Identifier: Apache-2.0
// #2287: a runner slot whose SERVER-SIDE registration GitHub deleted for inactivity comes
// back on the persisted `runner-<name>-state` volume, prints "The runner has already been
// configured", fails to open a session, and crashloops. `compose ps --status running` lists
// it the whole time, so compose_up_registered never gives it a fresh RUNNER_TOKEN and
// `ensure`/`start` can never heal it — the live incident hit RestartCount=116.
//
// The farm compared two INTEGERS (containers=4 vs online=3) and could therefore never name
// the slot or the cause. These tests join the two sides BY NAME instead.
//
// Behavioural, per __tests__/scripts/runner-farm-stale-image.test.ts: farm.sh is bash, and
// string assertions on its source pass straight through operator-precedence and `set -e`
// bugs. The real script runs against fake `docker`/`gh` on PATH.
//
// No `chmod`-based guard anywhere in this file: CI runs as root, root ignores mode bits, and
// a permission guard would no-op these assertions into a fake green (#2288).
import { describe, it, expect, afterEach } from 'vitest'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const FARM_SRC = join(REPO_ROOT, 'scripts', 'runner', 'farm.sh')
const COMPOSE_SRC = join(REPO_ROOT, 'scripts', 'runner', 'docker-compose.runners.yml')

const ALL_SERVICES = ['runner-build', 'runner-build-2', 'runner-build-3', 'runner-build-4']
/** compose service -> the RUNNER_NAME the compose file pins (RANDOM_RUNNER_SUFFIX=false). */
const SLOT_OF: Record<string, string> = {
  'runner-build': 'arbiter-slot-build',
  'runner-build-2': 'arbiter-slot-build-2',
  'runner-build-3': 'arbiter-slot-build-3',
  'runner-build-4': 'arbiter-slot-build-4',
}

interface Fixture {
  /** compose services reported `running` — a crashlooping container IS running. */
  running: string[]
  /** runner names present in the GitHub inventory, or 'API_DOWN' for an unreachable API. */
  registered: string[] | 'API_DOWN'
}

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function setup(fx: Fixture): { dir: string; shimLog: string } {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-farm-orphan-'))
  dirs.push(dir)
  const runnerDir = join(dir, 'runner')
  const binDir = join(dir, 'bin')
  mkdirSync(runnerDir, { recursive: true })
  mkdirSync(binDir, { recursive: true })

  copyFileSync(FARM_SRC, join(runnerDir, 'farm.sh'))
  copyFileSync(COMPOSE_SRC, join(runnerDir, 'docker-compose.runners.yml'))
  writeFileSync(join(runnerDir, '.env'), 'REPO_URL=https://github.com/LucaDominici/arbiter\n')

  const inventory =
    fx.registered === 'API_DOWN'
      ? null
      : JSON.stringify({
          total_count: fx.registered.length,
          runners: fx.registered.map((name) => ({
            name,
            status: 'online',
            busy: false,
            labels: [{ name: 'docker-ci-build' }],
          })),
        })
  if (inventory !== null) writeFileSync(join(dir, 'runners.json'), inventory)

  const shimLog = join(dir, 'shim.log')
  // `compose ps --status running --quiet` yields ids, `--services` yields names. Both must
  // come from the SAME name list, or a fixture could claim 4 containers while naming 3.
  const ids = fx.running.map((_, i) => `container${i + 1}`).join('\n')
  const services = fx.running.join('\n')

  writeFileSync(
    join(binDir, 'docker'),
    `#!/usr/bin/env bash
echo "docker $*" >> "${shimLog}"
case "$*" in
  *"ps --status running --quiet"*) printf '%s\\n' '${ids}' | grep -v '^$' || true ;;
  *"ps --status running --services"*) printf '%s\\n' '${services}' | grep -v '^$' || true ;;
  *" logs"*|*" logs "*) echo "runner-build | Failed to create a session. The runner registration has been deleted from the server, please re-configure." ;;
  *"compose rm"*) echo "removed" ;;
  *"volume rm"*) echo "volume removed" ;;
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

  const inventoryBranch = inventory === null ? 'exit 1' : `cat "${join(dir, 'runners.json')}"`
  writeFileSync(
    join(binDir, 'gh'),
    `#!/usr/bin/env bash
echo "gh $*" >> "${shimLog}"
case "$*" in
  *registration-token*) echo "AAAATESTTOKEN" ;;
  *actions/runners*) ${inventoryBranch} ;;
  *) echo '{}' ;;
esac
exit 0
`,
    { mode: 0o755 },
  )

  return { dir, shimLog }
}

function farm(dir: string, ...args: string[]): { status: number; out: string } {
  const r = spawnSync('bash', [join(dir, 'runner', 'farm.sh'), ...args], {
    encoding: 'utf-8',
    env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}` },
  })
  return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

function shim(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf-8') : ''
}

/** The live #2287 shape: all four containers up, slot 1's registration deleted server-side. */
const ORPHANED: Fixture = {
  running: ALL_SERVICES,
  registered: ['arbiter-slot-build-2', 'arbiter-slot-build-3', 'arbiter-slot-build-4'],
}
const HEALTHY: Fixture = { running: ALL_SERVICES, registered: Object.values(SLOT_OF) }

describe('#2287 AC-1/AC-2 — a running-but-unregistered slot is named, not counted', () => {
  it('health fails and names the orphaned SLOT, not just a count', () => {
    const { dir } = setup(ORPHANED)
    const { status, out } = farm(dir, 'health')
    expect(status).toBe(1)
    expect(out).toContain('arbiter-slot-build')
    expect(out).not.toContain('arbiter-slot-build-2')
    expect(out).toMatch(/unregistered|registration/i)
  })

  it('health names the per-slot remedy so the operator is not left to invent one', () => {
    const { dir } = setup(ORPHANED)
    expect(farm(dir, 'health').out).toMatch(/reregister\s+runner-build\b/)
  })

  it('doctor names the orphaned slot too', () => {
    const { dir } = setup(ORPHANED)
    const { status, out } = farm(dir, 'doctor')
    expect(status).toBe(1)
    expect(out).toContain('arbiter-slot-build')
    expect(out).toMatch(/unregistered|registration/i)
  })

  // The mirror. A farm.sh that shouts "orphan" unconditionally passes every test above and
  // fails this one — which is what makes the RED above real rather than a shape assertion.
  it('a fully registered farm is HEALTHY and mentions no orphan and no remedy', () => {
    const { dir } = setup(HEALTHY)
    const { status, out } = farm(dir, 'health')
    expect(status).toBe(0)
    expect(out).toContain('HEALTHY')
    expect(out).not.toMatch(/unregistered/i)
    expect(out).not.toMatch(/reregister/)
  })

  // Fail-closed on the QUERY, not just on the container. An unreachable inventory read as
  // "nothing is registered" would mark all four slots orphaned and invite a farm-wide wipe —
  // the 2026-07-09 mid-job-recreate incident class AC-4 exists to prevent.
  it('an unreachable GitHub API is UNKNOWN, never "all four are orphans"', () => {
    const { dir } = setup({ running: ALL_SERVICES, registered: 'API_DOWN' })
    const { out } = farm(dir, 'health')
    expect(out).toMatch(/UNKNOWN|unreachable/i)
    expect(out).not.toMatch(/unregistered/i)
    for (const slot of Object.values(SLOT_OF)) expect(out).not.toContain(`${slot} `)
  })
})

describe('#2287 AC-3/AC-4 — reregister is scoped to exactly one proven-orphan slot', () => {
  it('rebuilds only the orphaned slot: its service, its state volume, in order', () => {
    const { dir, shimLog } = setup(ORPHANED)
    const { status } = farm(dir, 'reregister', 'runner-build')
    expect(status).toBe(0)

    const log = shim(shimLog)
    expect(log).toMatch(/compose .*\brm\b.*\brunner-build\b/)
    expect(log).toContain('volume rm runner-arbiter-build-state')
    expect(log).toMatch(/compose .*\bup\b.*\brunner-build\b/)

    // rm the container BEFORE wiping the volume it has mounted, and up only after both.
    const rmAt = log.search(/compose .*\brm\b/)
    const volAt = log.indexOf('volume rm')
    const upAt = log.search(/compose .*\bup\b/)
    expect(rmAt).toBeGreaterThanOrEqual(0)
    expect(rmAt).toBeLessThan(volAt)
    expect(volAt).toBeLessThan(upAt)

    // Blast radius: no sibling service and no sibling volume may appear anywhere.
    for (const svc of ALL_SERVICES.slice(1)) expect(log).not.toContain(svc)
    for (const n of ['2', '3', '4']) {
      expect(log).not.toContain(`runner-arbiter-build-${n}-state`)
    }
    // and never a wholesale teardown
    expect(log).not.toMatch(/compose .*\bdown\b/)
  })

  it('refuses a slot that IS registered — it may be running a job (the 2026-07-09 incident)', () => {
    const { dir, shimLog } = setup(ORPHANED)
    const { status, out } = farm(dir, 'reregister', 'runner-build-3')
    expect(status).not.toBe(0)
    expect(out).toMatch(/registered/i)
    const log = shim(shimLog)
    expect(log).not.toMatch(/compose .*\brm\b/)
    expect(log).not.toContain('volume rm')
    expect(log).not.toMatch(/compose .*\bup\b/)
  })

  it('refuses when the inventory is unreachable — unproven is not unregistered', () => {
    const { dir, shimLog } = setup({ running: ALL_SERVICES, registered: 'API_DOWN' })
    const { status } = farm(dir, 'reregister', 'runner-build')
    expect(status).not.toBe(0)
    const log = shim(shimLog)
    expect(log).not.toContain('volume rm')
    expect(log).not.toMatch(/compose .*\bup\b/)
  })

  it('refuses an unknown slot name rather than deriving a volume from it', () => {
    const { dir, shimLog } = setup(ORPHANED)
    const { status } = farm(dir, 'reregister', 'runner-build-9')
    expect(status).not.toBe(0)
    expect(shim(shimLog)).not.toContain('volume rm')
  })

  it('refuses with no slot argument — there is no --all and no default target', () => {
    const { dir, shimLog } = setup(ORPHANED)
    const { status } = farm(dir, 'reregister')
    expect(status).not.toBe(0)
    expect(shim(shimLog)).not.toContain('volume rm')
  })

  it('accepts the runner name shown by health as an alias for the service name', () => {
    const { dir, shimLog } = setup(ORPHANED)
    const { status } = farm(dir, 'reregister', 'arbiter-slot-build')
    expect(status).toBe(0)
    expect(shim(shimLog)).toContain('volume rm runner-arbiter-build-state')
  })
})
