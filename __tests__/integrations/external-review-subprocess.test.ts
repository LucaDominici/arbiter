// SPDX-License-Identifier: Apache-2.0
// #2357 — exercise the real runCli boundary with a PATH stub, never a Codex installation.
// #2431 — and never on an idle-host wall-clock literal: `cfg.timeoutMs` is the budget every
// child the seat spawns must finish inside, so it is derived from the vitest pool size.
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
import {
  externalSeatHarnessTimeoutMs,
  externalSeatTimeoutMs,
} from '../helpers/external-seat-budget.js'

/** One external-review request, so the fixture below varies only what it is testing. */
function reviewRequest(overrides: {
  taskId: string
  timeoutMs: number
  evidenceDir: string
  env: NodeJS.ProcessEnv
  /** Set to keep the dispatch artifact out of the checkout; omit to exercise the repo-root
   *  default path (and the `assertSafeArbiterEvidenceRoot` guard that comes with it). */
  dispatchEvidenceDir?: string
}): Parameters<typeof invokeExternalReview>[0] {
  return {
    repoRoot: process.cwd(),
    taskId: overrides.taskId,
    prompt: 'Review the change.',
    diff: 'diff --git a/a b/a',
    cfg: {
      ...DEFAULT_CROSS_MODEL_REVIEW,
      enabled: true,
      diffEgressConsent: true,
      timeoutMs: overrides.timeoutMs,
    },
    access: {
      provider: 'codex',
      vendor: 'openai',
      available: true,
      authenticated: true,
      version: '1.2.3',
      error: null,
    },
    evidenceDir: overrides.evidenceDir,
    env: overrides.env,
    ...(overrides.dispatchEvidenceDir !== undefined
      ? { dispatchEvidenceDir: overrides.dispatchEvidenceDir }
      : {}),
  }
}

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
# #2431: drain stdin to EOF before doing anything else — the seat writes the prompt there,
# and exiting without reading it makes that write race this process's exit and return EPIPE.
cat > "$(dirname "$0")/../codex-stdin.txt"
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

  it(
    'runs a PATH stub and records the validated envelope, excluding raw stdout (AC-10)',
    () => {
      const result = invokeExternalReview(
        reviewRequest({
          taskId: '#2357',
          timeoutMs: externalSeatTimeoutMs(),
          evidenceDir,
          env: reviewEnv,
        }),
      )

      expect(result.status, result.degradationReasons.join(',')).toBe('fulfilled')
      expect(result.recorded).toBe(true)
      // #2431: the seat feeds the prompt on the CLI's stdin. A stub that exits without
      // reading it leaves the parent writing into a pipe whose read end is already gone,
      // and `spawnSync` returns EPIPE — a start failure `runCli` reports as a fatal
      // "Codex exited with status -1", which degrades the seat. It is a race the host's
      // scheduler decides: 287 of 1500 invocations EPIPE'd at load ~100, 0 of 1500 once
      // the stub consumed its stdin. Asserting the prompt ARRIVED is what keeps the stub
      // draining it, and it is the contract the fixture should have been proving anyway.
      expect(readFileSync(join(fixture, 'codex-stdin.txt'), 'utf-8')).toContain(
        '--- BEGIN DIFF ---',
      )
      const taskDir = join(evidenceDir, '_2357')
      const files = readdirSync(taskDir)
      expect(files).toHaveLength(1)
      expect(readFileSync(join(taskDir, files[0]!), 'utf-8')).not.toContain(
        'raw stdout must never become evidence',
      )
      expect(readFileSync(join(fixture, 'codex-scope.txt'), 'utf-8')).toBe('scratch-only\n')
    },
    externalSeatHarnessTimeoutMs(),
  )

  // #2431 — the flake itself needs a ~24-way loaded host; its MECHANISM does not. A seat
  // that answers slower than its budget degrades, and that is the whole bug: `degraded` is
  // never the contract, so the budget — not the assertion — is what has to move. Both arms
  // drive the SAME stub through the SAME code path, varying only the pool size the budget
  // is derived from. A small `baseMs` keeps the arms at seconds instead of minutes.
  it(
    'degrades a slow seat on a solo-pool budget and fulfils it once the pool scales it (AC-1)',
    () => {
      const slowBin = join(fixture, 'slow-bin')
      mkdirSync(slowBin, { recursive: true })
      const slowCodex = join(slowBin, 'codex')
      writeFileSync(
        slowCodex,
        `#!/bin/sh
# Drains stdin for the same reason as the fast stub above (#2431) — this one is only slow,
# not careless.
cat > "$(dirname "$0")/../slow-codex-stdin.txt"
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then out="$2"; shift 2; else shift; fi
done
sleep 2
printf '%s\\n' '{"verdict":"PASS","confidence":0.8,"findings":[],"refutations":[]}' > "$out"
`,
        'utf-8',
      )
      chmodSync(slowCodex, 0o755)
      const slowEnv = { ...reviewEnv, PATH: `${slowBin}:${process.env.PATH ?? ''}` }
      const budget = { baseMs: 3_000, env: {} }

      // A one-worker pool buys the seat 1 s — less than the 2 s it needs. This IS the
      // reported failure, made deterministic instead of load-dependent.
      const starved = invokeExternalReview(
        reviewRequest({
          taskId: '#2431',
          timeoutMs: externalSeatTimeoutMs({ ...budget, parallelism: 2 }),
          evidenceDir: join(fixture, 'evidence-starved'),
          dispatchEvidenceDir: join(fixture, 'dispatch-starved'),
          env: slowEnv,
        }),
      )
      expect(starved.status, starved.degradationReasons.join(',')).toBe('degraded')
      expect(starved.degradationReasons).toContain('invocation-failed')

      // The same seat, the same stub, an eight-worker pool: the budget scales past what
      // the seat costs and the contract holds.
      const scaled = invokeExternalReview(
        reviewRequest({
          taskId: '#2431',
          timeoutMs: externalSeatTimeoutMs({ ...budget, parallelism: 9 }),
          evidenceDir: join(fixture, 'evidence-scaled'),
          dispatchEvidenceDir: join(fixture, 'dispatch-scaled'),
          env: slowEnv,
        }),
      )
      expect(scaled.status, scaled.degradationReasons.join(',')).toBe('fulfilled')
      expect(scaled.recorded).toBe(true)
    },
    externalSeatHarnessTimeoutMs(),
  )
})
