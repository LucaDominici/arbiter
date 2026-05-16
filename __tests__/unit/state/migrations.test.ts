// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { migrateState } from '../../../src/state/migrations/index.js'
import { migrateV0ToV1 } from '../../../src/state/migrations/v0-to-v1.js'

describe('migrateV0ToV1', () => {
  it('wraps a raw config into an envelope', () => {
    const env = migrateV0ToV1({ version: '0.2', tools: ['claude'] })
    expect(env.$schemaVersion).toBe(1)
    expect((env.config as { version: string }).version).toBe('0.2')
  })
})

describe('migrateState', () => {
  it('v0 (bare config) → v1 envelope, migrated=true', () => {
    const r = migrateState({ tools: ['claude'] })
    expect(r.migrated).toBe(true)
    expect(r.envelope.$schemaVersion).toBe(1)
  })
  it('v1 envelope (already migrated) → passthrough, migrated=false', () => {
    const r = migrateState({
      '.checksum': 'whatever',
      $schemaVersion: 1,
      config: { tools: ['claude'] },
    })
    expect(r.migrated).toBe(false)
    expect(r.envelope.config).toEqual({ tools: ['claude'] })
  })
  it('non-object input throws', () => {
    expect(() => migrateState('string')).toThrow(/non-null JSON object/)
  })
  it('future $schemaVersion throws', () => {
    expect(() => migrateState({ $schemaVersion: 99, config: {} })).toThrow(/unsupported/)
  })
})
