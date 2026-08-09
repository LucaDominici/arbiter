// SPDX-License-Identifier: Apache-2.0
// #2232 (wave-3 Group E) — TRACK_MODEL.md was folded into
// docs/internal/METHOD/PROCESS.md by #1242 and the template removed in wave-1
// (85b397ab); three dangles remained: the '# Tracks (TRACK_MODEL.md)' comment in
// .github/labels.yml and its src/templates/github/labels.yml.ejs twin, plus the
// 'Location:' line in docs/internal/METHOD/PROCESS.md:27. These assertions pin
// their absence so the dangle cannot regress.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve('.')
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf-8')

describe('#2232 — no TRACK_MODEL dangles', () => {
  it('.github/labels.yml does not cite TRACK_MODEL.md', () => {
    expect(read('.github/labels.yml')).not.toContain('TRACK_MODEL')
  })

  it('src/templates/github/labels.yml.ejs twin does not cite TRACK_MODEL.md either', () => {
    expect(read('src/templates/github/labels.yml.ejs')).not.toContain('TRACK_MODEL')
  })

  it('docs/internal/METHOD/PROCESS.md no longer dangles the TRACK_MODEL.md Location line', () => {
    expect(read('docs/internal/METHOD/PROCESS.md')).not.toContain('TRACK_MODEL.md')
  })
})
