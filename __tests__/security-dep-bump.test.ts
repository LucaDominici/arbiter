import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
describe('#976 security dep bump', () => {
  it('fixture fastify is at safe version', () => {
    const pkg = JSON.parse(
      readFileSync('__tests__/fixtures/real-projects/ts-backend-web-db/package.json', 'utf-8'),
    )
    expect(pkg.dependencies.fastify).toMatch(/^\^?4\.(29|3[0-9])\./)
  })
})
