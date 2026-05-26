// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, readFileSync, readdirSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { atomicWriteFile, withLock } from '../../src/utils/atomic-write.js'

// ─── Test dir ─────────────────────────────────────────────────────────────────

let testDir: string

beforeAll(() => {
  testDir = join(tmpdir(), `arbiter-atomic-write-test-${process.pid}`)
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

// ─── atomicWriteFile ──────────────────────────────────────────────────────────

describe('atomicWriteFile', () => {
  it('writes file with correct content', async () => {
    const target = join(testDir, 'basic.json')
    await atomicWriteFile(target, '{"ok":true}')
    expect(readFileSync(target, 'utf-8')).toBe('{"ok":true}')
  })

  it('overwrites existing file', async () => {
    const target = join(testDir, 'overwrite.json')
    await atomicWriteFile(target, 'first')
    await atomicWriteFile(target, 'second')
    expect(readFileSync(target, 'utf-8')).toBe('second')
  })

  it('does not leave .tmp file after successful write', async () => {
    const target = join(testDir, 'no-tmp.json')
    await atomicWriteFile(target, 'content')
    const tmpFiles = readdirSync(testDir).filter((f) => f.includes('.tmp'))
    expect(tmpFiles).toHaveLength(0)
  })

  it('final file exists after write', async () => {
    const target = join(testDir, 'exists.json')
    await atomicWriteFile(target, '{}')
    expect(existsSync(target)).toBe(true)
  })

  it('writes to nested directory', async () => {
    const nested = join(testDir, 'nested/deep')
    mkdirSync(nested, { recursive: true })
    const target = join(nested, 'data.json')
    await atomicWriteFile(target, '{"nested":true}')
    expect(readFileSync(target, 'utf-8')).toBe('{"nested":true}')
  })
})

// ─── withLock ─────────────────────────────────────────────────────────────────

describe('withLock', () => {
  it('executes the callback', async () => {
    const lockPath = join(testDir, 'test.lock')
    let called = false
    await withLock(lockPath, async () => {
      called = true
    })
    expect(called).toBe(true)
  })

  it('releases lock after success', async () => {
    const lockPath = join(testDir, 'release.lock')
    await withLock(lockPath, async () => {})
    // Should be able to acquire again
    let called = false
    await withLock(lockPath, async () => {
      called = true
    })
    expect(called).toBe(true)
  })

  it('releases lock even when callback throws', async () => {
    const lockPath = join(testDir, 'throw.lock')
    await expect(
      withLock(lockPath, async () => {
        throw new Error('callback failed')
      }),
    ).rejects.toThrow('callback failed')

    // Lock should be released — can acquire again
    let called = false
    await withLock(lockPath, async () => {
      called = true
    })
    expect(called).toBe(true)
  })

  it('serializes two sequential lock acquisitions', async () => {
    const lockPath = join(testDir, 'serial.lock')
    const order: number[] = []
    await withLock(lockPath, async () => {
      order.push(1)
    })
    await withLock(lockPath, async () => {
      order.push(2)
    })
    expect(order).toEqual([1, 2])
  })

  it('propagates callback return value', async () => {
    const lockPath = join(testDir, 'return.lock')
    const result = await withLock(lockPath, async () => 42)
    expect(result).toBe(42)
  })
})
