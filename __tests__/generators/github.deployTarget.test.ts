// Tests for deployTarget-dispatched workflow content (#1005 PR-B).
// AWS-ECS + GCP-Cloud-Run tests are in github.deployTarget-cloud.test.ts (checkpoint 3).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateGithub } from '../../src/generators/github.js'
import { makeConfig } from '../helpers.js'

describe('generateGithub — deployTarget dispatch (#1005)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-deploy-target-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('deployTarget ghcr emits deploy workflows', () => {
    generateGithub(makeConfig(dir, { deployTarget: 'ghcr', archetype: 'backend-web-db' }))
    const wfDir = join(dir, '.github', 'workflows')
    expect(existsSync(join(wfDir, '04-deploy-test.yml'))).toBe(true)
    expect(existsSync(join(wfDir, '10-deploy-prod.yml'))).toBe(true)
  })

  it('deployTarget none does NOT emit deploy workflows', () => {
    generateGithub(makeConfig(dir, { deployTarget: 'none', archetype: 'library' }))
    const wfDir = join(dir, '.github', 'workflows')
    expect(existsSync(join(wfDir, '04-deploy-test.yml'))).toBe(false)
    expect(existsSync(join(wfDir, '10-deploy-prod.yml'))).toBe(false)
  })

  it('undefined deployTarget does NOT emit deploy workflows', () => {
    generateGithub(makeConfig(dir, { archetype: 'library' }))
    const wfDir = join(dir, '.github', 'workflows')
    expect(existsSync(join(wfDir, '04-deploy-test.yml'))).toBe(false)
    expect(existsSync(join(wfDir, '10-deploy-prod.yml'))).toBe(false)
  })

  it('04-deploy-test.yml with ghcr contains ghcr.io push reference', () => {
    generateGithub(makeConfig(dir, { deployTarget: 'ghcr', archetype: 'backend-web-db' }))
    const content = readFileSync(join(dir, '.github', 'workflows', '04-deploy-test.yml'), 'utf-8')
    expect(content).toContain('ghcr.io')
  })

  it('04-deploy-test.yml with ghcr does not contain PLACEHOLDER- strings', () => {
    generateGithub(makeConfig(dir, { deployTarget: 'ghcr', archetype: 'backend-web-db' }))
    const content = readFileSync(join(dir, '.github', 'workflows', '04-deploy-test.yml'), 'utf-8')
    expect(content).not.toContain('PLACEHOLDER-')
  })

  it('10-deploy-prod.yml with ghcr contains cosign copy', () => {
    generateGithub(
      makeConfig(dir, {
        deployTarget: 'ghcr',
        archetype: 'backend-web-db',
        githubOwner: 'acme',
        githubRepo: 'my-service',
      }),
    )
    const content = readFileSync(join(dir, '.github', 'workflows', '10-deploy-prod.yml'), 'utf-8')
    expect(content).toContain('cosign copy')
  })

  it('10-deploy-prod.yml with ghcr contains cosign verify with owner/repo regexp', () => {
    generateGithub(
      makeConfig(dir, {
        deployTarget: 'ghcr',
        archetype: 'backend-web-db',
        githubOwner: 'acme',
        githubRepo: 'my-service',
      }),
    )
    const content = readFileSync(join(dir, '.github', 'workflows', '10-deploy-prod.yml'), 'utf-8')
    expect(content).toContain('cosign verify')
    expect(content).toContain('--certificate-identity-regexp')
    expect(content).toContain('--certificate-oidc-issuer')
    expect(content).toMatch(/https:\/\/github\\\.com\/acme\/my-service\//)
  })

  it('10-deploy-prod.yml with azure-container-app contains cosign copy and ACR auth', () => {
    generateGithub(
      makeConfig(dir, {
        deployTarget: 'azure-container-app',
        archetype: 'backend-web-db',
        githubOwner: 'acme',
        githubRepo: 'my-service',
      }),
    )
    const content = readFileSync(join(dir, '.github', 'workflows', '10-deploy-prod.yml'), 'utf-8')
    expect(content).toContain('cosign copy')
    expect(content).toContain('cosign verify')
    expect(content).toContain('az acr login')
  })
})
