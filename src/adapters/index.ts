// SPDX-License-Identifier: Apache-2.0
// Barrel for StackAdapter exports. Each adapter self-registers on import.
// External consumers that need all adapters active should import this file.

export type { StackAdapter } from './StackAdapter.js'
export { registerAdapter, resolveAdapter, listAdapters, _resetForTest } from './_registry.js'
export { tsAdapter } from './typescript.js'
export { javaAdapter } from './java.js'
export { pythonAdapter } from './python.js'
export { goAdapter } from './go.js'
export { rustAdapter } from './rust.js'
