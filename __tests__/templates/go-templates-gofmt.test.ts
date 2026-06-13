// SPDX-License-Identifier: Apache-2.0
// #1361: plain-Go templates (no EJS tags) must be gofmt-stable, so a fresh
// `arbiter init --language go` produces a gofmt-clean tree that passes its own gate.
// Guarded: skips when `gofmt` is not on PATH (e.g. CI without the Go toolchain).
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const TEMPLATES_DIR = join(import.meta.dirname, '..', '..', 'src', 'templates')

function gofmtAvailable(): boolean {
  const r = spawnSync('gofmt', ['-h'], { encoding: 'utf-8' })
  return !(r.error as NodeJS.ErrnoException | undefined)
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry.endsWith('.go.ejs')) out.push(full)
  }
}

describe('plain-Go templates are gofmt-stable (#1361)', () => {
  const all: string[] = []
  walk(TEMPLATES_DIR, all)
  // Only templates that are plain Go (no EJS tags) can be gofmt'd as-is.
  const plainGo = all.filter((f) => !readFileSync(f, 'utf-8').includes('<%'))

  it.skipIf(!gofmtAvailable())('every plain-Go template renders gofmt-clean', () => {
    const dirty: string[] = []
    for (const f of plainGo) {
      const src = readFileSync(f, 'utf-8')
      const r = spawnSync('gofmt', [], { input: src, encoding: 'utf-8' })
      if (r.status === 0 && r.stdout !== src) dirty.push(f)
    }
    expect(dirty, `gofmt-dirty templates:\n${dirty.join('\n')}`).toEqual([])
  })
})
