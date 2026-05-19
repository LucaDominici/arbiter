// SPDX-License-Identifier: Apache-2.0
import type { StackAdapter } from './StackAdapter.js'
import { registerAdapter } from './_registry.js'

const goAdapter: StackAdapter = {
  language: 'go',
  isStub: true,
  lintCommand: () => null,
  formatCommand: () => null,
  languageHooks: () => [],
  supportsCoverage: () => false,
  supportsMutation: () => false,
}

registerAdapter(goAdapter)
export { goAdapter }
