// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const WORKFLOW_DIR = '.github/workflows'

function collectWorkflowReferences(): Array<{ file: string; ref: string }> {
  const out: Array<{ file: string; ref: string }> = []
  const pattern = /--workflow[= ]+["']?([A-Za-z0-9_\-./]+\.ya?ml)["']?/g
  for (const entry of readdirSync(WORKFLOW_DIR)) {
    if (!entry.endsWith('.yml') && !entry.endsWith('.yaml')) continue
    const body = readFileSync(join(WORKFLOW_DIR, entry), 'utf-8')
    for (const match of body.matchAll(pattern)) {
      const ref = match[1]
      if (!ref) continue
      out.push({ file: entry, ref })
    }
  }
  return out
}

describe('workflow references — gh run list --workflow=<file> targets exist', () => {
  it('every referenced workflow file exists in .github/workflows/', () => {
    const refs = collectWorkflowReferences()
    const missing = refs.filter(({ ref }) => !existsSync(join(WORKFLOW_DIR, ref)))
    expect(missing).toEqual([])
  })
})
