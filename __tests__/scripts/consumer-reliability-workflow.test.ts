import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import YAML from 'yaml'

const WORKFLOW = resolve('.github/workflows/consumer-reliability.yml')

interface WorkflowStep {
  run?: string
  uses?: string
  with?: Record<string, string>
}

describe('consumer reliability workflow (#2135, #2679)', () => {
  it('AC-6 runs the private bar only from trusted main/manual code', () => {
    const raw = readFileSync(WORKFLOW, 'utf-8')
    const parsed = YAML.parse(raw)
    expect(parsed.on).toHaveProperty('push')
    expect(parsed.on.push.branches).toEqual(['main'])
    expect(parsed.on).toHaveProperty('workflow_dispatch')
    expect(parsed.on).not.toHaveProperty('pull_request')
    expect(raw).not.toContain('pull_request_target')
    expect(parsed.jobs.prepare.if).toBe("github.ref == 'refs/heads/main'")
    expect(parsed.jobs.verify.if).toBe("github.ref == 'refs/heads/main'")
    for (const job of [parsed.jobs.prepare, parsed.jobs.verify]) {
      const checkout = job.steps[0]
      // Queued main pushes must qualify the commit named by this run, even if main moves.
      expect(checkout.with.ref).toBe('${{ github.sha }}')
      expect(checkout.with['persist-credentials']).toBe(false)
    }
  })

  // #2679: prepare/verify must be two SEPARATE jobs (two separate runners/processes), not
  // two spawnSync children of one credentialed Node process — the only real boundary
  // against same-UID consumer code reading the parent's environment.
  it('#2679 splits prepare (credentialed) from verify (credential-free) into two jobs', () => {
    const raw = readFileSync(WORKFLOW, 'utf-8')
    const parsed = YAML.parse(raw)
    expect(Object.keys(parsed.jobs).sort()).toEqual(['prepare', 'verify'])
    expect(parsed.jobs.verify.needs).toBe('prepare')

    const prepareEnv = Object.keys(
      (parsed.jobs.prepare.steps.find((step: Record<string, unknown>) => step.env)?.env ??
        {}) as object,
    )
    expect(prepareEnv).toEqual(
      expect.arrayContaining([
        'ARBITER_CONSUMER_GO_REPO',
        'ARBITER_CONSUMER_GO_DEPLOY_KEY',
        'ARBITER_CONSUMER_TYPESCRIPT_REPO',
        'ARBITER_CONSUMER_TYPESCRIPT_DEPLOY_KEY',
        'ARBITER_CONSUMER_JAVA_REPO',
        'ARBITER_CONSUMER_JAVA_DEPLOY_KEY',
        'GH_TOKEN',
      ]),
    )
    expect(parsed.jobs.prepare.permissions.issues).toBe('read')

    // The verify job must be rendered with NO secrets/token reference and NO
    // ARBITER_CONSUMER_* env anywhere in its block — not merely absent from one step.
    const verifyBlock = raw.slice(raw.indexOf('\n  verify:'), raw.length)
    expect(verifyBlock).not.toMatch(/secrets\./)
    expect(verifyBlock).not.toMatch(/github\.token/)
    expect(verifyBlock).not.toMatch(/ARBITER_CONSUMER_/)
    expect(parsed.jobs.verify.permissions).toEqual({})

    const wrapper = readFileSync(resolve('scripts/consumer-reliability-bar.mjs'), 'utf-8')
    expect(wrapper).toContain('assertCredentialFreeEnvironment(process.env)')
  })

  // #2679 round 3: the real HOME can hold ~/.ssh and ~/.git-credentials. The verifier binary
  // self-remediates its own HOME regardless of caller, but the workflow overrides it too —
  // belt-and-suspenders — on the one step that runs consumer-controlled code.
  it('#2679 overrides HOME to an isolated directory for the verification step', () => {
    const raw = readFileSync(WORKFLOW, 'utf-8')
    const parsed = YAML.parse(raw)
    const verifySteps = parsed.jobs.verify.steps as WorkflowStep[]
    const barStep = verifySteps.find((step) =>
      String(step.run ?? '').includes('consumer-reliability-bar.mjs'),
    )
    const env = (barStep as unknown as { env?: Record<string, string> })?.env
    expect(env?.HOME).toBeDefined()
    expect(String(env?.HOME)).not.toBe('')

    const verifierSource = readFileSync(resolve('scripts/consumer-reliability-bar.mjs'), 'utf-8')
    expect(verifierSource).toContain('mkdtempSync')
    expect(verifierSource).toMatch(/buildVerifierEnvironment\(process\.env,\s*isolatedHome\)/)
  })

  it('#2679 prepare uploads a single tar artifact with no key material, verify downloads it', () => {
    const raw = readFileSync(WORKFLOW, 'utf-8')
    const parsed = YAML.parse(raw)
    const prepareSteps = parsed.jobs.prepare.steps as WorkflowStep[]
    const archiveStep = prepareSteps.find((step) => String(step.run ?? '').includes('-czf'))
    expect(archiveStep).toBeDefined()
    const uploadStep = prepareSteps.find((step) =>
      String(step.uses ?? '').includes('upload-artifact'),
    )
    expect(uploadStep?.with?.name).toBe('consumer-workspace')
    expect(String(uploadStep?.with?.path)).toMatch(/consumer-workspace\.tar\.gz$/)
    // Deploy keys are unlinked (prepare-consumer-reliability.mjs) before this archive step
    // runs and never live under the archived workspace directory at all.
    const prepareScript = readFileSync(resolve('scripts/prepare-consumer-reliability.mjs'), 'utf-8')
    expect(prepareScript).toContain('unlinkSync(keyPath)')

    const verifySteps = parsed.jobs.verify.steps as WorkflowStep[]
    const downloadStep = verifySteps.find((step) =>
      String(step.uses ?? '').includes('download-artifact'),
    )
    expect(downloadStep?.with?.name).toBe('consumer-workspace')
    const extractStep = verifySteps.find((step) => String(step.run ?? '').includes('-xzf'))
    expect(extractStep).toBeDefined()
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
