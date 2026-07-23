// SPDX-License-Identifier: Apache-2.0
// Anti-drift guard (gate-throughput follow-up, npm run regen): every
// DERIVED_ARTIFACTS.name must correspond to a real runCheck/runWarnCheck name
// in check-all.mjs, and every checkCmd's script path must appear in that same
// check-all.mjs call — so this registry can't silently diverge from the gate
// it mirrors (the exact class of bug this whole feature exists to prevent).
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { DERIVED_ARTIFACTS } from '../../../scripts/lib/derived-artifacts.mjs'

const CHECK_ALL_SRC = readFileSync(resolve('scripts/check-all.mjs'), 'utf-8')

// Matches runCheck('name', 'cmd', [...]) / runWarnCheck(...) / runToolCheck(...)
// call sites, capturing the name and the raw args-array source text.
const CALL_RE = /run(?:Check|WarnCheck|ToolCheck)\(\s*'([^']+)',\s*'[^']+',\s*\[([^\]]*)\]/g

function checkAllCalls(): Map<string, string> {
  const calls = new Map<string, string>()
  for (const m of CHECK_ALL_SRC.matchAll(CALL_RE)) {
    calls.set(m[1], m[2])
  }
  return calls
}

describe('scripts/lib/derived-artifacts.mjs (registry drift guard)', () => {
  it('is non-empty', () => {
    expect(DERIVED_ARTIFACTS.length).toBeGreaterThan(0)
  })

  it('every entry name matches a real runCheck/runWarnCheck name in check-all.mjs', () => {
    const calls = checkAllCalls()
    for (const { name } of DERIVED_ARTIFACTS) {
      expect(calls.has(name), `"${name}" not found as a check name in check-all.mjs`).toBe(true)
    }
  })

  it("every entry's checkCmd script path appears in check-all.mjs's call for that name", () => {
    const calls = checkAllCalls()
    for (const { name, checkCmd } of DERIVED_ARTIFACTS) {
      const argsSrc = calls.get(name)
      const scriptPath = checkCmd[1]
      expect(argsSrc, `no args captured for "${name}"`).toBeDefined()
      expect(
        argsSrc?.includes(scriptPath),
        `"${name}": checkCmd script "${scriptPath}" not found in check-all.mjs's call`,
      ).toBe(true)
    }
  })

  it('every entry has a distinct name (no duplicate registry rows)', () => {
    const names = DERIVED_ARTIFACTS.map((a) => a.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('writeCmd and checkCmd both point at a script that exists on disk', () => {
    for (const { writeCmd, checkCmd } of DERIVED_ARTIFACTS) {
      for (const cmd of [writeCmd, checkCmd]) {
        if (cmd[0] === 'node') {
          expect(existsSync(resolve(cmd[1])), `missing script: ${cmd[1]}`).toBe(true)
        }
      }
    }
  })
})
