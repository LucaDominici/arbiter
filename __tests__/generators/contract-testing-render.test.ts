import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";

/**
 * CANON-04 compliance: every .ejs template in src/templates/contract-testing/
 * must appear in at least one test with a concrete string assertion.
 * 29 templates → ≥29 test cases.
 */

const baseData = {
  projectName: "my-project",
  contractType: "rest-owned",
  language: "typescript",
  governanceLevel: "L2",
  basePackage: "com.example",
};

// ─── CONTRACTS_POLICY.md.ejs (1 template, 5 contractType branches) ───────────

describe("contract-testing render: CONTRACTS_POLICY.md.ejs", () => {
  it("rest-owned: contains 'Pact'", () => {
    const content = renderTemplate("contract-testing/CONTRACTS_POLICY.md.ejs", {
      ...baseData,
      contractType: "rest-owned",
    });
    expect(content).toContain("Pact");
  });

  it("rest-public: contains 'openapi-diff'", () => {
    const content = renderTemplate("contract-testing/CONTRACTS_POLICY.md.ejs", {
      ...baseData,
      contractType: "rest-public",
    });
    expect(content).toContain("openapi-diff");
  });

  it("graphql: contains 'graphql-inspector'", () => {
    const content = renderTemplate("contract-testing/CONTRACTS_POLICY.md.ejs", {
      ...baseData,
      contractType: "graphql",
    });
    expect(content).toContain("graphql-inspector");
  });

  it("grpc: contains 'buf'", () => {
    const content = renderTemplate("contract-testing/CONTRACTS_POLICY.md.ejs", {
      ...baseData,
      contractType: "grpc",
    });
    expect(content).toContain("buf");
  });

  it("message-queue: contains 'Schema Registry'", () => {
    const content = renderTemplate("contract-testing/CONTRACTS_POLICY.md.ejs", {
      ...baseData,
      contractType: "message-queue",
    });
    expect(content).toContain("Schema Registry");
  });
});

// ─── rest-owned templates (6 templates) ──────────────────────────────────────

describe("contract-testing render: rest-owned", () => {
  it("pact-consumer.test.ts.ejs: contains '@pact-foundation/pact'", () => {
    const content = renderTemplate(
      "contract-testing/rest-owned/pact-consumer.test.ts.ejs",
      { ...baseData, contractType: "rest-owned" },
    );
    expect(content).toContain("@pact-foundation/pact");
  });

  it("pact-consumer.test.ts.ejs: contains projectName interpolation 'my-project'", () => {
    const content = renderTemplate(
      "contract-testing/rest-owned/pact-consumer.test.ts.ejs",
      { ...baseData, contractType: "rest-owned" },
    );
    expect(content).toContain("my-project");
  });

  it("PactVerificationIT.java.ejs: contains 'au.com.dius.pact'", () => {
    const content = renderTemplate(
      "contract-testing/rest-owned/PactVerificationIT.java.ejs",
      { ...baseData, contractType: "rest-owned" },
    );
    expect(content).toContain("au.com.dius.pact");
  });

  it("PactVerificationIT.java.ejs: contains basePackage interpolation 'com.example'", () => {
    const content = renderTemplate(
      "contract-testing/rest-owned/PactVerificationIT.java.ejs",
      { ...baseData, contractType: "rest-owned" },
    );
    expect(content).toContain("com.example");
  });

  it("pact-deps.gradle.ejs: contains 'au.com.dius.pact.provider'", () => {
    const content = renderTemplate(
      "contract-testing/rest-owned/pact-deps.gradle.ejs",
      { ...baseData, contractType: "rest-owned" },
    );
    expect(content).toContain("au.com.dius.pact.provider");
  });

  it("pact_consumer_test.rs.ejs: contains 'pact_consumer'", () => {
    const content = renderTemplate(
      "contract-testing/rest-owned/pact_consumer_test.rs.ejs",
      { ...baseData, contractType: "rest-owned" },
    );
    expect(content).toContain("pact_consumer");
  });

  it("pact_consumer_test.go.ejs: contains 'pact-foundation/pact-go'", () => {
    const content = renderTemplate(
      "contract-testing/rest-owned/pact_consumer_test.go.ejs",
      { ...baseData, contractType: "rest-owned" },
    );
    expect(content).toContain("pact-foundation/pact-go");
  });

  it("test_pact_consumer.py.ejs: contains 'pact'", () => {
    const content = renderTemplate(
      "contract-testing/rest-owned/test_pact_consumer.py.ejs",
      { ...baseData, contractType: "rest-owned" },
    );
    expect(content.includes("pact-python") || content.includes("pact")).toBe(
      true,
    );
  });
});

// ─── rest-public templates (5 templates) ─────────────────────────────────────

describe("contract-testing render: rest-public", () => {
  it("openapi-diff.ts.ejs: contains 'openapi-diff'", () => {
    const content = renderTemplate(
      "contract-testing/rest-public/openapi-diff.ts.ejs",
      { ...baseData, contractType: "rest-public" },
    );
    expect(content).toContain("openapi-diff");
  });

  it("OpenApiDiffIT.java.ejs: contains 'openapi-diff' or 'openapidiff'", () => {
    const content = renderTemplate(
      "contract-testing/rest-public/OpenApiDiffIT.java.ejs",
      { ...baseData, contractType: "rest-public" },
    );
    expect(
      content.includes("openapi-diff") || content.includes("openapidiff"),
    ).toBe(true);
  });

  it("openapi_diff_test.rs.ejs: contains 'openapi-diff'", () => {
    const content = renderTemplate(
      "contract-testing/rest-public/openapi_diff_test.rs.ejs",
      { ...baseData, contractType: "rest-public" },
    );
    expect(content).toContain("openapi-diff");
  });

  it("openapi_diff_test.go.ejs: contains 'openapi-diff'", () => {
    const content = renderTemplate(
      "contract-testing/rest-public/openapi_diff_test.go.ejs",
      { ...baseData, contractType: "rest-public" },
    );
    expect(content).toContain("openapi-diff");
  });

  it("test_openapi_diff.py.ejs: contains 'openapi-diff'", () => {
    const content = renderTemplate(
      "contract-testing/rest-public/test_openapi_diff.py.ejs",
      { ...baseData, contractType: "rest-public" },
    );
    expect(content).toContain("openapi-diff");
  });

  // F6/INV-43: no-silent-skip — all 5 diff templates must hard-fail when files missing
  it("openapi-diff.ts.ejs: hard-fails when files missing (no silent skip) — INV-43", () => {
    const content = renderTemplate(
      "contract-testing/rest-public/openapi-diff.ts.ejs",
      { ...baseData, contractType: "rest-public" },
    );
    expect(content).toContain("ALLOW_OPENAPI_BOOTSTRAP");
  });

  it("OpenApiDiffIT.java.ejs: hard-fails when files missing (no silent skip) — INV-43", () => {
    const content = renderTemplate(
      "contract-testing/rest-public/OpenApiDiffIT.java.ejs",
      { ...baseData, contractType: "rest-public" },
    );
    expect(content).toContain("ALLOW_OPENAPI_BOOTSTRAP");
  });

  it("openapi_diff_test.go.ejs: hard-fails when files missing (no t.Skip) — INV-43", () => {
    const content = renderTemplate(
      "contract-testing/rest-public/openapi_diff_test.go.ejs",
      { ...baseData, contractType: "rest-public" },
    );
    expect(content).toContain("ALLOW_OPENAPI_BOOTSTRAP");
    expect(content).not.toContain("t.Skip(");
  });

  it("test_openapi_diff.py.ejs: hard-fails when files missing (no skipif) — INV-43", () => {
    const content = renderTemplate(
      "contract-testing/rest-public/test_openapi_diff.py.ejs",
      { ...baseData, contractType: "rest-public" },
    );
    expect(content).toContain("ALLOW_OPENAPI_BOOTSTRAP");
    expect(content).not.toContain("pytest.mark.skipif");
  });

  it("openapi_diff_test.rs.ejs: hard-fails when files missing (no silent return) — INV-43", () => {
    const content = renderTemplate(
      "contract-testing/rest-public/openapi_diff_test.rs.ejs",
      { ...baseData, contractType: "rest-public" },
    );
    expect(content).toContain("ALLOW_OPENAPI_BOOTSTRAP");
  });
});

// ─── rest-public exporters (F6/INV-43) ───────────────────────────────────────

describe("contract-testing render: rest-public exporters", () => {
  it("export-openapi.mjs.ejs: renders and writes openapi-current.yaml", () => {
    const content = renderTemplate(
      "contract-testing/rest-public/export-openapi.mjs.ejs",
      { ...baseData, contractType: "rest-public" },
    );
    expect(content).toContain("openapi-current.yaml");
  });

  it("export-openapi-java.gradle.ejs: renders and targets openapi-current.yaml", () => {
    const content = renderTemplate(
      "contract-testing/rest-public/export-openapi-java.gradle.ejs",
      { ...baseData, contractType: "rest-public" },
    );
    expect(content).toContain("openapi-current.yaml");
  });

  it("export_openapi.py.ejs: renders FastAPI exporter writing openapi-current.yaml", () => {
    const content = renderTemplate(
      "contract-testing/rest-public/export_openapi.py.ejs",
      { ...baseData, contractType: "rest-public" },
    );
    expect(content).toContain("openapi-current.yaml");
  });

  it("export_openapi.go.ejs: renders Go exporter writing openapi-current.yaml", () => {
    const content = renderTemplate(
      "contract-testing/rest-public/export_openapi.go.ejs",
      { ...baseData, contractType: "rest-public" },
    );
    expect(content).toContain("openapi-current.yaml");
  });

  it("export_openapi.rs.ejs: renders Rust exporter writing openapi-current.yaml", () => {
    const content = renderTemplate(
      "contract-testing/rest-public/export_openapi.rs.ejs",
      { ...baseData, contractType: "rest-public" },
    );
    expect(content).toContain("openapi-current.yaml");
  });
});

// ─── graphql templates (5 templates) ─────────────────────────────────────────

describe("contract-testing render: graphql", () => {
  it("graphql-inspector.test.ts.ejs: contains 'graphql-inspector'", () => {
    const content = renderTemplate(
      "contract-testing/graphql/graphql-inspector.test.ts.ejs",
      { ...baseData, contractType: "graphql" },
    );
    expect(content).toContain("graphql-inspector");
  });

  it("GraphqlSchemaTest.java.ejs: uses @graphql-inspector/cli via ProcessBuilder (F4/INV parity)", () => {
    const content = renderTemplate(
      "contract-testing/graphql/GraphqlSchemaTest.java.ejs",
      { ...baseData, contractType: "graphql" },
    );
    expect(content).toContain("@graphql-inspector/cli");
    expect(content).toContain("ProcessBuilder");
    expect(content).toContain("schema-reference.graphql");
    expect(content).toContain("schema-current.graphql");
  });

  it("graphql_schema_test.rs.ejs: contains 'graphql-inspector'", () => {
    const content = renderTemplate(
      "contract-testing/graphql/graphql_schema_test.rs.ejs",
      { ...baseData, contractType: "graphql" },
    );
    expect(content).toContain("graphql-inspector");
  });

  it("graphql_schema_test.go.ejs: contains 'graphql-inspector'", () => {
    const content = renderTemplate(
      "contract-testing/graphql/graphql_schema_test.go.ejs",
      { ...baseData, contractType: "graphql" },
    );
    expect(content).toContain("graphql-inspector");
  });

  it("test_graphql_schema.py.ejs: contains 'graphql-inspector'", () => {
    const content = renderTemplate(
      "contract-testing/graphql/test_graphql_schema.py.ejs",
      { ...baseData, contractType: "graphql" },
    );
    expect(content).toContain("graphql-inspector");
  });
});

// ─── grpc templates (7 templates) ────────────────────────────────────────────

describe("contract-testing render: grpc", () => {
  it("buf.yaml.ejs: contains 'version: v2'", () => {
    const content = renderTemplate("contract-testing/grpc/buf.yaml.ejs", {
      ...baseData,
      contractType: "grpc",
    });
    expect(content).toContain("version: v2");
  });

  it("buf-breaking.yml.ejs: contains 'FILE'", () => {
    const content = renderTemplate(
      "contract-testing/grpc/buf-breaking.yml.ejs",
      { ...baseData, contractType: "grpc" },
    );
    expect(content).toContain("FILE");
  });

  it("grpc-contract.test.ts.ejs: contains 'buf'", () => {
    const content = renderTemplate(
      "contract-testing/grpc/grpc-contract.test.ts.ejs",
      { ...baseData, contractType: "grpc" },
    );
    expect(content).toContain("buf");
  });

  it("GrpcContractTest.java.ejs: contains 'buf'", () => {
    const content = renderTemplate(
      "contract-testing/grpc/GrpcContractTest.java.ejs",
      { ...baseData, contractType: "grpc" },
    );
    expect(content).toContain("buf");
  });

  it("grpc_contract_test.rs.ejs: contains 'buf'", () => {
    const content = renderTemplate(
      "contract-testing/grpc/grpc_contract_test.rs.ejs",
      { ...baseData, contractType: "grpc" },
    );
    expect(content).toContain("buf");
  });

  it("grpc_contract_test.go.ejs: contains 'buf'", () => {
    const content = renderTemplate(
      "contract-testing/grpc/grpc_contract_test.go.ejs",
      { ...baseData, contractType: "grpc" },
    );
    expect(content).toContain("buf");
  });

  it("test_grpc_contract.py.ejs: contains 'buf'", () => {
    const content = renderTemplate(
      "contract-testing/grpc/test_grpc_contract.py.ejs",
      { ...baseData, contractType: "grpc" },
    );
    expect(content).toContain("buf");
  });
});

// ─── F5 (#364): Pact broker env-gate + argv split (INV-42) ──────────────────

describe("contract-testing render: F5 Pact broker glue (INV-42)", () => {
  it("pact-deps.gradle.ejs: contains PACT_BROKER_BASE_URL system property", () => {
    const content = renderTemplate(
      "contract-testing/rest-owned/pact-deps.gradle.ejs",
      { ...baseData, language: "java", buildTool: "gradle" },
    );
    expect(content).toContain("PACT_BROKER_BASE_URL");
  });

  it("pact-deps.gradle.ejs: contains pact.broker.url system property config", () => {
    const content = renderTemplate(
      "contract-testing/rest-owned/pact-deps.gradle.ejs",
      { ...baseData, language: "java", buildTool: "gradle" },
    );
    expect(content).toContain("pact.broker.url");
  });

  it("check-all.mjs.ejs Java Gradle rest-owned: argv has 'pactPublish' and 'pactVerify' as separate elements", () => {
    const data = makeConfig("/tmp/test", {
      language: "java",
      buildTool: "gradle",
      governanceLevel: "L2",
      contractType: "rest-owned",
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("scripts/check-all.mjs.ejs", data);
    expect(content).toContain("'pactPublish'");
    expect(content).toContain("'pactVerify'");
    expect(content).not.toContain("'pactPublish pactVerify'");
  });

  it("check-all.mjs.ejs TypeScript rest-owned: has PACT_BROKER_BASE_URL env-gate", () => {
    const data = makeConfig("/tmp/test", {
      language: "typescript",
      buildTool: "npm",
      governanceLevel: "L2",
      contractType: "rest-owned",
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("scripts/check-all.mjs.ejs", data);
    expect(content).toContain("PACT_BROKER_BASE_URL");
  });

  it(".env.pact.ejs: renders PACT_BROKER_BASE_URL and PACT_BROKER_TOKEN placeholders", () => {
    const content = renderTemplate("contract-testing/env/.env.pact.ejs", {
      ...baseData,
    });
    expect(content).toContain("PACT_BROKER_BASE_URL=");
    expect(content).toContain("PACT_BROKER_TOKEN=");
  });

  it("ci.yml.ejs TS rest-owned: Pact step has PACT_BROKER_BASE_URL conditional", () => {
    const data = makeConfig("/tmp/test", {
      language: "typescript",
      buildTool: "npm",
      governanceLevel: "L2",
      contractType: "rest-owned",
      useGitHub: true,
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("github/workflows/ci.yml.ejs", data);
    expect(content).toContain("PACT_BROKER_BASE_URL");
  });
});

// ─── message-queue templates (5 templates) ───────────────────────────────────

describe("contract-testing render: message-queue", () => {
  it("schema-registry-check.ts.ejs: calls testCompatibility (F3/INV-41)", () => {
    const content = renderTemplate(
      "contract-testing/message-queue/schema-registry-check.ts.ejs",
      { ...baseData, contractType: "message-queue" },
    );
    expect(content).toContain("testCompatibility");
  });

  it("schema-registry-check.ts.ejs: asserts BACKWARD or FULL compat level", () => {
    const content = renderTemplate(
      "contract-testing/message-queue/schema-registry-check.ts.ejs",
      { ...baseData, contractType: "message-queue" },
    );
    expect(content.includes("BACKWARD") || content.includes("FULL")).toBe(true);
  });

  it("SchemaRegistryCheckIT.java.ejs: calls testCompatibility (F3/INV-41)", () => {
    const content = renderTemplate(
      "contract-testing/message-queue/SchemaRegistryCheckIT.java.ejs",
      { ...baseData, contractType: "message-queue" },
    );
    expect(content).toContain("testCompatibility");
  });

  it("SchemaRegistryCheckIT.java.ejs: asserts BACKWARD or FULL compat level", () => {
    const content = renderTemplate(
      "contract-testing/message-queue/SchemaRegistryCheckIT.java.ejs",
      { ...baseData, contractType: "message-queue" },
    );
    expect(content.includes("BACKWARD") || content.includes("FULL")).toBe(true);
  });

  it("schema_registry_test.rs.ejs: calls post_schema_compatibility (F3/INV-41)", () => {
    const content = renderTemplate(
      "contract-testing/message-queue/schema_registry_test.rs.ejs",
      { ...baseData, contractType: "message-queue" },
    );
    expect(content).toContain("compatibility");
  });

  it("schema_registry_test.go.ejs: POSTs to /compatibility/ endpoint (F3/INV-41)", () => {
    const content = renderTemplate(
      "contract-testing/message-queue/schema_registry_test.go.ejs",
      { ...baseData, contractType: "message-queue" },
    );
    expect(content).toContain("/compatibility/");
  });

  it("test_schema_registry.py.ejs: calls test_compatibility (F3/INV-41)", () => {
    const content = renderTemplate(
      "contract-testing/message-queue/test_schema_registry.py.ejs",
      { ...baseData, contractType: "message-queue" },
    );
    expect(content).toContain("test_compatibility");
  });

  it("check-all.mjs.ejs TS message-queue: wired to Schema Registry not Pact", () => {
    const data = makeConfig("/tmp/test", {
      language: "typescript",
      buildTool: "npm",
      governanceLevel: "L2",
      contractType: "message-queue",
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("scripts/check-all.mjs.ejs", data);
    expect(content).toContain("Schema Registry");
    expect(content).not.toContain("Pact messaging");
  });
});

// F17 — Go build tags and Python path fixes (#376)
describe("contract-testing template fixes (F17)", () => {
  const baseData = {
    projectName: "test-project",
    language: "go",
    governanceLevel: "L2",
  };

  const goTemplates = [
    "contract-testing/rest-owned/pact_consumer_test.go.ejs",
    "contract-testing/rest-public/openapi_diff_test.go.ejs",
    "contract-testing/graphql/graphql_schema_test.go.ejs",
    "contract-testing/grpc/grpc_contract_test.go.ejs",
    "contract-testing/message-queue/schema_registry_test.go.ejs",
  ];

  for (const tmpl of goTemplates) {
    it(`${tmpl} starts with //go:build contract`, () => {
      const content = renderTemplate(tmpl, {
        ...baseData,
        contractType: tmpl.split("/")[1],
      });
      expect(content.trimStart()).toMatch(/^\/\/go:build contract/);
    });
  }
});
