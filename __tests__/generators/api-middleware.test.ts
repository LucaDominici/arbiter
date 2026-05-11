import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  createTestProject,
  initGit,
  cleanupTestProject,
  makeConfig,
} from "../helpers.js";
import { generateApiMiddleware } from "../../src/generators/api-middleware.js";

describe("generateApiMiddleware (#215)", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject("typescript");
    initGit(dir);
  });

  afterEach(() => {
    cleanupTestProject(dir);
  });

  it("returns empty when hasPublicApi is false", () => {
    const config = makeConfig(dir, { hasPublicApi: false });
    const result = generateApiMiddleware(config);
    expect(result.files).toHaveLength(0);
  });

  it("emits deprecation.ts and 410-gone-handler.ts for TypeScript API projects", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      hasPublicApi: true,
    });
    const result = generateApiMiddleware(config);
    expect(result.files.some((f) => f.path.endsWith("deprecation.ts"))).toBe(
      true,
    );
    expect(
      result.files.some((f) => f.path.endsWith("410-gone-handler.ts")),
    ).toBe(true);
    expect(existsSync(join(dir, "src", "middleware", "deprecation.ts"))).toBe(
      true,
    );
    expect(
      existsSync(join(dir, "src", "middleware", "410-gone-handler.ts")),
    ).toBe(true);
  });

  it("emits DeprecationInterceptor.java for Java API projects", () => {
    cleanupTestProject(dir);
    dir = createTestProject("java");
    const config = makeConfig(dir, {
      language: "java",
      hasPublicApi: true,
      basePackage: "com.example",
    });
    const result = generateApiMiddleware(config);
    expect(
      result.files.some((f) => f.path.endsWith("DeprecationInterceptor.java")),
    ).toBe(true);
  });

  it("emits error-handler.ts and correlation-id.ts for TypeScript API projects (#220)", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      hasPublicApi: true,
    });
    const result = generateApiMiddleware(config);
    expect(result.files.some((f) => f.path.endsWith("error-handler.ts"))).toBe(
      true,
    );
    expect(result.files.some((f) => f.path.endsWith("correlation-id.ts"))).toBe(
      true,
    );
    expect(existsSync(join(dir, "src", "middleware", "error-handler.ts"))).toBe(
      true,
    );
    expect(
      existsSync(join(dir, "src", "middleware", "correlation-id.ts")),
    ).toBe(true);
  });

  it("does not emit for TypeScript non-API projects", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      hasPublicApi: false,
    });
    generateApiMiddleware(config);
    expect(existsSync(join(dir, "src", "middleware", "deprecation.ts"))).toBe(
      false,
    );
  });
});
