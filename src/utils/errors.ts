// SPDX-License-Identifier: Apache-2.0

/**
 * Error that carries a message intended for direct display to the end-user.
 * The CLI top-level handler prints the message without a stack trace for these.
 * Use for validation failures, missing prerequisites, and user-correctable conditions.
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UserFacingError'
  }
}

/**
 * Thrown by loadConfig when arbiter.json exists but cannot be parsed or migrated.
 * Distinct from ENOENT (file absent) which returns null.
 */
export class ConfigLoadError extends UserFacingError {
  constructor(
    public readonly configPath: string,
    cause: unknown,
  ) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    super(
      `arbiter.json at ${configPath} is unreadable or corrupt: ${reason}\n` +
        `To reset: delete arbiter.json and re-run \`arbiter init\`.`,
    )
    this.name = 'ConfigLoadError'
    this.cause = cause
  }
}
