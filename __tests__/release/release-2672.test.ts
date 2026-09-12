// SPDX-License-Identifier: Apache-2.0
// #2672: the 0.6.0 release contract — the first tag-driven OIDC publish as @getarbiter/cli.
// The version, the changelog head and the consumed changesets are pinned together so the
// release commit is a verified change, not a bookkeeping edit (CONTRIBUTING: config-only floor).
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '../..')
const VERSION = '0.6.0'

describe('release 0.6.0 (#2672)', () => {
  it('package.json publishes @getarbiter/cli 0.6.0', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'))
    expect(pkg.name).toBe('@getarbiter/cli')
    expect(pkg.version).toBe(VERSION)
  })

  it('CHANGELOG.md leads with a dated, stable-channel 0.6.0 entry', () => {
    const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf-8')
    const first = changelog.match(
      /^## \[([^\]]+)\] — (\d{4}-\d{2}-\d{2})\n\n\*\*Channel:\*\* (\w+)/m,
    )
    expect(first?.[1]).toBe(VERSION)
    expect(first?.[3]).toBe('stable')
  })

  it('every changeset was consumed by the release', () => {
    const pending = readdirSync(join(root, '.changeset')).filter(
      (f) => f.endsWith('.md') && f !== 'README.md',
    )
    expect(pending).toEqual([])
  })
})
