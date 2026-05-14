import { describe, it, expect } from 'vitest'
import {
  isOpenLogEntry,
  isCloseLogEntry,
  type OpenLogEntry,
  type CloseLogEntry,
} from '../../src/commands/worktree.js'

describe('worktree log type guards (#502)', () => {
  const validOpen: OpenLogEntry = {
    taskId: '123',
    slug: null,
    worktreePath: '/tmp/wt',
    branch: 'task/#123',
    baseBranch: 'main',
    baseRef: 'abc1234',
    openedAt: '2026-05-14T00:00:00.000Z',
  }
  const validClose: CloseLogEntry = {
    taskId: '123',
    branch: 'task/#123',
    worktreePath: '/tmp/wt',
    closedAt: '2026-05-14T00:00:00.000Z',
    force: false,
  }

  it('isOpenLogEntry accepts a canonical OpenLogEntry', () => {
    expect(isOpenLogEntry(validOpen)).toBe(true)
  })

  it('isCloseLogEntry accepts a canonical CloseLogEntry', () => {
    expect(isCloseLogEntry(validClose)).toBe(true)
  })

  it('isOpenLogEntry REJECTS a CloseLogEntry (discriminator on openedAt)', () => {
    expect(isOpenLogEntry(validClose)).toBe(false)
  })

  it('isCloseLogEntry REJECTS an OpenLogEntry (discriminator on closedAt)', () => {
    expect(isCloseLogEntry(validOpen)).toBe(false)
  })

  it('both guards reject a value with only the shared fields', () => {
    const sharedOnly = {
      taskId: '123',
      worktreePath: '/tmp/wt',
      branch: 'task/#123',
    }
    expect(isOpenLogEntry(sharedOnly)).toBe(false)
    expect(isCloseLogEntry(sharedOnly)).toBe(false)
  })

  it('both guards reject non-object values', () => {
    for (const v of [null, undefined, 0, '', 'string', false, []]) {
      expect(isOpenLogEntry(v)).toBe(false)
      expect(isCloseLogEntry(v)).toBe(false)
    }
  })

  it('both guards reject entries with wrong-typed shared fields', () => {
    expect(isOpenLogEntry({ taskId: 1, worktreePath: '/x', branch: 'b', openedAt: 'now' })).toBe(
      false,
    )
    expect(isCloseLogEntry({ taskId: 1, worktreePath: '/x', branch: 'b', closedAt: 'now' })).toBe(
      false,
    )
  })

  it('isOpenLogEntry rejects when openedAt is not a string', () => {
    const bad = { ...validOpen, openedAt: 12345 } as unknown
    expect(isOpenLogEntry(bad)).toBe(false)
  })

  it('isCloseLogEntry rejects when closedAt is not a string', () => {
    const bad = { ...validClose, closedAt: 12345 } as unknown
    expect(isCloseLogEntry(bad)).toBe(false)
  })
})
