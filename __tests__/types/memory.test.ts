import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ArbiterMemoryPlugin } from '../../src/types/memory.js'
import type { PluginContext } from '../../src/types/plugin.js'

describe('ArbiterMemoryPlugin interface', () => {
  it('compiles as a valid implementation of ArbiterMemoryPlugin', () => {
    // Type-level test: an object conforming to the interface should typecheck.
    // The cast to the interface type would fail at compile-time if the interface
    // is broken. The runtime assertion confirms the shape is logically consistent.
    const impl: ArbiterMemoryPlugin = {
      store: async (): Promise<void> => {
        // stub
      },
      retrieve: async (): Promise<unknown> => {
        return undefined
      },
      search: async (): Promise<Array<{ key: string; value: unknown }>> => {
        return []
      },
    }
    expect(typeof impl.store).toBe('function')
    expect(typeof impl.retrieve).toBe('function')
    expect(typeof impl.search).toBe('function')
  })

  it('PluginContext.memory is optional (PluginContext without memory is valid)', () => {
    // A PluginContext that omits memory must still satisfy the type.
    const ctx: PluginContext = {
      config: {
        version: '0.1',
        tools: ['claude'],
        governanceLevel: 'L2',
        useGitHub: false,
      },
      targetDir: '/tmp/test',
      renderTemplate: (): string => '',
    }
    expect(ctx.memory).toBeUndefined()
  })

  it('PluginContext can carry a memory plugin when provided', () => {
    const memPlugin: ArbiterMemoryPlugin = {
      store: async (): Promise<void> => {},
      retrieve: async (): Promise<unknown> => null,
      search: async (): Promise<Array<{ key: string; value: unknown }>> => [],
    }
    const ctx: PluginContext = {
      config: {
        version: '0.1',
        tools: ['claude'],
        governanceLevel: 'L2',
        useGitHub: false,
      },
      targetDir: '/tmp/test',
      renderTemplate: (): string => '',
      memory: memPlugin,
    }
    expect(ctx.memory).toBe(memPlugin)
  })
})

describe('ArbiterMemoryPlugin isolation', () => {
  it('is not imported by src/generators or src/commands directly', () => {
    // Dynamically verify no core module imports ArbiterMemoryPlugin.
    // This is a guardrail: the interface is plugin-only.
    const cwd = process.cwd()
    const dirsToCheck = [join(cwd, 'src', 'generators'), join(cwd, 'src', 'commands')]

    for (const dir of dirsToCheck) {
      let files: string[]
      try {
        files = readdirSync(dir).filter((f) => f.endsWith('.ts'))
      } catch {
        continue
      }
      for (const file of files) {
        const content = readFileSync(join(dir, file), 'utf-8')
        expect(content, `${file} must not import ArbiterMemoryPlugin`).not.toContain(
          'ArbiterMemoryPlugin',
        )
      }
    }
  })
})
