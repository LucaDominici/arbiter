/**
 * Example adapter — shows how to implement ArbiterMemoryPlugin with a simple
 * in-process store (suitable for testing or development use).
 *
 * For a production implementation backed by claude-mem or another persistence
 * layer, replace the in-memory Map with your actual storage calls.
 */
import type { ArbiterMemoryPlugin } from '../../../src/types/memory.js'

const store = new Map<string, unknown>()

export const claudeMemAdapter: ArbiterMemoryPlugin = {
  async store(key: string, value: unknown): Promise<void> {
    console.log(`[claude-mem] store key=${key}`)
    store.set(key, value)
  },

  async retrieve(key: string): Promise<unknown> {
    console.log(`[claude-mem] retrieve key=${key}`)
    return store.get(key)
  },

  async search(query: string): Promise<Array<{ key: string; value: unknown }>> {
    console.log(`[claude-mem] search query=${query}`)
    const results: Array<{ key: string; value: unknown }> = []
    for (const [k, v] of store.entries()) {
      if (k.includes(query)) {
        results.push({ key: k, value: v })
      }
    }
    return results
  },
}
