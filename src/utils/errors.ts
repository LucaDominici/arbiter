// SPDX-License-Identifier: Apache-2.0
import { t } from '../i18n/index.js'

/**
 * Thrown by commands when the error message is already user-readable.
 * The top-level CLI catch logs only .message for these — no stack dump.
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UserFacingError'
  }
}

export interface ArbiterErrorOptions {
  hint?: string
  docUrl?: string
}

/**
 * Structured CLI error with a machine-readable code, optional recovery hint,
 * and optional documentation URL. Rendered by the top-level catcher as:
 *
 *   Error [E_CODE]: message
 *     Hint: ...
 *     Docs: ...
 */
export class ArbiterError extends UserFacingError {
  readonly code: string
  readonly hint: string | undefined
  readonly docUrl: string | undefined

  constructor(code: string, message: string, opts?: ArbiterErrorOptions) {
    super(message)
    this.name = 'ArbiterError'
    this.code = code
    this.hint = opts?.hint
    this.docUrl = opts?.docUrl
  }

  static fromKey(
    code: string,
    key: string,
    params?: Record<string, string | number>,
    opts?: ArbiterErrorOptions,
  ): ArbiterError {
    return new ArbiterError(code, t(key, params), opts)
  }
}
