// SPDX-License-Identifier: Apache-2.0
// Unit-level coverage for plugin-worker.ts's `run()` and the top-level
// `if (workerData)` guard. plugin-loader.test.ts already exercises this file
// end-to-end through a real `Worker` thread, but v8 coverage collection does
// not attribute execution inside a spawned worker_thread back to this
// process's coverage report — hence the file shows as ~30% covered despite
// being exercised. Importing the module directly, with `node:worker_threads`
// mocked, runs its top-level code and `run()` in-process so coverage counts.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolve } from 'node:path'
import type { ArbiterConfig } from '../../../src/utils/config.js'

const FIXTURES = resolve(__dirname, '../../fixtures/plugins')

function baseConfig(): ArbiterConfig {
  return { projectName: 'demo' } as unknown as ArbiterConfig
}

async function loadWorker(workerData: unknown, expectMessage: boolean) {
  const messages: unknown[] = []
  vi.resetModules()
  vi.doMock('node:worker_threads', () => ({
    workerData,
    parentPort: { postMessage: (msg: unknown) => messages.push(msg) },
  }))
  await import('../../../src/utils/plugin-worker.js')
  if (expectMessage) {
    // run() is async and fires from top-level code without being awaited by
    // the module itself, and does real file I/O (dynamic import,
    // readFileSync) — poll until postMessage has actually been called
    // instead of a fixed-length sleep.
    await vi.waitFor(() => {
      if (messages.length === 0) throw new Error('worker has not posted yet')
    })
  }
  return messages
}

afterEach(() => {
  vi.doUnmock('node:worker_threads')
  vi.resetModules()
})

describe('plugin-worker run() (#1761 coverage)', () => {
  it('does nothing when workerData is absent', async () => {
    const messages = await loadWorker(undefined, false)
    expect(messages).toEqual([])
  })

  it('detect kind posts the boolean result', async () => {
    const messages = await loadWorker(
      {
        entryPath: resolve(FIXTURES, 'detecting/index.js'),
        kind: 'detect',
        config: baseConfig(),
        targetDir: '/tmp/does-not-matter',
        templateRoot: resolve(FIXTURES, 'detecting'),
      },
      true,
    )
    expect(messages).toEqual([{ kind: 'result', value: true }])
  })

  it('generate kind renders a template through renderTemplate and posts the result', async () => {
    const messages = await loadWorker(
      {
        entryPath: resolve(FIXTURES, 'render-basepackage/index.js'),
        kind: 'generate',
        config: baseConfig(),
        targetDir: '/tmp/does-not-matter',
        templateRoot: resolve(FIXTURES, 'render-basepackage/templates'),
      },
      true,
    )
    expect(messages).toHaveLength(1)
    const [msg] = messages as [{ kind: string; value: { files: Array<{ content: string }> } }]
    expect(msg.kind).toBe('result')
    expect(msg.value.files[0]?.content).toContain('com.example.sample')
    expect(msg.value.files[0]?.content).toContain('demo')
  })

  it('posts a kind:error message when the plugin throws', async () => {
    const messages = await loadWorker(
      {
        entryPath: resolve(FIXTURES, 'throwing/index.js'),
        kind: 'generate',
        config: baseConfig(),
        targetDir: '/tmp/does-not-matter',
        templateRoot: resolve(FIXTURES, 'throwing'),
      },
      true,
    )
    expect(messages).toEqual([{ kind: 'error', message: 'plugin generate failed intentionally' }])
  })

  it('stringifies a non-Error throw instead of reading .message', async () => {
    const messages = await loadWorker(
      {
        entryPath: resolve(FIXTURES, 'throwing-non-error/index.js'),
        kind: 'generate',
        config: baseConfig(),
        targetDir: '/tmp/does-not-matter',
        templateRoot: resolve(FIXTURES, 'throwing-non-error'),
      },
      true,
    )
    expect(messages).toEqual([{ kind: 'error', message: 'string based failure' }])
  })

  it('falls back to the `plugin` named export when there is no default export', async () => {
    const messages = await loadWorker(
      {
        entryPath: resolve(FIXTURES, 'plugin-key-export/index.mjs'),
        kind: 'detect',
        config: baseConfig(),
        targetDir: '/tmp/does-not-matter',
        templateRoot: resolve(FIXTURES, 'plugin-key-export'),
      },
      true,
    )
    expect(messages).toEqual([{ kind: 'result', value: true }])
  })

  it('preserves an existing basePackage key instead of defaulting it to undefined', async () => {
    vi.resetModules()
    vi.doMock('node:worker_threads', () => ({
      workerData: undefined,
      parentPort: { postMessage: vi.fn() },
    }))
    const mod = await import('../../../src/utils/plugin-worker.js')
    const result = mod.withPluginRenderDefaults({ basePackage: 'com.example.existing' })
    expect(result['basePackage']).toBe('com.example.existing')
  })
})
