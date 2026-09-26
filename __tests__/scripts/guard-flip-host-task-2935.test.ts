// SPDX-License-Identifier: Apache-2.0
// #2935: the 'refutation-verdicts' flip fixture must discriminate whatever task the HOST
// checkout has declared. check-refutation-verdicts.mjs defaults --repo-root to its own parent
// dir and reads <root>/.claude/.task/status.json; the fixture argv omits --repo-root, so a host
// with an active task makes the planted-BAD fixture pass vacuously. The host here is a tmp copy
// of the script, so the test never writes into the real tree (#2934).
import { afterAll, describe, expect, it } from 'vitest'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { flipGuard } from '../../scripts/check-guard-flip.mjs'
import { FLIP_REGISTRY } from '../../scripts/lib/guard-flip-registry.mjs'
import { CONTEXT_ROT_GATES } from '../../scripts/lib/anti-fake-green-guards.mjs'

const ROOT = resolve(__dirname, '..', '..')
const HOST = mkdtempSync(join(tmpdir(), 'guard-flip-host-2935-'))
afterAll(() => rmSync(HOST, { recursive: true, force: true }))

function hostWithDeclaredTask(): string {
  mkdirSync(join(HOST, 'scripts', 'lib'), { recursive: true })
  for (const f of ['check-refutation-verdicts.mjs', 'lib/gate-args.mjs'])
    copyFileSync(join(ROOT, 'scripts', f), join(HOST, 'scripts', f))
  mkdirSync(join(HOST, '.claude', '.task'), { recursive: true })
  writeFileSync(join(HOST, '.claude', '.task', 'status.json'), JSON.stringify({ taskId: '#9999' }))
  return join(HOST, 'scripts', 'check-refutation-verdicts.mjs')
}

describe('#2935 refutation-verdicts fixture ignores the host task context', () => {
  it('rejects the planted BAD fixture even when the host declares a task', () => {
    const guard = CONTEXT_ROT_GATES.find((g) => g.name === 'refutation-verdicts')
    expect(guard).toBeDefined()
    const failures = flipGuard(
      { ...guard, script: hostWithDeclaredTask() },
      FLIP_REGISTRY['refutation-verdicts'],
    )
    expect(failures).toEqual([])
  })
})
