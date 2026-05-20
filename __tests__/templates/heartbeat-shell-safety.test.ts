// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { renderTemplate } from '../../src/utils/render.js'

const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/ci-tier-render-context.json', import.meta.url), 'utf-8'),
)

describe('heartbeat shell-safety — gh run list calls are guarded', () => {
  it("every gh run list call in 09-heartbeat.yml is wrapped with || echo '[]' fallback", () => {
    const rendered = renderTemplate('github/workflows/09-heartbeat.yml.ejs', fixture)
    // Count gh run list invocations.
    const calls = (rendered.match(/gh run list/g) ?? []).length
    expect(calls).toBeGreaterThan(0)
    // Each call must be paired with the fallback OR-guard. Pattern allows whitespace
    // and `2>/dev/null` between `--repo "$GH_REPO"` and `|| echo '[]'`.
    const guarded = (rendered.match(/gh run list[\s\S]*?\|\| echo ['"]\[\]['"]/g) ?? []).length
    expect(guarded).toBe(calls)
  })

  it('guarded snippet does not trip set -e when gh is missing on PATH', () => {
    // Simulate the load-bearing pattern: assign the OR-result to a var under set -e.
    // If a substituted command fails, the `|| echo '[]'` keeps the var assignment
    // valid (`RUN_INFO='[]'`) and the script continues.
    const script = `
      set -euo pipefail
      RUN_INFO=$(__bogus_command_does_not_exist__ 2>/dev/null || echo '[]')
      [ "$RUN_INFO" = "[]" ] || { echo "FAIL: RUN_INFO=$RUN_INFO"; exit 1; }
      echo "OK"
    `
    const out = execFileSync('bash', ['-c', script], { encoding: 'utf-8' })
    expect(out.trim()).toBe('OK')
  })
})
