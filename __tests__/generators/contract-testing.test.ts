import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createTestProject,
  initGit,
  cleanupTestProject,
  makeConfig,
} from "../helpers.js";
import { generateContractTesting } from "../../src/generators/contract-testing.js";

describe("generateContractTesting", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject("typescript");
    initGit(dir);
  });

  afterEach(() => {
    cleanupTestProject(dir);
  });

  // ─── Gate: contractType="none" → empty ────────────────────────────────────

  it("returns empty when contractType is none for typescript", () => {
    const config = makeConfig(dir, {
      contractType: "none",
      governanceLevel: "L2",
      language: "typescript",
    });
    expect(generateContractTesting(config).files).toHaveLength(0);
  });

  it("returns empty when contractType is none for java", () => {
    const javaDir = createTestProject("java");
    initGit(javaDir);
    try {
      const config = makeConfig(javaDir, {
        contractType: "none",
        governanceLevel: "L2",
        language: "java",
        buildTool: "gradle",
      });
      expect(generateContractTesting(config).files).toHaveLength(0);
    } finally {
      cleanupTestProject(javaDir);
    }
  });

  it("returns empty when contractType is none for rust", () => {
    const rustDir = createTestProject("rust");
    initGit(rustDir);
    try {
      const config = makeConfig(rustDir, {
        contractType: "none",
        governanceLevel: "L2",
        language: "rust",
        buildTool: "cargo",
      });
      expect(generateContractTesting(config).files).toHaveLength(0);
    } finally {
      cleanupTestProject(rustDir);
    }
  });

  it("returns empty when contractType is none for go", () => {
    const goDir = createTestProject("go");
    initGit(goDir);
    try {
      const config = makeConfig(goDir, {
        contractType: "none",
        governanceLevel: "L2",
        language: "go",
        buildTool: "go",
      });
      expect(generateContractTesting(config).files).toHaveLength(0);
    } finally {
      cleanupTestProject(goDir);
    }
  });

  it("returns empty when contractType is none for python", () => {
    const pyDir = createTestProject("python");
    initGit(pyDir);
    try {
      const config = makeConfig(pyDir, {
        contractType: "none",
        governanceLevel: "L2",
        language: "python",
        buildTool: "pip",
      });
      expect(generateContractTesting(config).files).toHaveLength(0);
    } finally {
      cleanupTestProject(pyDir);
    }
  });

  // ─── Gate: governanceLevel=L1 → empty ─────────────────────────────────────

  it("returns empty when governanceLevel is L1 with rest-owned", () => {
    const config = makeConfig(dir, {
      contractType: "rest-owned",
      governanceLevel: "L1",
      language: "typescript",
    });
    expect(generateContractTesting(config).files).toHaveLength(0);
  });

  it("returns empty when governanceLevel is L1 with rest-public", () => {
    const config = makeConfig(dir, {
      contractType: "rest-public",
      governanceLevel: "L1",
      language: "typescript",
    });
    expect(generateContractTesting(config).files).toHaveLength(0);
  });

  it("returns empty when governanceLevel is L1 with graphql", () => {
    const config = makeConfig(dir, {
      contractType: "graphql",
      governanceLevel: "L1",
      language: "typescript",
    });
    expect(generateContractTesting(config).files).toHaveLength(0);
  });

  it("returns empty when governanceLevel is L1 with grpc", () => {
    const config = makeConfig(dir, {
      contractType: "grpc",
      governanceLevel: "L1",
      language: "typescript",
    });
    expect(generateContractTesting(config).files).toHaveLength(0);
  });

  it("returns empty when governanceLevel is L1 with message-queue", () => {
    const config = makeConfig(dir, {
      contractType: "message-queue",
      governanceLevel: "L1",
      language: "typescript",
    });
    expect(generateContractTesting(config).files).toHaveLength(0);
  });

  // ─── rest-owned × typescript: 2 files ────────────────────────────────────

  it("returns 4 files for rest-owned + typescript (.env.pact + pacts/.gitkeep added)", () => {
    const config = makeConfig(dir, {
      contractType: "rest-owned",
      governanceLevel: "L2",
      language: "typescript",
    });
    expect(generateContractTesting(config).files).toHaveLength(4);
  });

  it("generates CONTRACTS_POLICY.md for rest-owned + typescript", () => {
    const config = makeConfig(dir, {
      contractType: "rest-owned",
      governanceLevel: "L2",
      language: "typescript",
    });
    generateContractTesting(config);
    expect(existsSync(join(dir, "CONTRACTS_POLICY.md"))).toBe(true);
  });

  it("generates pact-consumer.test.ts for rest-owned + typescript", () => {
    const config = makeConfig(dir, {
      contractType: "rest-owned",
      governanceLevel: "L2",
      language: "typescript",
    });
    generateContractTesting(config);
    expect(
      existsSync(
        join(dir, "src", "test", "contracts", "pact-consumer.test.ts"),
      ),
    ).toBe(true);
  });

  // ─── rest-owned × java: 3 files ──────────────────────────────────────────

  it("returns 5 files for rest-owned + java (.env.pact + pacts/.gitkeep added)", () => {
    const javaDir = createTestProject("java");
    initGit(javaDir);
    try {
      const config = makeConfig(javaDir, {
        contractType: "rest-owned",
        governanceLevel: "L2",
        language: "java",
        buildTool: "gradle",
      });
      expect(generateContractTesting(config).files).toHaveLength(5);
    } finally {
      cleanupTestProject(javaDir);
    }
  });

  it("generates PactVerificationIT.java at fallback path for rest-owned + java (no basePackage)", () => {
    const javaDir = createTestProject("java");
    initGit(javaDir);
    try {
      const config = makeConfig(javaDir, {
        contractType: "rest-owned",
        governanceLevel: "L2",
        language: "java",
        buildTool: "gradle",
      });
      generateContractTesting(config);
      expect(
        existsSync(
          join(
            javaDir,
            "src",
            "test",
            "java",
            "contracts",
            "PactVerificationIT.java",
          ),
        ),
      ).toBe(true);
    } finally {
      cleanupTestProject(javaDir);
    }
  });

  it("generates PactVerificationIT.java at package path for rest-owned + java (with basePackage)", () => {
    const javaDir = createTestProject("java");
    initGit(javaDir);
    try {
      const config = makeConfig(javaDir, {
        contractType: "rest-owned",
        governanceLevel: "L2",
        language: "java",
        buildTool: "gradle",
        basePackage: "com.example.myapp",
      });
      generateContractTesting(config);
      expect(
        existsSync(
          join(
            javaDir,
            "src",
            "test",
            "java",
            "com",
            "example",
            "myapp",
            "contracts",
            "PactVerificationIT.java",
          ),
        ),
      ).toBe(true);
    } finally {
      cleanupTestProject(javaDir);
    }
  });

  it("generates pact-deps.gradle for rest-owned + java", () => {
    const javaDir = createTestProject("java");
    initGit(javaDir);
    try {
      const config = makeConfig(javaDir, {
        contractType: "rest-owned",
        governanceLevel: "L2",
        language: "java",
        buildTool: "gradle",
      });
      generateContractTesting(config);
      expect(existsSync(join(javaDir, "config", "pact-deps.gradle"))).toBe(
        true,
      );
    } finally {
      cleanupTestProject(javaDir);
    }
  });

  // ─── rest-owned × rust: 2 files ──────────────────────────────────────────

  it("returns 4 files for rest-owned + rust (.env.pact + pacts/.gitkeep added)", () => {
    const rustDir = createTestProject("rust");
    initGit(rustDir);
    try {
      const config = makeConfig(rustDir, {
        contractType: "rest-owned",
        governanceLevel: "L2",
        language: "rust",
        buildTool: "cargo",
      });
      expect(generateContractTesting(config).files).toHaveLength(4);
    } finally {
      cleanupTestProject(rustDir);
    }
  });

  it("generates tests/pact_consumer_test.rs for rest-owned + rust", () => {
    const rustDir = createTestProject("rust");
    initGit(rustDir);
    try {
      const config = makeConfig(rustDir, {
        contractType: "rest-owned",
        governanceLevel: "L2",
        language: "rust",
        buildTool: "cargo",
      });
      generateContractTesting(config);
      expect(existsSync(join(rustDir, "tests", "pact_consumer_test.rs"))).toBe(
        true,
      );
    } finally {
      cleanupTestProject(rustDir);
    }
  });

  // ─── rest-owned × go: 2 files ────────────────────────────────────────────

  it("returns 4 files for rest-owned + go (.env.pact + pacts/.gitkeep added)", () => {
    const goDir = createTestProject("go");
    initGit(goDir);
    try {
      const config = makeConfig(goDir, {
        contractType: "rest-owned",
        governanceLevel: "L2",
        language: "go",
        buildTool: "go",
      });
      expect(generateContractTesting(config).files).toHaveLength(4);
    } finally {
      cleanupTestProject(goDir);
    }
  });

  it("generates tests/pact_consumer_test.go for rest-owned + go", () => {
    const goDir = createTestProject("go");
    initGit(goDir);
    try {
      const config = makeConfig(goDir, {
        contractType: "rest-owned",
        governanceLevel: "L2",
        language: "go",
        buildTool: "go",
      });
      generateContractTesting(config);
      expect(existsSync(join(goDir, "tests", "pact_consumer_test.go"))).toBe(
        true,
      );
    } finally {
      cleanupTestProject(goDir);
    }
  });

  // ─── rest-owned × python: 2 files ────────────────────────────────────────

  it("returns 4 files for rest-owned + python (.env.pact + pacts/.gitkeep added)", () => {
    const pyDir = createTestProject("python");
    initGit(pyDir);
    try {
      const config = makeConfig(pyDir, {
        contractType: "rest-owned",
        governanceLevel: "L2",
        language: "python",
        buildTool: "pip",
      });
      expect(generateContractTesting(config).files).toHaveLength(4);
    } finally {
      cleanupTestProject(pyDir);
    }
  });

  it("generates tests/contract/test_pact_consumer.py for rest-owned + python (F17)", () => {
    const pyDir = createTestProject("python");
    initGit(pyDir);
    try {
      const config = makeConfig(pyDir, {
        contractType: "rest-owned",
        governanceLevel: "L2",
        language: "python",
        buildTool: "pip",
      });
      generateContractTesting(config);
      expect(
        existsSync(join(pyDir, "tests", "contract", "test_pact_consumer.py")),
      ).toBe(true);
    } finally {
      cleanupTestProject(pyDir);
    }
  });

  // ─── rest-public × all languages ─────────────────────────────────────────

  it("returns 2 files for rest-public + typescript", () => {
    const config = makeConfig(dir, {
      contractType: "rest-public",
      governanceLevel: "L2",
      language: "typescript",
    });
    expect(generateContractTesting(config).files).toHaveLength(2);
  });

  it("generates src/test/contracts/openapi-diff.ts for rest-public + typescript", () => {
    const config = makeConfig(dir, {
      contractType: "rest-public",
      governanceLevel: "L2",
      language: "typescript",
    });
    generateContractTesting(config);
    expect(
      existsSync(join(dir, "src", "test", "contracts", "openapi-diff.ts")),
    ).toBe(true);
  });

  it("returns 2 files for rest-public + java", () => {
    const javaDir = createTestProject("java");
    initGit(javaDir);
    try {
      const config = makeConfig(javaDir, {
        contractType: "rest-public",
        governanceLevel: "L2",
        language: "java",
        buildTool: "gradle",
      });
      expect(generateContractTesting(config).files).toHaveLength(2);
    } finally {
      cleanupTestProject(javaDir);
    }
  });

  it("generates OpenApiDiffIT.java for rest-public + java (no basePackage)", () => {
    const javaDir = createTestProject("java");
    initGit(javaDir);
    try {
      const config = makeConfig(javaDir, {
        contractType: "rest-public",
        governanceLevel: "L2",
        language: "java",
        buildTool: "gradle",
      });
      generateContractTesting(config);
      expect(
        existsSync(
          join(
            javaDir,
            "src",
            "test",
            "java",
            "contracts",
            "OpenApiDiffIT.java",
          ),
        ),
      ).toBe(true);
    } finally {
      cleanupTestProject(javaDir);
    }
  });

  it("returns 2 files for rest-public + rust", () => {
    const rustDir = createTestProject("rust");
    initGit(rustDir);
    try {
      const config = makeConfig(rustDir, {
        contractType: "rest-public",
        governanceLevel: "L2",
        language: "rust",
        buildTool: "cargo",
      });
      const result = generateContractTesting(config);
      expect(result.files).toHaveLength(2);
      expect(existsSync(join(rustDir, "tests", "openapi_diff_test.rs"))).toBe(
        true,
      );
      expect(existsSync(join(rustDir, "CONTRACTS_POLICY.md"))).toBe(true);
    } finally {
      cleanupTestProject(rustDir);
    }
  });

  it("returns 2 files for rest-public + go", () => {
    const goDir = createTestProject("go");
    initGit(goDir);
    try {
      const config = makeConfig(goDir, {
        contractType: "rest-public",
        governanceLevel: "L2",
        language: "go",
        buildTool: "go",
      });
      const result = generateContractTesting(config);
      expect(result.files).toHaveLength(2);
      expect(existsSync(join(goDir, "tests", "openapi_diff_test.go"))).toBe(
        true,
      );
      expect(existsSync(join(goDir, "CONTRACTS_POLICY.md"))).toBe(true);
    } finally {
      cleanupTestProject(goDir);
    }
  });

  it("returns 2 files for rest-public + python", () => {
    const pyDir = createTestProject("python");
    initGit(pyDir);
    try {
      const config = makeConfig(pyDir, {
        contractType: "rest-public",
        governanceLevel: "L2",
        language: "python",
        buildTool: "pip",
      });
      const result = generateContractTesting(config);
      expect(result.files).toHaveLength(2);
      expect(
        existsSync(join(pyDir, "tests", "contract", "test_openapi_diff.py")),
      ).toBe(true);
      expect(existsSync(join(pyDir, "CONTRACTS_POLICY.md"))).toBe(true);
    } finally {
      cleanupTestProject(pyDir);
    }
  });

  it("generates OpenApiDiffIT.java at fallback path for rest-public + java (no basePackage, count check)", () => {
    const javaDir = createTestProject("java");
    initGit(javaDir);
    try {
      const config = makeConfig(javaDir, {
        contractType: "rest-public",
        governanceLevel: "L2",
        language: "java",
        buildTool: "gradle",
      });
      const result = generateContractTesting(config);
      expect(result.files).toHaveLength(2);
      expect(
        existsSync(
          join(
            javaDir,
            "src",
            "test",
            "java",
            "contracts",
            "OpenApiDiffIT.java",
          ),
        ),
      ).toBe(true);
    } finally {
      cleanupTestProject(javaDir);
    }
  });

  // ─── graphql × all languages ──────────────────────────────────────────────

  it("returns 2 files for graphql + typescript", () => {
    const config = makeConfig(dir, {
      contractType: "graphql",
      governanceLevel: "L2",
      language: "typescript",
    });
    expect(generateContractTesting(config).files).toHaveLength(2);
  });

  it("generates src/test/contracts/graphql-inspector.test.ts for graphql + typescript", () => {
    const config = makeConfig(dir, {
      contractType: "graphql",
      governanceLevel: "L2",
      language: "typescript",
    });
    generateContractTesting(config);
    expect(
      existsSync(
        join(dir, "src", "test", "contracts", "graphql-inspector.test.ts"),
      ),
    ).toBe(true);
  });

  it("returns 2 files for graphql + java", () => {
    const javaDir = createTestProject("java");
    initGit(javaDir);
    try {
      const config = makeConfig(javaDir, {
        contractType: "graphql",
        governanceLevel: "L2",
        language: "java",
        buildTool: "gradle",
      });
      const result = generateContractTesting(config);
      expect(result.files).toHaveLength(2);
      expect(
        existsSync(
          join(
            javaDir,
            "src",
            "test",
            "java",
            "contracts",
            "GraphqlSchemaTest.java",
          ),
        ),
      ).toBe(true);
    } finally {
      cleanupTestProject(javaDir);
    }
  });

  it("returns 2 files for graphql + rust", () => {
    const rustDir = createTestProject("rust");
    initGit(rustDir);
    try {
      const config = makeConfig(rustDir, {
        contractType: "graphql",
        governanceLevel: "L2",
        language: "rust",
        buildTool: "cargo",
      });
      const result = generateContractTesting(config);
      expect(result.files).toHaveLength(2);
      expect(existsSync(join(rustDir, "tests", "graphql_schema_test.rs"))).toBe(
        true,
      );
      expect(existsSync(join(rustDir, "CONTRACTS_POLICY.md"))).toBe(true);
    } finally {
      cleanupTestProject(rustDir);
    }
  });

  it("returns 2 files for graphql + go", () => {
    const goDir = createTestProject("go");
    initGit(goDir);
    try {
      const config = makeConfig(goDir, {
        contractType: "graphql",
        governanceLevel: "L2",
        language: "go",
        buildTool: "go",
      });
      const result = generateContractTesting(config);
      expect(result.files).toHaveLength(2);
      expect(existsSync(join(goDir, "tests", "graphql_schema_test.go"))).toBe(
        true,
      );
      expect(existsSync(join(goDir, "CONTRACTS_POLICY.md"))).toBe(true);
    } finally {
      cleanupTestProject(goDir);
    }
  });

  it("returns 2 files for graphql + python", () => {
    const pyDir = createTestProject("python");
    initGit(pyDir);
    try {
      const config = makeConfig(pyDir, {
        contractType: "graphql",
        governanceLevel: "L2",
        language: "python",
        buildTool: "pip",
      });
      const result = generateContractTesting(config);
      expect(result.files).toHaveLength(2);
      expect(
        existsSync(join(pyDir, "tests", "contract", "test_graphql_schema.py")),
      ).toBe(true);
      expect(existsSync(join(pyDir, "CONTRACTS_POLICY.md"))).toBe(true);
    } finally {
      cleanupTestProject(pyDir);
    }
  });

  // ─── grpc × all languages: 4 files each ──────────────────────────────────

  it("returns 4 files for grpc + typescript", () => {
    const config = makeConfig(dir, {
      contractType: "grpc",
      governanceLevel: "L2",
      language: "typescript",
    });
    expect(generateContractTesting(config).files).toHaveLength(4);
  });

  it("generates proto/buf.yaml for grpc + typescript", () => {
    const config = makeConfig(dir, {
      contractType: "grpc",
      governanceLevel: "L2",
      language: "typescript",
    });
    generateContractTesting(config);
    expect(existsSync(join(dir, "proto", "buf.yaml"))).toBe(true);
  });

  it("generates proto/buf-breaking.yml for grpc + typescript", () => {
    const config = makeConfig(dir, {
      contractType: "grpc",
      governanceLevel: "L2",
      language: "typescript",
    });
    generateContractTesting(config);
    expect(existsSync(join(dir, "proto", "buf-breaking.yml"))).toBe(true);
  });

  it("generates src/test/contracts/grpc-contract.test.ts for grpc + typescript", () => {
    const config = makeConfig(dir, {
      contractType: "grpc",
      governanceLevel: "L2",
      language: "typescript",
    });
    generateContractTesting(config);
    expect(
      existsSync(
        join(dir, "src", "test", "contracts", "grpc-contract.test.ts"),
      ),
    ).toBe(true);
  });

  it("returns 4 files for grpc + java", () => {
    const javaDir = createTestProject("java");
    initGit(javaDir);
    try {
      const config = makeConfig(javaDir, {
        contractType: "grpc",
        governanceLevel: "L2",
        language: "java",
        buildTool: "gradle",
      });
      const result = generateContractTesting(config);
      expect(result.files).toHaveLength(4);
      expect(
        existsSync(
          join(
            javaDir,
            "src",
            "test",
            "java",
            "contracts",
            "GrpcContractTest.java",
          ),
        ),
      ).toBe(true);
    } finally {
      cleanupTestProject(javaDir);
    }
  });

  it("returns 4 files for grpc + rust", () => {
    const rustDir = createTestProject("rust");
    initGit(rustDir);
    try {
      const config = makeConfig(rustDir, {
        contractType: "grpc",
        governanceLevel: "L2",
        language: "rust",
        buildTool: "cargo",
      });
      const result = generateContractTesting(config);
      expect(result.files).toHaveLength(4);
      expect(existsSync(join(rustDir, "tests", "grpc_contract_test.rs"))).toBe(
        true,
      );
      expect(existsSync(join(rustDir, "CONTRACTS_POLICY.md"))).toBe(true);
    } finally {
      cleanupTestProject(rustDir);
    }
  });

  it("returns 4 files for grpc + go", () => {
    const goDir = createTestProject("go");
    initGit(goDir);
    try {
      const config = makeConfig(goDir, {
        contractType: "grpc",
        governanceLevel: "L2",
        language: "go",
        buildTool: "go",
      });
      const result = generateContractTesting(config);
      expect(result.files).toHaveLength(4);
      expect(existsSync(join(goDir, "tests", "grpc_contract_test.go"))).toBe(
        true,
      );
      expect(existsSync(join(goDir, "CONTRACTS_POLICY.md"))).toBe(true);
    } finally {
      cleanupTestProject(goDir);
    }
  });

  it("returns 4 files for grpc + python", () => {
    const pyDir = createTestProject("python");
    initGit(pyDir);
    try {
      const config = makeConfig(pyDir, {
        contractType: "grpc",
        governanceLevel: "L2",
        language: "python",
        buildTool: "pip",
      });
      const result = generateContractTesting(config);
      expect(result.files).toHaveLength(4);
      expect(
        existsSync(join(pyDir, "tests", "contract", "test_grpc_contract.py")),
      ).toBe(true);
      expect(existsSync(join(pyDir, "CONTRACTS_POLICY.md"))).toBe(true);
    } finally {
      cleanupTestProject(pyDir);
    }
  });

  // ─── message-queue × all languages ───────────────────────────────────────

  it("returns 2 files for message-queue + typescript", () => {
    const config = makeConfig(dir, {
      contractType: "message-queue",
      governanceLevel: "L2",
      language: "typescript",
    });
    expect(generateContractTesting(config).files).toHaveLength(2);
  });

  it("generates src/test/contracts/schema-registry-check.ts for message-queue + typescript", () => {
    const config = makeConfig(dir, {
      contractType: "message-queue",
      governanceLevel: "L2",
      language: "typescript",
    });
    generateContractTesting(config);
    expect(
      existsSync(
        join(dir, "src", "test", "contracts", "schema-registry-check.ts"),
      ),
    ).toBe(true);
  });

  it("returns 2 files for message-queue + java", () => {
    const javaDir = createTestProject("java");
    initGit(javaDir);
    try {
      const config = makeConfig(javaDir, {
        contractType: "message-queue",
        governanceLevel: "L2",
        language: "java",
        buildTool: "gradle",
      });
      const result = generateContractTesting(config);
      expect(result.files).toHaveLength(2);
      expect(
        existsSync(
          join(
            javaDir,
            "src",
            "test",
            "java",
            "contracts",
            "SchemaRegistryCheckIT.java",
          ),
        ),
      ).toBe(true);
    } finally {
      cleanupTestProject(javaDir);
    }
  });

  it("returns 2 files for message-queue + rust", () => {
    const rustDir = createTestProject("rust");
    initGit(rustDir);
    try {
      const config = makeConfig(rustDir, {
        contractType: "message-queue",
        governanceLevel: "L2",
        language: "rust",
        buildTool: "cargo",
      });
      const result = generateContractTesting(config);
      expect(result.files).toHaveLength(2);
      expect(
        existsSync(join(rustDir, "tests", "schema_registry_test.rs")),
      ).toBe(true);
      expect(existsSync(join(rustDir, "CONTRACTS_POLICY.md"))).toBe(true);
    } finally {
      cleanupTestProject(rustDir);
    }
  });

  it("returns 2 files for message-queue + go", () => {
    const goDir = createTestProject("go");
    initGit(goDir);
    try {
      const config = makeConfig(goDir, {
        contractType: "message-queue",
        governanceLevel: "L2",
        language: "go",
        buildTool: "go",
      });
      const result = generateContractTesting(config);
      expect(result.files).toHaveLength(2);
      expect(existsSync(join(goDir, "tests", "schema_registry_test.go"))).toBe(
        true,
      );
      expect(existsSync(join(goDir, "CONTRACTS_POLICY.md"))).toBe(true);
    } finally {
      cleanupTestProject(goDir);
    }
  });

  it("returns 2 files for message-queue + python", () => {
    const pyDir = createTestProject("python");
    initGit(pyDir);
    try {
      const config = makeConfig(pyDir, {
        contractType: "message-queue",
        governanceLevel: "L2",
        language: "python",
        buildTool: "pip",
      });
      const result = generateContractTesting(config);
      expect(result.files).toHaveLength(2);
      expect(
        existsSync(join(pyDir, "tests", "contract", "test_schema_registry.py")),
      ).toBe(true);
      expect(existsSync(join(pyDir, "CONTRACTS_POLICY.md"))).toBe(true);
    } finally {
      cleanupTestProject(pyDir);
    }
  });

  // ─── Brownfield / skipIfExists (CANON-11) ────────────────────────────────

  it("skips CONTRACTS_POLICY.md when it already exists (brownfield)", () => {
    // Pre-write the file with sentinel content
    const policyPath = join(dir, "CONTRACTS_POLICY.md");
    writeFileSync(policyPath, "existing content", "utf-8");

    const config = makeConfig(dir, {
      contractType: "rest-owned",
      governanceLevel: "L2",
      language: "typescript",
    });
    const result = generateContractTesting(config);

    // Policy file should be first in results
    const policyResult = result.files.find((f) => f.path === policyPath);
    expect(policyResult).toBeDefined();
    expect(policyResult!.action).toBe("skipped");

    // Content should be unchanged
    expect(readFileSync(policyPath, "utf-8")).toBe("existing content");
  });

  it("skips language-specific file when it already exists (brownfield)", () => {
    const contractDir = join(dir, "src", "test", "contracts");
    mkdirSync(contractDir, { recursive: true });
    const testPath = join(contractDir, "pact-consumer.test.ts");
    writeFileSync(testPath, "existing pact content", "utf-8");

    const config = makeConfig(dir, {
      contractType: "rest-owned",
      governanceLevel: "L2",
      language: "typescript",
    });
    const result = generateContractTesting(config);

    const skippedResult = result.files.find((f) => f.path === testPath);
    expect(skippedResult).toBeDefined();
    expect(skippedResult!.action).toBe("skipped");

    // Content should be unchanged
    expect(readFileSync(testPath, "utf-8")).toBe("existing pact content");
  });

  // ─── No cross-language file bleed ────────────────────────────────────────

  it("does not emit java files for typescript (rest-owned)", () => {
    const config = makeConfig(dir, {
      contractType: "rest-owned",
      governanceLevel: "L2",
      language: "typescript",
    });
    generateContractTesting(config);
    expect(
      existsSync(
        join(
          dir,
          "src",
          "test",
          "java",
          "contracts",
          "PactVerificationIT.java",
        ),
      ),
    ).toBe(false);
    expect(existsSync(join(dir, "config", "pact-deps.gradle"))).toBe(false);
  });

  it("does not emit typescript files for rust (rest-owned)", () => {
    const rustDir = createTestProject("rust");
    initGit(rustDir);
    try {
      const config = makeConfig(rustDir, {
        contractType: "rest-owned",
        governanceLevel: "L2",
        language: "rust",
        buildTool: "cargo",
      });
      generateContractTesting(config);
      expect(
        existsSync(
          join(rustDir, "src", "test", "contracts", "pact-consumer.test.ts"),
        ),
      ).toBe(false);
    } finally {
      cleanupTestProject(rustDir);
    }
  });

  it("does not emit buf files for rest-owned", () => {
    const config = makeConfig(dir, {
      contractType: "rest-owned",
      governanceLevel: "L2",
      language: "typescript",
    });
    generateContractTesting(config);
    expect(existsSync(join(dir, "proto", "buf.yaml"))).toBe(false);
    expect(existsSync(join(dir, "proto", "buf-breaking.yml"))).toBe(false);
  });
});
