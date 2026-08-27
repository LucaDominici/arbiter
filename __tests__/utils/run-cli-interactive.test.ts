import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readdirSync: vi.fn(),
  readlinkSync: vi.fn(),
  spawn: vi.fn(),
}))

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  readdirSync: mocks.readdirSync,
  readlinkSync: mocks.readlinkSync,
}))

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: mocks.spawn,
}))

import { runInteractive } from '../../src/utils/run-cli.js'

const CHILD_PID = 4242
const DESCENDANT_PID = 4343
const SENTINEL = '/tmp/arbiter-gate.sentinel'

describe('runInteractive escaped-descendant teardown', () => {
  let child: ChildProcess
  let killSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    child = Object.assign(new EventEmitter(), { pid: CHILD_PID }) as unknown as ChildProcess
    mocks.spawn.mockReturnValue(child)
    killSpy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === -CHILD_PID && signal === 0) {
        throw Object.assign(new Error('gone'), { code: 'ESRCH' })
      }
      return true
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('kills a holder that escaped the child process group before resolving', async () => {
    let procScans = 0
    mocks.readdirSync.mockImplementation((path) => {
      if (path === '/proc') return procScans++ === 0 ? [String(DESCENDANT_PID)] : []
      if (path === `/proc/${DESCENDANT_PID}/fd`) return ['4']
      throw new Error(`unexpected path: ${String(path)}`)
    })
    mocks.readlinkSync.mockReturnValue(SENTINEL)

    const result = runInteractive('gate', [], {
      extraFds: [9],
      detached: true,
      teardownProcessGroupOnSignal: true,
      trackedDescendantFdPath: SENTINEL,
    })
    child.emit('close', null, 'SIGKILL')

    await expect(result).resolves.toEqual({ exitCode: 1 })
    expect(killSpy).toHaveBeenCalledWith(DESCENDANT_PID, 'SIGKILL')
    expect(mocks.spawn).toHaveBeenCalledWith(
      'gate',
      [],
      expect.objectContaining({ stdio: ['inherit', 'inherit', 'inherit', 9] }),
    )
  })

  it('declares degraded cleanup when procfs is unavailable', async () => {
    mocks.readdirSync.mockImplementation(() => {
      throw new Error('no procfs')
    })
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    const result = runInteractive('gate', [], {
      teardownProcessGroupOnSignal: true,
      trackedDescendantFdPath: SENTINEL,
    })
    child.emit('close', null, 'SIGKILL')

    await expect(result).resolves.toEqual({ exitCode: 1 })
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('/proc unavailable'))
  })

  it('continues past unreadable and raced proc entries', async () => {
    mocks.readdirSync.mockImplementation((path) => {
      if (path === '/proc') return ['100', '101']
      if (path === '/proc/100/fd') throw new Error('unreadable')
      if (path === '/proc/101/fd') return ['4']
      throw new Error(`unexpected path: ${String(path)}`)
    })
    mocks.readlinkSync.mockImplementation(() => {
      throw new Error('raced away')
    })

    const result = runInteractive('gate', [], {
      teardownProcessGroupOnSignal: true,
      trackedDescendantFdPath: SENTINEL,
    })
    child.emit('close', null, 'SIGKILL')

    await expect(result).resolves.toEqual({ exitCode: 1 })
    expect(killSpy).not.toHaveBeenCalledWith(100, 'SIGKILL')
    expect(killSpy).not.toHaveBeenCalledWith(101, 'SIGKILL')
  })

  it('retains cleanup ownership and retries when killing the process group returns EPERM', async () => {
    mocks.readdirSync.mockReturnValue([])
    let groupKillAttempts = 0
    killSpy.mockImplementation((pid, signal) => {
      if (pid === -CHILD_PID && signal === 'SIGKILL' && groupKillAttempts++ === 0) {
        throw Object.assign(new Error('denied'), { code: 'EPERM' })
      }
      if (pid === -CHILD_PID && signal === 0) {
        throw Object.assign(new Error('gone'), { code: 'ESRCH' })
      }
      return true
    })

    const result = runInteractive('gate', [], {
      teardownProcessGroupOnSignal: true,
      trackedDescendantFdPath: SENTINEL,
    })
    child.emit('close', null, 'SIGKILL')

    await expect(result).resolves.toEqual({ exitCode: 1 })
    expect(groupKillAttempts).toBe(2)
  })

  it('retains cleanup ownership and retries when killing an escaped holder returns EPERM', async () => {
    let procScans = 0
    mocks.readdirSync.mockImplementation((path) => {
      if (path === '/proc') return procScans++ < 2 ? [String(DESCENDANT_PID)] : []
      if (path === `/proc/${DESCENDANT_PID}/fd`) return ['4']
      throw new Error(`unexpected path: ${String(path)}`)
    })
    mocks.readlinkSync.mockReturnValue(SENTINEL)
    let descendantKillAttempts = 0
    killSpy.mockImplementation((pid, signal) => {
      if (pid === -CHILD_PID && signal === 0) {
        throw Object.assign(new Error('gone'), { code: 'ESRCH' })
      }
      if (pid === DESCENDANT_PID && descendantKillAttempts++ === 0) {
        throw Object.assign(new Error('denied'), { code: 'EPERM' })
      }
      return true
    })

    const result = runInteractive('gate', [], {
      teardownProcessGroupOnSignal: true,
      trackedDescendantFdPath: SENTINEL,
    })
    child.emit('close', null, 'SIGKILL')

    await expect(result).resolves.toEqual({ exitCode: 1 })
    expect(descendantKillAttempts).toBe(2)
  })
})
