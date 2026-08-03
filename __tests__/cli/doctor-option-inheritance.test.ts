// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import os, { tmpdir } from 'node:os'
import type { LockInfo } from '../../src/utils/file-lock.js'

const roots: string[] = []
const CLI = resolve('src/cli.ts')

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function run(args: string[], cwd: string) {
  return spawnSync('npx', ['tsx', CLI, ...args], { cwd, encoding: 'utf-8', timeout: 30_000 })
}

function realBootId(): string {
  try {
    return readFileSync('/proc/sys/kernel/random/boot_id', 'utf-8').trim()
  } catch {
    return 'unknown'
  }
}

describe('doctor subcommand option inheritance (#2165)', () => {
  it('uses subcommand --dir and --json for repair-state instead of the caller cwd', () => {
    const root = mkdtempSync(join(tmpdir(), 'arbiter-doctor-options-'))
    roots.push(root)
    const target = join(root, 'target')
    const outside = join(root, 'outside')
    mkdirSync(target)
    mkdirSync(outside)
    writeFileSync(join(target, 'arbiter.json'), readFileSync(resolve('arbiter.json'), 'utf-8'))

    const result = run(['doctor', 'repair-state', '--dir', target, '--json'], outside)
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout).command).toBe('doctor repair-state')
  })

  it.each(['recover-lock', 'clean'])(
    'emits the real JSON envelope for doctor %s --json',
    (command) => {
      const root = mkdtempSync(join(tmpdir(), 'arbiter-doctor-json-'))
      roots.push(root)
      const result = run(['doctor', command, '--json'], root)
      expect(result.status, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout).command).toBe(`doctor ${command}`)
    },
  )

  it('refuses a real live lock without --force, then releases it with --force (#2210)', () => {
    const root = mkdtempSync(join(tmpdir(), 'arbiter-doctor-live-lock-'))
    roots.push(root)
    const target = join(root, 'target')
    const lockDir = join(target, '.arbiter')
    mkdirSync(lockDir, { recursive: true })
    const holder = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    })
    try {
      const pid = holder.pid as number
      const info: LockInfo = {
        pid,
        hostname: os.hostname(),
        bootId: realBootId(),
        startedAt: new Date().toISOString(),
        cmd: 'real CLI lock holder',
        nonce: 'live-lock-nonce',
      }
      const lockPath = join(lockDir, '.lock')
      writeFileSync(lockPath, JSON.stringify(info), 'utf-8')

      const refused = run(['doctor', 'recover-lock', '--dir', target], root)
      expect(refused.status, refused.stderr).toBe(1)
      expect(refused.stderr).toMatch(/--force/)
      expect(existsSync(lockPath)).toBe(true)
      expect(() => process.kill(pid, 0)).not.toThrow()

      const forced = run(['doctor', 'recover-lock', '--dir', target, '--force'], root)
      expect(forced.status, forced.stderr).toBe(0)
      expect(existsSync(lockPath)).toBe(false)
      expect(() => process.kill(pid, 0)).not.toThrow()
    } finally {
      if (holder.exitCode === null) holder.kill('SIGKILL')
    }
  }, 45_000)

  it('recovers a dead kit.lock even when .lock has a real live holder (#2210)', () => {
    const root = mkdtempSync(join(tmpdir(), 'arbiter-doctor-mixed-locks-'))
    roots.push(root)
    const target = join(root, 'target')
    const lockDir = join(target, '.arbiter')
    mkdirSync(lockDir, { recursive: true })
    const holder = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    })
    try {
      const pid = holder.pid as number
      const liveInfo: LockInfo = {
        pid,
        hostname: os.hostname(),
        bootId: realBootId(),
        startedAt: new Date().toISOString(),
        cmd: 'real CLI lock holder',
        nonce: 'live-lock-nonce',
      }
      const deadHolder = spawnSync(process.execPath, ['-e', 'process.exit(0)'], {
        encoding: 'utf-8',
      })
      const deadPid = deadHolder.pid as number
      expect(() => process.kill(deadPid, 0)).toThrow()
      const lockPath = join(lockDir, '.lock')
      const kitLockPath = join(lockDir, 'kit.lock')
      writeFileSync(lockPath, JSON.stringify(liveInfo), 'utf-8')
      writeFileSync(kitLockPath, JSON.stringify({ ...liveInfo, pid: deadPid }), 'utf-8')

      const result = run(['doctor', 'recover-lock', '--dir', target, '--json'], root)
      const output = JSON.parse(result.stdout)
      expect(result.status, result.stderr).toBe(1)
      expect(output).toMatchObject({
        command: 'doctor recover-lock',
        status: 'error',
        data: {
          found: true,
          released: true,
          refused: [
            {
              rel: '.arbiter/.lock',
              pid,
              cmd: 'real CLI lock holder',
              age: expect.any(Number),
            },
          ],
        },
      })
      expect(result.stderr).toMatch(/\.arbiter\/\.lock|--force/)
      expect(existsSync(lockPath)).toBe(true)
      expect(existsSync(kitLockPath)).toBe(false)
      expect(() => process.kill(pid, 0)).not.toThrow()
    } finally {
      if (holder.exitCode === null) holder.kill('SIGKILL')
    }
  }, 45_000)

  it('reports CORRUPT, rather than absent, when recovering an unreadable lock (#2210)', () => {
    const root = mkdtempSync(join(tmpdir(), 'arbiter-doctor-corrupt-lock-'))
    roots.push(root)
    const target = join(root, 'target')
    const lockDir = join(target, '.arbiter')
    mkdirSync(lockDir, { recursive: true })
    const lockPath = join(lockDir, '.lock')
    writeFileSync(lockPath, 'not json at all', 'utf-8')

    const result = run(['doctor', 'recover-lock', '--dir', target], root)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toMatch(/CORRUPT/)
    expect(result.stdout).not.toMatch(/No lock file found/)
    expect(existsSync(lockPath)).toBe(false)
  }, 45_000)
})
