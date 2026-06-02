// SPDX-License-Identifier: Apache-2.0
import type { StackAdapter } from './StackAdapter.js'

const rustAdapter: StackAdapter = {
  language: 'rust',
  isStub: true,
  lintCommand: () => null,
  formatCommand: () => null,
  languageHooks: () => [],
  supportsCoverage: () => false,
  supportsMutation: () => false,
}

export { rustAdapter }
