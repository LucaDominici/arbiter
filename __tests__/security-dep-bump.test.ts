import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
describe('#976 security dep bump', () => {
  it('fixture fastify is at safe version', () => {
    const pkg = JSON.parse(
      readFileSync('__tests__/fixtures/real-projects/ts-backend-web-db/package.json', 'utf-8'),
    )
    // Dependabot alerts #1/#2/#3 (GHSA fastify HIGH/MODERATE/LOW) required a major
    // bump 4.x -> 5.x; patched floor is 5.8.3 (see PR "drain dependabot alerts").
    const version = String(pkg.dependencies.fastify).replace(/^[\^~]/, '')
    const [major, minor, patch] = version.split('.').map(Number)
    expect(major).toBe(5)
    expect(minor > 8 || (minor === 8 && patch >= 3)).toBe(true)
  })
})
