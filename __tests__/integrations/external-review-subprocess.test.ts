// SPDX-License-Identifier: Apache-2.0
// #2357 — exercise the real runCli boundary with a PATH stub, never a Codex installation.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CROSS_MODEL_REVIEW } from '../../src/config/schema.js'
import { invokeExternalReview } from '../../src/integrations/external-review.js'

describe('external review subprocess boundary (#2357)', () => {
  let fixture: string
  let evidenceDir: string
  let reviewEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    fixture = mkdtempSync(join(tmpdir(), 'arbiter-cross-model-codex-'))
    evidenceDir = join(fixture, 'evidence')
    const bin = join(fixture, 'bin')
    const codex = join(bin, 'codex')
    mkdirSync(bin, { recursive: true })
    writeFileSync(
      codex,
      `#!/bin/sh
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then out="$2"; shift 2; else shift; fi
done
scope="$(dirname "$0")/../codex-scope.txt"
if [ -e package.json ]; then printf '%s\n' 'repo-visible' > "$scope"; else printf '%s\n' 'scratch-only' > "$scope"; fi
if [ "\${OPENAI_API_KEY:-}" = 'sentinel-secret' ]; then printf '%s\n' 'api-key-forwarded' > "$scope"; fi
printf '%s\\n' 'raw stdout must never become evidence'
printf '%s\\n' '{"verdict":"PASS","confidence":0.8,"findings":[],"refutations":[]}' > "$out"
`,
      'utf-8',
    )
    chmodSync(codex, 0o755)
    reviewEnv = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      OPENAI_API_KEY: 'sentinel-secret',
    }
  })

  afterEach(() => {
    rmSync(fixture, { recursive: true, force: true })
  })

  it('runs a PATH stub and records the validated envelope, excluding raw stdout (AC-10)', () => {
    const result = invokeExternalReview({
      repoRoot: process.cwd(),
      taskId: '#2357',
      prompt: 'Review the change.',
      diff: 'diff --git a/a b/a',
      cfg: {
        ...DEFAULT_CROSS_MODEL_REVIEW,
        enabled: true,
        diffEgressConsent: true,
      },
      access: {
        provider: 'codex',
        vendor: 'openai',
        available: true,
        authenticated: true,
        version: '1.2.3',
        error: null,
      },
      evidenceDir,
      env: reviewEnv,
    })

    expect(result.status).toBe('fulfilled')
    expect(result.recorded).toBe(true)
    const taskDir = join(evidenceDir, '_2357')
    const files = readdirSync(taskDir)
    expect(files).toHaveLength(1)
    expect(readFileSync(join(taskDir, files[0]!), 'utf-8')).not.toContain(
      'raw stdout must never become evidence',
    )
    expect(readFileSync(join(fixture, 'codex-scope.txt'), 'utf-8')).toBe('scratch-only\n')
  })

  // #2501 — the degrade-on-timeout path used to be exercised only incidentally, by
  // racing a real host against a tight fixture timeoutMs (flaky under parallel load:
  // https://github.com/LucaDominici/arbiter/issues/2501). This test asserts the same
  // contract deterministically: the stub seat is made to sleep for far longer than a
  // tiny configured timeoutMs, so the kill always fires well before the seat could
  // ever finish, on any host — no race, no wall-clock dependence in either direction.
  it('degrades deterministically when the seat exceeds an injected timeout (#2501)', () => {
    const codex = join(fixture, 'bin', 'codex')
    writeFileSync(
      codex,
      `#!/bin/sh
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then out="$2"; shift 2; else shift; fi
done
sleep 5
printf '%s\\n' '{"verdict":"PASS","confidence":0.8,"findings":[],"refutations":[]}' > "$out"
`,
      'utf-8',
    )
    chmodSync(codex, 0o755)

    const dispatchEvidenceDir = join(fixture, 'dispatch')
    const result = invokeExternalReview({
      repoRoot: process.cwd(),
      taskId: '#2501',
      prompt: 'Review the change.',
      diff: 'diff --git a/a b/a',
      cfg: {
        ...DEFAULT_CROSS_MODEL_REVIEW,
        enabled: true,
        diffEgressConsent: true,
        // Deliberately far shorter than the seat's `sleep 5` above — the assertion is
        // "a genuinely slow seat degrades", never "the host answered inside N ms".
        timeoutMs: 200,
      },
      access: {
        provider: 'codex',
        vendor: 'openai',
        available: true,
        authenticated: true,
        version: '1.2.3',
        error: null,
      },
      evidenceDir,
      dispatchEvidenceDir,
      tier: 'Standard',
      phase: 'refactor',
      env: reviewEnv,
    })

    expect(result.status).toBe('degraded')
    expect(result.degradationReason).toBe('invocation-failed')
    const dispatch = JSON.parse(
      readFileSync(join(dispatchEvidenceDir, '_2501', 'dispatch.json'), 'utf-8'),
    ) as { degraded: Array<{ reason: string; substitute: string }> }
    expect(dispatch.degraded).toHaveLength(1)
    expect(dispatch.degraded[0]).toMatchObject({ reason: 'timeout', substitute: 'anthropic' })
  })
})
