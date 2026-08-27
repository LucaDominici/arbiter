import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// #2378 — the audit's F1 caveat claimed `-o` releases the lock the moment the
// gated command starts. Measurement falsified it: the long-lived `flock` parent
// retains the lock for the wrapped command's whole run. #2346 then changed what
// the code does, so this pins BOTH halves: the falsified claim must not come
// back, and the measured lifetime must stay recorded.
describe('#2378 flock -o audit correction', () => {
  const audit = (): string =>
    readFileSync(resolve('docs/audit/e2e-campaign-2026-08/area4-results.md'), 'utf-8')

  it('allows the falsified caveat only as an immediately corrected historical note', () => {
    const falsifiedCaveat = 'the lock is released the moment the command _starts_'
    for (const occurrence of audit().matchAll(new RegExp(falsifiedCaveat, 'g'))) {
      expect(audit().slice(occurrence.index)).toMatch(
        new RegExp(
          `${falsifiedCaveat}[^\\n]*\\n\\s*\\*\\*CORRECTION \\(#2330\\):\\*\\* this caveat is wrong\\.`,
        ),
      )
    }
  })
})
