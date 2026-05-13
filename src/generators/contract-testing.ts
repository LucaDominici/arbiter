import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import { isL3Allowed } from '../utils/maturity-check.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface ContractTestingGeneratorResult {
  files: WriteResult[]
}

/** Compute the Java contracts package path. Falls back to "contracts". */
function javaContractsPkg(config: ProjectConfig): string {
  if (config.basePackage) {
    return `src/test/java/${config.basePackage.replace(/\./g, '/')}/contracts`
  }
  return 'src/test/java/contracts'
}

interface ContractFileOptions {
  base: string
  config: ProjectConfig
  data: Record<string, unknown>
  templateDir: string
  tsFile: string
  javaFile: string
  rustFile: string
  goFile: string
  pyFile: string
  extraFiles?: WriteResult[]
}

function contractFile(opts: ContractFileOptions): WriteResult[] {
  const { base, config, data, templateDir, tsFile, javaFile, rustFile, goFile, pyFile } = opts
  const out: WriteResult[] = opts.extraFiles ?? []
  const skip = { skipIfExists: true } as const

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

function generateRestOwned(
  base: string,
  config: ProjectConfig,
  data: Record<string, unknown>,
): WriteResult[] {
  const extra: WriteResult[] = [
    writeFile(
      resolvedPath(base, '.env.pact'),
      renderTemplate('contract-testing/env/.env.pact.ejs', data),
      { skipIfExists: true },
    ),
    writeFile(resolvedPath(base, 'pacts', '.gitkeep'), '', {
      skipIfExists: true,
    }),
  ]

  if (config.language === 'java' || config.language === 'multi') {
    extra.push(
      writeFile(
        resolvedPath(base, 'config', 'pact-deps.gradle'),
        renderTemplate('contract-testing/rest-owned/pact-deps.gradle.ejs', data),
        { skipIfExists: true },
      ),
    )
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
  })
}

function generateRestPublic(
  base: string,
  config: ProjectConfig,
  data: Record<string, unknown>,
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
  })
}

function generateGraphql(
  base: string,
  config: ProjectConfig,
  data: Record<string, unknown>,
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
  })
}

function generateGrpc(
  base: string,
  config: ProjectConfig,
  data: Record<string, unknown>,
): WriteResult[] {
  const skip = { skipIfExists: true } as const
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
  })
}

function generateMessageQueue(
  base: string,
  config: ProjectConfig,
  data: Record<string, unknown>,
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
  })
}

export function generateContractTesting(config: ProjectConfig): ContractTestingGeneratorResult {
  if (config.contractType === 'none' || config.governanceLevel === 'L1') {
    return { files: [] }
  }

  const dispatchers: Record<
    string,
    (base: string, config: ProjectConfig, data: Record<string, unknown>) => WriteResult[]
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

  // #287: throw on unknown contractType — unknown type must not silently write the policy file
  const handler = dispatchers[config.contractType]
  if (!handler) {
    throw new Error(`Unknown contractType: ${config.contractType}`)
  }

  const base = config.targetDir
  const data = config as unknown as Record<string, unknown>
  const results: WriteResult[] = [
    writeFile(
      resolvedPath(base, 'CONTRACTS_POLICY.md'),
      renderTemplate('contract-testing/CONTRACTS_POLICY.md.ejs', data),
      { skipIfExists: true },
    ),
  ]

  results.push(...handler(base, config, data))

  return { files: results }
}
