// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import { getLogger } from '../utils/logger.js'
import { isL3Allowed } from '../utils/maturity-check.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface ContractTestingGeneratorResult {
  files: WriteResult[]
}

function injectPactPackageJson(targetDir: string, dryRun: boolean): void {
  if (dryRun) return
  const pkgPath = resolvedPath(targetDir, 'package.json')
  if (!existsSync(pkgPath)) return
  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>
  } catch (err) {
    getLogger().warn(
      'contract_testing.inject_pact_parse_failed',
      { path: pkgPath, err: String(err) },
      'injectPactPackageJson: failed to parse package.json',
    )
    return
  }
  const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>
  if (!devDeps['@pact-foundation/pact']) {
    devDeps['@pact-foundation/pact'] = '^16.4.0'
    pkg.devDependencies = devDeps
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8')
  }
}

/** Compute the Java contracts package path. Falls back to "contracts". */
function javaContractsPkg(config: ProjectConfig): string {
  if (config.basePackage) {
    if (!/^[a-zA-Z][a-zA-Z0-9._-]*$/.test(config.basePackage)) {
      throw new Error(`Invalid basePackage identifier: ${config.basePackage}`)
    }
    const javaPath = config.basePackage.replace(/\./g, '/')
    return `src/test/java/${javaPath}/contracts`
  }
  return 'src/test/java/contracts'
}

interface ContractFileOptions {
  base: string
  config: ProjectConfig
  data: object
  templateDir: string
  tsFile: string
  javaFile: string
  rustFile: string
  goFile: string
  pyFile: string
  extraFiles?: WriteResult[]
  dryRun: boolean
}

function contractFile(cfOpts: ContractFileOptions): WriteResult[] {
  const { base, config, data, templateDir, tsFile, javaFile, rustFile, goFile, pyFile, dryRun } =
    cfOpts
  const out: WriteResult[] = cfOpts.extraFiles ?? []
  const skip = { skipIfExists: true, dryRun } as const

  if (config.language === 'typescript' || config.language === 'multi') {
    out.push(
      writeFile(
        resolvedPath(base, 'src', 'test', 'contracts', tsFile),
        renderTemplate(`contract-testing/${templateDir}/${tsFile}.ejs`, data),
        skip,
      ),
    )
  }
  if (config.language === 'java' || config.language === 'multi') {
    const pkg = javaContractsPkg(config)
    out.push(
      writeFile(
        resolvedPath(base, pkg, javaFile),
        renderTemplate(`contract-testing/${templateDir}/${javaFile}.ejs`, data),
        skip,
      ),
    )
  }
  if (config.language === 'rust') {
    out.push(
      writeFile(
        resolvedPath(base, 'tests', rustFile),
        renderTemplate(`contract-testing/${templateDir}/${rustFile}.ejs`, data),
        skip,
      ),
    )
  } else if (config.language === 'go') {
    out.push(
      writeFile(
        resolvedPath(base, 'tests', goFile),
        renderTemplate(`contract-testing/${templateDir}/${goFile}.ejs`, data),
        skip,
      ),
    )
  } else if (config.language === 'python') {
    // python — contract tests live in tests/contract/ to match pytest discovery path
    out.push(
      writeFile(
        resolvedPath(base, 'tests', 'contract', pyFile),
        renderTemplate(`contract-testing/${templateDir}/${pyFile}.ejs`, data),
        skip,
      ),
    )
  }

  return out
}

/**
 * F9: Emit api-snapshots/ stub JSONs, pact-samples/ stub JSONs, and contract validator scripts.
 * All files use skipIfExists so brownfield re-init never overwrites user-regenerated baselines.
 * (#896)
 */
function generateApiContractBaselines(base: string, data: object, dryRun: boolean): WriteResult[] {
  const snapshotsBase = resolvedPath(base, 'src', 'test', 'resources', 'api-snapshots')
  const pactSamplesBase = resolvedPath(base, 'src', 'test', 'resources', 'pact-samples')
  const skip = { skipIfExists: true, dryRun } as const
  const out: WriteResult[] = []

  const snapshotStubs = [
    'openapi-baseline.json',
    'openapi-paths-baseline.json',
    'openapi-response-status-baseline.json',
    'openapi-content-types-baseline.json',
    'openapi-required-fields-baseline.json',
    'config-response-baseline.json',
    'config-keys-baseline.json',
    'enum-values-baseline.json',
    'error-shape-baseline.json',
    'test-snapshot.json',
  ]
  for (const name of snapshotStubs) {
    out.push(
      writeFile(
        resolvedPath(snapshotsBase, name),
        renderTemplate(`contract-testing/api-snapshots/${name}.ejs`, data),
        skip,
      ),
    )
  }

  const pactStubs = [
    'assignment-response.json',
    'availability-response.json',
    'availability-rule-response.json',
    'capacity-response.json',
    'fully-booked-response.json',
    'schedule-override-response.json',
  ]
  for (const name of pactStubs) {
    out.push(
      writeFile(
        resolvedPath(pactSamplesBase, name),
        renderTemplate(`contract-testing/pact-samples/${name}.ejs`, data),
        skip,
      ),
    )
  }

  out.push(
    writeFile(
      resolvedPath(base, 'scripts', 'validate-api-snapshots.mjs'),
      renderTemplate('scripts/validate-api-snapshots.mjs.ejs', data),
      skip,
    ),
    writeFile(
      resolvedPath(base, 'scripts', 'validate-openapi-field-types.mjs'),
      renderTemplate('scripts/validate-openapi-field-types.mjs.ejs', data),
      skip,
    ),
    writeFile(
      resolvedPath(base, 'scripts', 'validate-postman-collection.mjs'),
      renderTemplate('scripts/validate-postman-collection.mjs.ejs', data),
      skip,
    ),
  )

  return out
}

function generateRestOwned(
  base: string,
  config: ProjectConfig,
  data: object,
  dryRun: boolean,
): WriteResult[] {
  const extra: WriteResult[] = [
    writeFile(
      resolvedPath(base, '.env.pact'),
      renderTemplate('contract-testing/env/.env.pact.ejs', data),
      { skipIfExists: true, dryRun },
    ),
    writeFile(resolvedPath(base, 'pacts', '.gitkeep'), '', {
      skipIfExists: true,
      dryRun,
    }),
  ]

  if (config.language === 'java' || config.language === 'multi') {
    extra.push(
      writeFile(
        resolvedPath(base, 'config', 'pact-deps.gradle'),
        renderTemplate('contract-testing/rest-owned/pact-deps.gradle.ejs', data),
        { skipIfExists: true, dryRun },
      ),
    )
  }

  // F7: Postman/Newman contract test scripts — Java only (#894)
  // Emitted additively alongside Pact when the project is Java-based.
  // The scripts complement Pact: Newman validates the live API surface using a
  // Postman collection; inject-pact-samples.sh seeds the service with Pact interactions
  // so Newman can exercise the exact contract scenarios defined in the Pact files.
  if (config.language === 'java' || config.language === 'multi') {
    extra.push(
      writeFile(
        resolvedPath(base, 'scripts', 'run-postman-tests.sh'),
        renderTemplate('scripts/run-postman-tests.sh.ejs', data),
        { skipIfExists: true, dryRun },
      ),
      writeFile(
        resolvedPath(base, 'scripts', 'inject-pact-samples.sh'),
        renderTemplate('scripts/inject-pact-samples.sh.ejs', data),
        { skipIfExists: true, dryRun },
      ),
      writeFile(
        resolvedPath(base, '.github', 'workflows', '_contract-postman.yml'),
        renderTemplate('github/workflows/_contract-postman.yml.ejs', data),
        { skipIfExists: true, dryRun },
      ),
    )
  }

  // F9: API contract baselines — Java only (#896)
  if (config.language === 'java' || config.language === 'multi') {
    extra.push(...generateApiContractBaselines(base, data, dryRun))
  }

  if (config.language === 'typescript' || config.language === 'multi') {
    injectPactPackageJson(base, dryRun)
  }

  return contractFile({
    base,
    config,
    data,
    templateDir: 'rest-owned',
    tsFile: 'pact-consumer.test.ts',
    javaFile: 'PactVerificationIT.java',
    rustFile: 'pact_consumer_test.rs',
    goFile: 'pact_consumer_test.go',
    pyFile: 'test_pact_consumer.py',
    extraFiles: extra,
    dryRun,
  })
}

function generateRestPublic(
  base: string,
  config: ProjectConfig,
  data: object,
  dryRun: boolean,
): WriteResult[] {
  return contractFile({
    base,
    config,
    data,
    templateDir: 'rest-public',
    tsFile: 'openapi-diff.ts',
    javaFile: 'OpenApiDiffIT.java',
    rustFile: 'openapi_diff_test.rs',
    goFile: 'openapi_diff_test.go',
    pyFile: 'test_openapi_diff.py',
    dryRun,
  })
}

function generateGraphql(
  base: string,
  config: ProjectConfig,
  data: object,
  dryRun: boolean,
): WriteResult[] {
  return contractFile({
    base,
    config,
    data,
    templateDir: 'graphql',
    tsFile: 'graphql-inspector.test.ts',
    javaFile: 'GraphqlSchemaTest.java',
    rustFile: 'graphql_schema_test.rs',
    goFile: 'graphql_schema_test.go',
    pyFile: 'test_graphql_schema.py',
    dryRun,
  })
}

function generateGrpc(
  base: string,
  config: ProjectConfig,
  data: object,
  dryRun: boolean,
): WriteResult[] {
  const skip = { skipIfExists: true, dryRun } as const
  const shared: WriteResult[] = [
    writeFile(
      resolvedPath(base, 'proto', 'buf.yaml'),
      renderTemplate('contract-testing/grpc/buf.yaml.ejs', data),
      skip,
    ),
    writeFile(
      resolvedPath(base, 'proto', 'buf-breaking.yml'),
      renderTemplate('contract-testing/grpc/buf-breaking.yml.ejs', data),
      skip,
    ),
  ]

  return contractFile({
    base,
    config,
    data,
    templateDir: 'grpc',
    tsFile: 'grpc-contract.test.ts',
    javaFile: 'GrpcContractTest.java',
    rustFile: 'grpc_contract_test.rs',
    goFile: 'grpc_contract_test.go',
    pyFile: 'test_grpc_contract.py',
    extraFiles: shared,
    dryRun,
  })
}

function generateMessageQueue(
  base: string,
  config: ProjectConfig,
  data: object,
  dryRun: boolean,
): WriteResult[] {
  return contractFile({
    base,
    config,
    data,
    templateDir: 'message-queue',
    tsFile: 'schema-registry-check.ts',
    javaFile: 'SchemaRegistryCheckIT.java',
    rustFile: 'schema_registry_test.rs',
    goFile: 'schema_registry_test.go',
    pyFile: 'test_schema_registry.py',
    dryRun,
  })
}

export function generateContractTesting(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): ContractTestingGeneratorResult {
  if (config.contractType === 'none' || config.governanceLevel === 'L1') {
    return { files: [] }
  }

  const dispatchers: Record<
    string,
    (base: string, config: ProjectConfig, data: object, dryRun: boolean) => WriteResult[]
  > = {
    'rest-owned': generateRestOwned,
    'rest-public': generateRestPublic,
    graphql: generateGraphql,
    grpc: generateGrpc,
    'message-queue': generateMessageQueue,
  }

  // #289: contract testing is only meaningful for services with a public API
  if (!config.hasPublicApi) {
    return { files: [] }
  }

  // #288: gate beta contract tools on acceptBetaTools flag
  const { language, acceptBetaTools = false } = config
  if (language !== 'multi') {
    const gate = isL3Allowed(language, 'contract', acceptBetaTools)
    if (!gate.allowed) return { files: [] }
  }

  // #287: warn and skip on unknown contractType — throw is swallowed by safeRun; use warn+skip instead
  const handler = dispatchers[config.contractType]
  if (!handler) {
    getLogger().warn(
      'contract_testing.unknown_contract_type',
      { contract_type: config.contractType },
      `Unknown contractType: ${config.contractType} — skipping`,
    )
    return { files: [] }
  }

  const base = config.targetDir
  const data = config
  const results: WriteResult[] = [
    writeFile(
      resolvedPath(base, 'CONTRACTS_POLICY.md'),
      renderTemplate('contract-testing/CONTRACTS_POLICY.md.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  ]

  results.push(...handler(base, config, data, opts.dryRun))

  return { files: results }
}
