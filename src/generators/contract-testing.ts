import { renderTemplate } from "../utils/render.js";
import { writeFile, resolvedPath } from "../utils/fs.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

export interface ContractTestingGeneratorResult {
  files: WriteResult[];
}

/** Compute the Java contracts package path. Falls back to "contracts". */
function javaContractsPkg(config: ProjectConfig): string {
  if (config.basePackage) {
    return `src/test/java/${config.basePackage.replace(/\./g, "/")}/contracts`;
  }
  return "src/test/java/contracts";
}

interface ContractFileOptions {
  base: string;
  config: ProjectConfig;
  data: Record<string, unknown>;
  templateDir: string;
  tsFile: string;
  javaFile: string;
  rustFile: string;
  goFile: string;
  pyFile: string;
  extraFiles?: WriteResult[];
}

function contractFile(opts: ContractFileOptions): WriteResult[] {
  const {
    base,
    config,
    data,
    templateDir,
    tsFile,
    javaFile,
    rustFile,
    goFile,
    pyFile,
  } = opts;
  const out: WriteResult[] = opts.extraFiles ?? [];
  const skip = { skipIfExists: true } as const;

  if (config.language === "typescript") {
    out.push(
      writeFile(
        resolvedPath(base, "src", "test", "contracts", tsFile),
        renderTemplate(`contract-testing/${templateDir}/${tsFile}.ejs`, data),
        skip,
      ),
    );
  } else if (config.language === "java") {
    const pkg = javaContractsPkg(config);
    out.push(
      writeFile(
        resolvedPath(base, pkg, javaFile),
        renderTemplate(`contract-testing/${templateDir}/${javaFile}.ejs`, data),
        skip,
      ),
    );
  } else if (config.language === "rust") {
    out.push(
      writeFile(
        resolvedPath(base, "tests", rustFile),
        renderTemplate(`contract-testing/${templateDir}/${rustFile}.ejs`, data),
        skip,
      ),
    );
  } else if (config.language === "go") {
    out.push(
      writeFile(
        resolvedPath(base, "tests", goFile),
        renderTemplate(`contract-testing/${templateDir}/${goFile}.ejs`, data),
        skip,
      ),
    );
  } else {
    // python — contract tests live in tests/contract/ to match pytest discovery path
    out.push(
      writeFile(
        resolvedPath(base, "tests", "contract", pyFile),
        renderTemplate(`contract-testing/${templateDir}/${pyFile}.ejs`, data),
        skip,
      ),
    );
  }

  return out;
}

function generateRestOwned(
  base: string,
  config: ProjectConfig,
  data: Record<string, unknown>,
): WriteResult[] {
  const extra: WriteResult[] = [
    writeFile(
      resolvedPath(base, ".env.pact"),
      renderTemplate("contract-testing/env/.env.pact.ejs", data),
      { skipIfExists: true },
    ),
    writeFile(resolvedPath(base, "pacts", ".gitkeep"), "", {
      skipIfExists: true,
    }),
  ];

  if (config.language === "java") {
    extra.push(
      writeFile(
        resolvedPath(base, "config", "pact-deps.gradle"),
        renderTemplate(
          "contract-testing/rest-owned/pact-deps.gradle.ejs",
          data,
        ),
        { skipIfExists: true },
      ),
    );
  }

  return contractFile({
    base,
    config,
    data,
    templateDir: "rest-owned",
    tsFile: "pact-consumer.test.ts",
    javaFile: "PactVerificationIT.java",
    rustFile: "pact_consumer_test.rs",
    goFile: "pact_consumer_test.go",
    pyFile: "test_pact_consumer.py",
    extraFiles: extra,
  });
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
    templateDir: "rest-public",
    tsFile: "openapi-diff.ts",
    javaFile: "OpenApiDiffIT.java",
    rustFile: "openapi_diff_test.rs",
    goFile: "openapi_diff_test.go",
    pyFile: "test_openapi_diff.py",
  });
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
    templateDir: "graphql",
    tsFile: "graphql-inspector.test.ts",
    javaFile: "GraphqlSchemaTest.java",
    rustFile: "graphql_schema_test.rs",
    goFile: "graphql_schema_test.go",
    pyFile: "test_graphql_schema.py",
  });
}

function generateGrpc(
  base: string,
  config: ProjectConfig,
  data: Record<string, unknown>,
): WriteResult[] {
  const skip = { skipIfExists: true } as const;
  const shared: WriteResult[] = [
    writeFile(
      resolvedPath(base, "proto", "buf.yaml"),
      renderTemplate("contract-testing/grpc/buf.yaml.ejs", data),
      skip,
    ),
    writeFile(
      resolvedPath(base, "proto", "buf-breaking.yml"),
      renderTemplate("contract-testing/grpc/buf-breaking.yml.ejs", data),
      skip,
    ),
  ];

  return contractFile({
    base,
    config,
    data,
    templateDir: "grpc",
    tsFile: "grpc-contract.test.ts",
    javaFile: "GrpcContractTest.java",
    rustFile: "grpc_contract_test.rs",
    goFile: "grpc_contract_test.go",
    pyFile: "test_grpc_contract.py",
    extraFiles: shared,
  });
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
    templateDir: "message-queue",
    tsFile: "schema-registry-check.ts",
    javaFile: "SchemaRegistryCheckIT.java",
    rustFile: "schema_registry_test.rs",
    goFile: "schema_registry_test.go",
    pyFile: "test_schema_registry.py",
  });
}

export function generateContractTesting(
  config: ProjectConfig,
): ContractTestingGeneratorResult {
  if (config.contractType === "none" || config.governanceLevel === "L1") {
    return { files: [] };
  }

  const base = config.targetDir;
  const data = config as unknown as Record<string, unknown>;
  const results: WriteResult[] = [
    writeFile(
      resolvedPath(base, "CONTRACTS_POLICY.md"),
      renderTemplate("contract-testing/CONTRACTS_POLICY.md.ejs", data),
      { skipIfExists: true },
    ),
  ];

  const dispatchers: Record<
    string,
    (
      base: string,
      config: ProjectConfig,
      data: Record<string, unknown>,
    ) => WriteResult[]
  > = {
    "rest-owned": generateRestOwned,
    "rest-public": generateRestPublic,
    graphql: generateGraphql,
    grpc: generateGrpc,
    "message-queue": generateMessageQueue,
  };

  const handler = dispatchers[config.contractType];
  if (handler) {
    results.push(...handler(base, config, data));
  }

  return { files: results };
}
