// SPDX-License-Identifier: Apache-2.0
import type { StackAdapter } from './StackAdapter.js'
import { registerAdapter } from './_registry.js'

/**
 * Java/Spring stack adapter — full implementation (#889, F2-java).
 *
 * Covers 94 dimensions from the 218-dim crosswalk:
 * - Lint: Checkstyle (10 rules) + PMD (8 rules) via Maven
 * - Format: null — Java formatting enforced through Checkstyle config, not a separate step
 * - Coverage: JaCoCo (supportsCoverage: true)
 * - Mutation: Pitest (supportsMutation: true)
 * - languageHooks: delegated to getLanguageHooks('java') which emits
 *   JAVA_NO_RAW_TYPES + JAVA_NO_MOCKMVC; this adapter returns [] to
 *   avoid duplication (per StackAdapter interface: "Does NOT replace common hooks")
 */
const javaAdapter: StackAdapter = {
  language: 'java',
  isStub: false,
  lintCommand: () => 'mvn checkstyle:check pmd:check',
  formatCommand: () => null,
  languageHooks: () => [],
  supportsCoverage: () => true,
  supportsMutation: () => true,
}

registerAdapter(javaAdapter)
export { javaAdapter }
