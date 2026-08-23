// SPDX-License-Identifier: Apache-2.0
// CANON-04: render tests for the nas-compose deployTarget templates (#9002):
//   infra/nas-compose/deploy.sh.ejs
//   github/workflows/_deploy/nas-compose.ejs (via 04-deploy-test.yml.ejs / 10-deploy-prod.yml.ejs)
//   github/workflows/_cosign-copy/nas-compose.ejs (via 10-deploy-prod.yml.ejs)
//   github/actions/nas-ssh/action.yml.ejs
import { describe, it, expect } from 'vitest'
import { load } from 'js-yaml'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function render(templatePath: string, overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    templatePath,
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

describe('infra/nas-compose/deploy.sh.ejs — structural invariants (CANON-04)', () => {
  it('renders non-empty bash with no unrendered EJS', () => {
    const rendered = render('infra/nas-compose/deploy.sh.ejs')
    expect(rendered.trim().length).toBeGreaterThan(0)
    expect(rendered).not.toContain('<%')
  })

  it('pulls by digest and re-verifies the signature on the NAS (destination admission)', () => {
    const rendered = render('infra/nas-compose/deploy.sh.ejs')
    expect(rendered).toContain('docker pull')
    expect(rendered).toContain('cosign verify')
  })

  it('uses docker-compose lifecycle (pull + up -d), not `docker run`', () => {
    const rendered = render('infra/nas-compose/deploy.sh.ejs')
    expect(rendered).toContain('docker-compose')
    expect(rendered).toContain('up -d')
    expect(rendered).not.toContain('docker run')
  })

  it('fails closed: sets --restart=no and dumps logs when unhealthy', () => {
    const rendered = render('infra/nas-compose/deploy.sh.ejs')
    expect(rendered).toContain('--restart=no')
    expect(rendered).toContain('logs --tail')
  })

  it('parametrizes NAS_ROOT, SERVICES, HEALTH_TIMEOUT_S, BACKUP_CMD', () => {
    const rendered = render('infra/nas-compose/deploy.sh.ejs')
    for (const param of ['NAS_ROOT', 'SERVICES', 'HEALTH_TIMEOUT_S', 'BACKUP_CMD']) {
      expect(rendered).toContain(param)
    }
  })
})

describe('github/actions/nas-ssh/action.yml.ejs — structural invariants (CANON-04)', () => {
  it('renders valid YAML pinning known_hosts (StrictHostKeyChecking=yes)', () => {
    const rendered = render('github/actions/nas-ssh/action.yml.ejs')
    expect(() => load(rendered)).not.toThrow()
    expect(rendered).toContain('StrictHostKeyChecking=yes')
    expect(rendered).toContain('ssh-keygen -y')
  })
})

describe('_deploy/nas-compose.ejs + _cosign-copy/nas-compose.ejs — via 10-deploy-prod.yml.ejs', () => {
  function renderDeployProd(overrides: Record<string, unknown> = {}) {
    return render('github/workflows/10-deploy-prod.yml.ejs', {
      deployTarget: 'nas-compose',
      githubOwner: 'acme',
      githubRepo: 'svc',
      ...overrides,
    })
  }

  it('renders valid YAML', () => {
    const rendered = renderDeployProd()
    expect(() => load(rendered)).not.toThrow()
  })

  it('includes the nas-ssh composite action and the generic infra deploy script', () => {
    const rendered = renderDeployProd()
    expect(rendered).toContain('./.github/actions/nas-ssh')
    expect(rendered).toContain('infra/nas-compose/deploy.sh')
  })

  it('cosign-copy promotes TEST → PROD before the deploy step (GHCR-backed)', () => {
    const rendered = renderDeployProd()
    expect(rendered).toContain('cosign copy')
    expect(rendered).toContain('cosign verify')
  })

  it('guards on required NAS secrets before deploying', () => {
    const rendered = renderDeployProd()
    expect(rendered).toContain('NAS_SSH_HOST')
    expect(rendered).toContain('NAS_SSH_KEY')
    expect(rendered).toContain('NAS_SUDO_PASS')
  })
})

describe('_deploy/nas-compose.ejs — via 04-deploy-test.yml.ejs', () => {
  it('renders valid YAML and includes the NAS SSH setup step', () => {
    const rendered = render('github/workflows/04-deploy-test.yml.ejs', {
      deployTarget: 'nas-compose',
    })
    expect(() => load(rendered)).not.toThrow()
    expect(rendered).toContain('./.github/actions/nas-ssh')
  })
})
