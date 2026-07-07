// SPDX-License-Identifier: Apache-2.0

/**
 * Sanitize a task id into a safe filesystem segment AND safe regex literal.
 *
 * Whitelist `[a-zA-Z0-9_-]`, replace anything else with `_`, cap at 64 chars,
 * fall back to `'unknown'` for empty input.
 *
 * Leaf utility — shared by `src/commands/task.ts`, `task-state.ts`, `task-note.ts`,
 * `task-record-tech-debt.ts`, and `.claude/hooks/lib.mjs::sanitizeTaskId`. Parity with the
 * hook copy is asserted by `__tests__/lib/sanitize-task-id-parity.test.ts`.
 */
export function sanitizeTaskId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
  return cleaned.length > 0 ? cleaned : 'unknown'
}
