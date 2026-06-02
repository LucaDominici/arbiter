// SPDX-License-Identifier: Apache-2.0
// Test-only registry: no runtime generator or command calls resolveAdapter/listAdapters.
// Runtime enforcement is via check-adapter-coverage.mjs (file existence) and doctor.ts.
// INV-88 does NOT require a runtime dispatch Map.
import type { Language } from '../wizard/types.js'
import type { StackAdapter } from './StackAdapter.js'

const registry = new Map<Language, StackAdapter>()

export function registerAdapter(adapter: StackAdapter): void {
  if (registry.has(adapter.language)) {
    throw new Error(`StackAdapter already registered for language: ${adapter.language}`)
  }
  registry.set(adapter.language, adapter)
}

export function resolveAdapter(language: Language): StackAdapter | undefined {
  return registry.get(language)
}

export function listAdapters(): StackAdapter[] {
  return [...registry.values()]
}

/** For test isolation only — clears the registry. Call in afterEach. */
export function _resetForTest(): void {
  registry.clear()
}
