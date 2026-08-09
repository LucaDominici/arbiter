// #2265 — the gradle-action 6.3.0 sync (dependabot 027c1371) must land in the
// CROSS_MAJOR_ALLOWLIST dual-track; a stale v6.2.0-only allowlist reds the pin
// check on every synced workflow (main run 31304129989).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '../..')
const V630_SHA = '9c971963bec38e04b3d30dcc455b5382be2fdbfb'

describe('#2265 gradle-action 6.3.0 allowlist (dual-track)', () => {
  it('script allowlist carries the v6.3.0 sha', () => {
    const s = readFileSync(resolve(ROOT, 'scripts/check-action-pins.mjs'), 'utf8')
    expect(s).toContain(V630_SHA)
  })
  it('ejs twin carries the v6.3.0 sha', () => {
    const s = readFileSync(resolve(ROOT, 'src/templates/scripts/check-action-pins.mjs.ejs'), 'utf8')
    expect(s).toContain(V630_SHA)
  })
})
