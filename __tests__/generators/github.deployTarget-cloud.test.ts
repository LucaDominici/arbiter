// SPDX-License-Identifier: Apache-2.0
// Tests for AWS ECS + GCP Cloud Run deployTarget dispatch (#1005 PR-B checkpoint 3).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateGithub } from '../../src/generators/github.js'
import { makeConfig } from '../helpers.js'

describe('generateGithub — aws-ecs deployTarget (#1005)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-aws-ecs-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('aws-ecs emits 04-deploy-test.yml and 10-deploy-prod.yml', () => {
    generateGithub(makeConfig(dir, { deployTarget: 'aws-ecs', archetype: 'backend-web-db' }))
    const wfDir = join(dir, '.github', 'workflows')
    expect(existsSync(join(wfDir, '04-deploy-test.yml'))).toBe(true)
    expect(existsSync(join(wfDir, '10-deploy-prod.yml'))).toBe(true)
  })

  it('04-deploy-test.yml with aws-ecs contains ECS update-service', () => {
    generateGithub(makeConfig(dir, { deployTarget: 'aws-ecs', archetype: 'backend-web-db' }))
    const content = readFileSync(join(dir, '.github', 'workflows', '04-deploy-test.yml'), 'utf-8')
    expect(content).toContain('ecs update-service')
  })

  it('04-deploy-test.yml with aws-ecs contains configure-aws-credentials OIDC action', () => {
    generateGithub(makeConfig(dir, { deployTarget: 'aws-ecs', archetype: 'backend-web-db' }))
    const content = readFileSync(join(dir, '.github', 'workflows', '04-deploy-test.yml'), 'utf-8')
    expect(content).toContain('configure-aws-credentials')
  })

  it('10-deploy-prod.yml with aws-ecs contains cosign copy', () => {
    generateGithub(
      makeConfig(dir, {
        deployTarget: 'aws-ecs',
        archetype: 'backend-web-db',
        githubOwner: 'acme',
        githubRepo: 'my-service',
      }),
    )
    const content = readFileSync(join(dir, '.github', 'workflows', '10-deploy-prod.yml'), 'utf-8')
    expect(content).toContain('cosign copy')
  })

  it('10-deploy-prod.yml with aws-ecs contains cosign verify with owner/repo regexp', () => {
    generateGithub(
      makeConfig(dir, {
        deployTarget: 'aws-ecs',
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

  it('10-deploy-prod.yml with aws-ecs contains ECR describe-images for digest resolution', () => {
    generateGithub(
      makeConfig(dir, {
        deployTarget: 'aws-ecs',
        archetype: 'backend-web-db',
      }),
    )
    const content = readFileSync(join(dir, '.github', 'workflows', '10-deploy-prod.yml'), 'utf-8')
    expect(content).toContain('ecr describe-images')
  })
})

describe('generateGithub — gcp-cloud-run deployTarget (#1005)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-gcp-cloud-run-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('gcp-cloud-run emits 04-deploy-test.yml and 10-deploy-prod.yml', () => {
    generateGithub(makeConfig(dir, { deployTarget: 'gcp-cloud-run', archetype: 'backend-web-db' }))
    const wfDir = join(dir, '.github', 'workflows')
    expect(existsSync(join(wfDir, '04-deploy-test.yml'))).toBe(true)
    expect(existsSync(join(wfDir, '10-deploy-prod.yml'))).toBe(true)
  })

  it('04-deploy-test.yml with gcp-cloud-run contains gcloud run services update', () => {
    generateGithub(makeConfig(dir, { deployTarget: 'gcp-cloud-run', archetype: 'backend-web-db' }))
    const content = readFileSync(join(dir, '.github', 'workflows', '04-deploy-test.yml'), 'utf-8')
    expect(content).toContain('gcloud run services update')
  })

  it('04-deploy-test.yml with gcp-cloud-run contains google-github-actions/auth action', () => {
    generateGithub(makeConfig(dir, { deployTarget: 'gcp-cloud-run', archetype: 'backend-web-db' }))
    const content = readFileSync(join(dir, '.github', 'workflows', '04-deploy-test.yml'), 'utf-8')
    expect(content).toContain('google-github-actions/auth')
  })

  it('10-deploy-prod.yml with gcp-cloud-run contains cosign copy', () => {
    generateGithub(
      makeConfig(dir, {
        deployTarget: 'gcp-cloud-run',
        archetype: 'backend-web-db',
        githubOwner: 'acme',
        githubRepo: 'my-service',
      }),
    )
    const content = readFileSync(join(dir, '.github', 'workflows', '10-deploy-prod.yml'), 'utf-8')
    expect(content).toContain('cosign copy')
  })

  it('10-deploy-prod.yml with gcp-cloud-run contains cosign verify with owner/repo regexp', () => {
    generateGithub(
      makeConfig(dir, {
        deployTarget: 'gcp-cloud-run',
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

  it('10-deploy-prod.yml with gcp-cloud-run contains GAR gcloud container images describe', () => {
    generateGithub(
      makeConfig(dir, {
        deployTarget: 'gcp-cloud-run',
        archetype: 'backend-web-db',
      }),
    )
    const content = readFileSync(join(dir, '.github', 'workflows', '10-deploy-prod.yml'), 'utf-8')
    expect(content).toContain('gcloud container images describe')
  })
})
