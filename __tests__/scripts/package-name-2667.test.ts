// SPDX-License-Identifier: Apache-2.0
// #2667: the package is @getarbiter/cli (the @arbiter npm scope is not ours). The bin stays
// `arbiter`. Everything a consumer receives or reads must carry the publishable name; only
// historical records (evidence, changelogs) keep the old one.
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '../..')
const OLD = '@arbiter/cli'
const NEW = '@getarbiter/cli'
const HISTORICAL = [
  /^\.arbiter\/evidence\//,
  /^CHANGELOG\.md$/,
  /^website\/changelog\//,
  /^docs\/internal\/ADR\//,
  /^docs\/audit\//,
]

describe('package name (#2667)', () => {
  it('package.json publishes @getarbiter/cli with the arbiter bin', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'))
    expect(pkg.name).toBe(NEW)
    expect(Object.keys(pkg.bin)).toEqual(['arbiter'])
  })

  it('no non-historical tracked file still references the old scope', () => {
    const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf-8' })
      .split('\n')
      .filter(Boolean)
      .filter((f) => !HISTORICAL.some((re) => re.test(f)))
    const offenders = files.filter((f) => {
      try {
        return readFileSync(join(root, f), 'utf-8').includes(OLD)
      } catch {
        return false
      }
    })
    expect(offenders, offenders.slice(0, 20).join('\n')).toEqual([])
  })
})
