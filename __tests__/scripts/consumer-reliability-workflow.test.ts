import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import YAML from 'yaml'

const WORKFLOW = resolve('.github/workflows/consumer-reliability.yml')

describe('consumer reliability workflow (#2135)', () => {
  it('AC-6 runs the private bar only from trusted main/manual code', () => {
    const raw = readFileSync(WORKFLOW, 'utf-8')
    const parsed = YAML.parse(raw)
    expect(parsed.on).toHaveProperty('push')
    expect(parsed.on.push.branches).toEqual(['main'])
    expect(parsed.on).toHaveProperty('workflow_dispatch')
    expect(parsed.on).not.toHaveProperty('pull_request')
    expect(raw).not.toContain('pull_request_target')
    expect(parsed.jobs.consumer_reliability.if).toBe("github.ref == 'refs/heads/main'")
    const checkout = parsed.jobs.consumer_reliability.steps[0]
    expect(checkout.with.ref).toBe('main')
    expect(checkout.with['persist-credentials']).toBe(false)
  })

  it('AC-1/AC-5 invokes the single wrapper that scrubs the verifier child', () => {
    const raw = readFileSync(WORKFLOW, 'utf-8')
    const parsed = YAML.parse(raw)
    const steps = parsed.jobs.consumer_reliability.steps as Array<Record<string, unknown>>
    const bar = steps.find((step) => step.id === 'consumer_bar')
    expect(Object.keys((bar?.env ?? {}) as object)).toEqual(
      expect.arrayContaining([
        'ARBITER_CONSUMER_GO_REPO',
        'ARBITER_CONSUMER_GO_DEPLOY_KEY',
        'ARBITER_CONSUMER_TYPESCRIPT_REPO',
        'ARBITER_CONSUMER_TYPESCRIPT_DEPLOY_KEY',
        'ARBITER_CONSUMER_JAVA_REPO',
        'ARBITER_CONSUMER_JAVA_DEPLOY_KEY',
      ]),
    )
    expect(Object.keys((bar?.env ?? {}) as object)).not.toContain('ARBITER_CONSUMER_REPOS_TOKEN')
    expect(String(bar?.run)).toContain('npm run test:consumer-reliability --')
    const wrapper = readFileSync(resolve('scripts/run-consumer-reliability.mjs'), 'utf-8')
    expect(wrapper).toContain('env: buildVerifierEnvironment(process.env)')
    expect(wrapper.indexOf('const prepare = spawnSync(')).toBeLessThan(
      wrapper.indexOf('const verify = spawnSync('),
    )
  })

  it('AC-6 pins every third-party action and uses .nvmrc', () => {
    const raw = readFileSync(WORKFLOW, 'utf-8')
    const parsed = YAML.parse(raw)
    const uses = [...raw.matchAll(/uses:\s*([^@\s]+)@([^\s#]+)/g)]
    expect(uses.length).toBeGreaterThan(0)
    for (const match of uses) expect(match[2]).toMatch(/^[0-9a-f]{40}$/)
    expect(raw).toContain('node-version-file: .nvmrc')
    expect(parsed.on.push.paths).toEqual(expect.arrayContaining(['.nvmrc', 'tsconfig.json']))
    expect(raw).not.toContain('continue-on-error')
  })
})
