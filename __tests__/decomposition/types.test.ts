import { describe, it, expect } from 'vitest'
import type { WorkUnit, DecompositionBackend } from '../../src/decomposition/types.js'

describe('WorkUnit shape', () => {
  it('allows minimal required fields', () => {
    const u: WorkUnit = {
      id: '#1',
      title: 'Test',
      status: 'open',
    }
    expect(u.id).toBe('#1')
    expect(u.status).toBe('open')
  })

  it('allows all optional fields', () => {
    const u: WorkUnit = {
      id: 'WU-1',
      title: 'Full',
      status: 'in_progress',
      phase: 'red',
      parent: '#0',
      body: 'details',
      labels: ['bug'],
    }
    expect(u.labels).toHaveLength(1)
    expect(u.phase).toBe('red')
  })

  it('status union covers all expected values', () => {
    const statuses: WorkUnit['status'][] = ['open', 'in_progress', 'blocked', 'done']
    expect(statuses).toHaveLength(4)
  })
})

describe('DecompositionBackend interface', () => {
  it('can be satisfied by a conforming object', () => {
    const backend: DecompositionBackend = {
      id: 'markdown',
      list: async () => [],
      get: async () => null,
      create: async (input) => ({ id: 'WU-1', ...input }),
      advance: async () => undefined,
      close: async () => undefined,
    }
    expect(backend.id).toBe('markdown')
  })
})
