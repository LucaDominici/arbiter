// SPDX-License-Identifier: Apache-2.0
// #2357 — exercise the real runCli boundary with a PATH stub, never a Codex installation.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
printf '%s\\n' 'raw stdout must never become evidence'
printf '%s\\n' '{"verdict":"PASS","confidence":0.8,"findings":[],"refutations":[]}' > "$out"
`,
      'utf-8',
    )
    chmodSync(codex, 0o755)
    vi.stubEnv('PATH', `${bin}:${process.env.PATH ?? ''}`)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
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
    })

    expect(result.status).toBe('fulfilled')
    expect(result.recorded).toBe(true)
    const taskDir = join(evidenceDir, '_2357')
    const files = readdirSync(taskDir)
    expect(files).toHaveLength(1)
    expect(readFileSync(join(taskDir, files[0]!), 'utf-8')).not.toContain(
      'raw stdout must never become evidence',
    )
  })
})
