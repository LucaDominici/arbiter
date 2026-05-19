// SPDX-License-Identifier: Apache-2.0
import type { Language } from '../wizard/types.js'
import type { LanguageHook } from '../wizard/types.js'

export interface StackAdapter {
  readonly language: Language
  readonly isStub: boolean
  /**
   * Returns lint command override, or null to use project config default.
   * Callers must null-check before assigning to ProjectConfig fields.
   */
  lintCommand(): string | null
  /**
   * Returns format command override, or null to use project config default.
   * Callers must null-check before assigning to ProjectConfig fields.
   */
  formatCommand(): string | null
  /** Language-specific hook scripts to generate. Does NOT replace common hooks from getLanguageHooks(). */
  languageHooks(): LanguageHook[]
  supportsCoverage(): boolean
  supportsMutation(): boolean
}
