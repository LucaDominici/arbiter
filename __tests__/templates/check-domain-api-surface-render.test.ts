// SPDX-License-Identifier: Apache-2.0
// Render tests for check-domain-api-surface.mjs.ejs and domain-api-surface.json.ejs
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'

const STACKS = [
  {
    language: 'typescript' as const,
    archetype: 'backend-web-db' as const,
    governanceLevel: 'L2' as const,
  },
  {
    language: 'java' as const,
    archetype: 'backend-web-db' as const,
    governanceLevel: 'L2' as const,
  },
  {
    language: 'python' as const,
    archetype: 'backend-web-db' as const,
    governanceLevel: 'L2' as const,
  },
  {
    language: 'rust' as const,
    archetype: 'backend-web-db' as const,
    governanceLevel: 'L2' as const,
  },
  {
    language: 'kotlin' as const,
    archetype: 'backend-web-db' as const,
    governanceLevel: 'L2' as const,
  },
]

const BASE_DATA = {
  projectName: 'test-project',
  governanceLevel: 'L2' as const,
}

const CONSUMER_DATA = {
  ...BASE_DATA,
  language: 'typescript' as const,
  archetype: 'backend-web-db' as const,
}

let consumerDir: string | undefined

function writeConsumerFixture(): {
  checker: string
  manifest: string
  helper: string
} {
  const dir = (consumerDir = mkdtempSync(join(tmpdir(), 'domain-api-template-')))
  const scriptsDir = join(dir, 'scripts')
  mkdirSync(join(dir, 'src', 'server', 'routes'), { recursive: true })
  mkdirSync(scriptsDir, { recursive: true })
  symlinkSync(join(resolve('.'), 'node_modules'), join(dir, 'node_modules'), 'dir')
  const checker = join(scriptsDir, 'check-domain-api-surface.mjs')
  writeFileSync(checker, renderTemplate('scripts/check-domain-api-surface.mjs.ejs', CONSUMER_DATA))
  chmodSync(checker, 0o755)
  writeFileSync(
    join(dir, 'src', 'server', 'index.ts'),
    "import { widgets } from './routes/widgets'\napp.use('/api/widgets', widgets(\n",
  )
  writeFileSync(
    join(dir, 'src', 'server', 'routes', 'widgets.ts'),
    "router.get('/item', handler)\n",
  )
  const helper = join(scriptsDir, 'schema-helper.mjs')
  writeFileSync(helper, "process.stdout.write(JSON.stringify({ widgets: ['id'] }))\n")
  return { checker, helper, manifest: join(dir, 'domain-api-surface.json') }
}

function runConsumer(checker: string, args: string[]) {
  return spawnSync(process.execPath, [checker, ...args], {
    cwd: consumerDir,
    encoding: 'utf8',
  })
}

function validManifest() {
  return {
    schema: 'arbiter-domain-api-surface-v1',
    resources: [
      {
        resource: 'widgets',
        domainFields: [
          {
            name: 'id',
            persisted: true,
            inRequestSchema: false,
            inResponseSchema: true,
            evidence: [
              { method: 'GET', path: '/api/widgets/item', in: 'response', jsonPath: '$.id' },
            ],
          },
        ],
      },
    ],
  }
}

afterEach(() => {
  if (consumerDir) rmSync(consumerDir, { recursive: true, force: true })
  consumerDir = undefined
})

describe('check-domain-api-surface.mjs.ejs render tests', () => {
  for (const stack of STACKS) {
    it(`renders for ${stack.language}/${stack.governanceLevel}`, () => {
      const data = { ...BASE_DATA, ...stack }
      const result = renderTemplate('scripts/check-domain-api-surface.mjs.ejs', data)
      expect(result).toBeTruthy()
      expect(result.length).toBeGreaterThan(100)
    })
  }

  it('contains CATALOG: markers (at least 3 contiguous)', () => {
    const result = renderTemplate('scripts/check-domain-api-surface.mjs.ejs', BASE_DATA)
    const lines = result.split('\n')
    const catalogLines = lines.filter((l) => l.includes('// CATALOG:'))
    expect(catalogLines.length).toBeGreaterThanOrEqual(3)
  })

  it('interpolates projectName', () => {
    const result = renderTemplate('scripts/check-domain-api-surface.mjs.ejs', {
      ...BASE_DATA,
      projectName: 'my-api-project',
    })
    expect(result).toContain('my-api-project')
  })

  it('contains exit 0 PASS path', () => {
    const result = renderTemplate('scripts/check-domain-api-surface.mjs.ejs', BASE_DATA)
    expect(result).toContain('domain-api surface (INV-125): OK')
  })

  it('contains exit 1 FAIL path', () => {
    const result = renderTemplate('scripts/check-domain-api-surface.mjs.ejs', BASE_DATA)
    expect(result).toContain('process.exit(1)')
    expect(result).toContain('FAIL')
  })

  it('contains exit 2 ERROR path', () => {
    const result = renderTemplate('scripts/check-domain-api-surface.mjs.ejs', BASE_DATA)
    expect(result).toContain('process.exit(2)')
    expect(result).toContain('ERROR')
  })

  it('uses arbiter-domain-api-surface-v1 schema', () => {
    const result = renderTemplate('scripts/check-domain-api-surface.mjs.ejs', BASE_DATA)
    expect(result).toContain('arbiter-domain-api-surface-v1')
  })

  it('honors explicit manifest and schema-helper inputs for a complete live surface', () => {
    const { checker, helper, manifest } = writeConsumerFixture()
    writeFileSync(manifest, JSON.stringify(validManifest()))
    const result = runConsumer(checker, ['--manifest', manifest, '--schema-helper', helper])
    expect(result.status).toBe(0)
    expect(`${result.stdout}${result.stderr}`).toContain('domain-api surface (INV-125): OK')
  })

  it('uses the conventional schema helper automatically when the consumer provides it', () => {
    const { checker, manifest } = writeConsumerFixture()
    const helperDir = join(consumerDir!, 'scripts', 'lib')
    mkdirSync(helperDir, { recursive: true })
    writeFileSync(
      join(helperDir, 'domain-api-schema.ts'),
      "process.stdout.write(JSON.stringify({ widgets: ['id', 'name'] }))\n",
    )
    writeFileSync(manifest, JSON.stringify(validManifest()))

    const result = runConsumer(checker, ['--manifest', manifest])

    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toContain('[FAIL] Missing field: widgets.name')
  })

  it('runs a fresh generated manifest through the generic default contract', () => {
    const { checker, manifest } = writeConsumerFixture()
    rmSync(join(consumerDir!, 'src'), { recursive: true, force: true })
    rmSync(join(consumerDir!, 'node_modules'), { recursive: true, force: true })
    writeFileSync(manifest, renderTemplate('scripts/domain-api-surface.json.ejs', CONSUMER_DATA))
    const result = runConsumer(checker, [])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('[domain-api-surface] PASS')
  })

  it.each([
    ['empty resources', []],
    ['missing domainFields', [{ resource: 'widgets' }]],
    ['empty domainFields', [{ resource: 'widgets', domainFields: [] }]],
    [
      'malformed field flags',
      [
        {
          resource: 'widgets',
          domainFields: [
            { name: 'id', persisted: 'true', inRequestSchema: false, inResponseSchema: true },
          ],
        },
      ],
    ],
  ])('rejects %s without a schema helper', (_label, resources) => {
    const { checker, manifest } = writeConsumerFixture()
    rmSync(join(consumerDir!, 'src'), { recursive: true, force: true })
    rmSync(join(consumerDir!, 'node_modules'), { recursive: true, force: true })
    writeFileSync(manifest, JSON.stringify({ schema: 'arbiter-domain-api-surface-v1', resources }))

    const result = runConsumer(checker, ['--manifest', manifest])

    expect(result.status).toBe(2)
    expect(`${result.stdout}${result.stderr}`).toContain('[ERROR]')
  })

  it('fails closed when the manifest is absent instead of silently skipping', () => {
    const { checker, helper, manifest } = writeConsumerFixture()
    const result = runConsumer(checker, ['--manifest', manifest, '--schema-helper', helper])
    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toContain('[FAIL] Manifest not found:')
  })

  it('returns a policy failure for an unreachable persisted field in the explicit manifest', () => {
    const { checker, helper, manifest } = writeConsumerFixture()
    const fixture = validManifest()
    fixture.resources[0].domainFields[0].inResponseSchema = false
    writeFileSync(manifest, JSON.stringify(fixture))
    const result = runConsumer(checker, ['--manifest', manifest, '--schema-helper', helper])
    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toContain(
      '[FAIL] Unreachable persisted field: widgets.id',
    )
  })

  it('returns an operational error for malformed JSON and helper failures', () => {
    const { checker, helper, manifest } = writeConsumerFixture()
    writeFileSync(manifest, '{')
    const malformed = runConsumer(checker, ['--manifest', manifest, '--schema-helper', helper])
    expect(malformed.status).toBe(2)
    expect(`${malformed.stdout}${malformed.stderr}`).toContain(
      '[ERROR] Manifest is unreadable or invalid JSON:',
    )

    writeFileSync(manifest, JSON.stringify(validManifest()))
    writeFileSync(helper, 'process.exit(1)\n')
    const helperFailure = runConsumer(checker, ['--manifest', manifest, '--schema-helper', helper])
    expect(helperFailure.status).toBe(2)
    expect(`${helperFailure.stdout}${helperFailure.stderr}`).toContain(
      '[ERROR] Schema helper failed:',
    )
  })

  it('checks route evidence, schema parity, and fixed exemption rules', () => {
    const { checker, helper, manifest } = writeConsumerFixture()
    const fixture = validManifest()
    fixture.resources[0].domainFields[0].evidence[0].path = '/api/widgets/missing'
    writeFileSync(manifest, JSON.stringify(fixture))
    let result = runConsumer(checker, ['--manifest', manifest, '--schema-helper', helper])
    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toContain(
      'Unmounted evidence route: GET /api/widgets/missing',
    )

    writeFileSync(helper, "process.stdout.write(JSON.stringify({ widgets: ['id', 'name'] }))\n")
    fixture.resources[0].domainFields[0].evidence[0].path = '/api/widgets/item'
    writeFileSync(manifest, JSON.stringify(fixture))
    result = runConsumer(checker, ['--manifest', manifest, '--schema-helper', helper])
    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toContain('Missing field: widgets.name')

    writeFileSync(helper, "process.stdout.write(JSON.stringify({ widgets: ['id'] }))\n")
    fixture.resources[0].domainFields[0].persisted = false
    fixture.resources[0].domainFields[0].note = 'not an allowlist reason'
    writeFileSync(manifest, JSON.stringify(fixture))
    result = runConsumer(checker, ['--manifest', manifest, '--schema-helper', helper])
    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toContain('Unauthorized exemption: widgets.id')
  })
})

describe('domain-api-surface.json.ejs render tests', () => {
  for (const stack of STACKS) {
    it(`renders valid JSON for ${stack.language}/${stack.governanceLevel}`, () => {
      const data = { ...BASE_DATA, ...stack }
      const result = renderTemplate('scripts/domain-api-surface.json.ejs', data)
      expect(result).toBeTruthy()
      const parsed = JSON.parse(result)
      expect(parsed.schema).toBe('arbiter-domain-api-surface-v1')
      expect(Array.isArray(parsed.resources)).toBe(true)
    })
  }

  it('seed manifest has schema field', () => {
    const result = renderTemplate('scripts/domain-api-surface.json.ejs', BASE_DATA)
    const parsed = JSON.parse(result)
    expect(parsed.schema).toBe('arbiter-domain-api-surface-v1')
  })

  it('seed manifest has non-empty resources array', () => {
    const result = renderTemplate('scripts/domain-api-surface.json.ejs', BASE_DATA)
    const parsed = JSON.parse(result)
    expect(parsed.resources.length).toBeGreaterThan(0)
  })

  it('seed resource has domainFields array', () => {
    const result = renderTemplate('scripts/domain-api-surface.json.ejs', BASE_DATA)
    const parsed = JSON.parse(result)
    expect(Array.isArray(parsed.resources[0].domainFields)).toBe(true)
  })
})
