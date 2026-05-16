// SPDX-License-Identifier: Apache-2.0

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
