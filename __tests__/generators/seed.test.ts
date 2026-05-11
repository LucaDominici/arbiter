import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  createTestProject,
  initGit,
  cleanupTestProject,
  makeConfig,
} from "../helpers.js";
import { generateSeed } from "../../src/generators/seed.js";

describe("generateSeed (#221)", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject("typescript");
    initGit(dir);
  });

  afterEach(() => {
    cleanupTestProject(dir);
  });

  it("returns empty for L1 governance level", () => {
    const config = makeConfig(dir, {
      archetype: "backend-web-db",
      governanceLevel: "L1",
    });
    const result = generateSeed(config);
    expect(result.files).toHaveLength(0);
  });

  it("returns empty for non-web-db archetype", () => {
    const config = makeConfig(dir, {
      archetype: "library",
      governanceLevel: "L2",
    });
    const result = generateSeed(config);
    expect(result.files).toHaveLength(0);
  });

  it("emits seed-test-data.sh and seed-common.sh for backend-web-db L2", () => {
    const config = makeConfig(dir, {
      archetype: "backend-web-db",
      governanceLevel: "L2",
    });
    const result = generateSeed(config);
    expect(result.files.some((f) => f.path.endsWith("seed-test-data.sh"))).toBe(
      true,
    );
    expect(result.files.some((f) => f.path.endsWith("seed-common.sh"))).toBe(
      true,
    );
    expect(existsSync(join(dir, "scripts", "seed-test-data.sh"))).toBe(true);
    expect(existsSync(join(dir, "scripts", "lib", "seed-common.sh"))).toBe(
      true,
    );
  });

  it("emits seed scripts for backend-web-db L3", () => {
    const config = makeConfig(dir, {
      archetype: "backend-web-db",
      governanceLevel: "L3",
    });
    const result = generateSeed(config);
    expect(result.files).toHaveLength(2);
  });

  it("emits seed-test-data.sh with executable permission (0o755)", () => {
    const config = makeConfig(dir, {
      archetype: "backend-web-db",
      governanceLevel: "L2",
    });
    generateSeed(config);
    const mode = statSync(join(dir, "scripts", "seed-test-data.sh")).mode;
    expect(mode & 0o111).toBeTruthy();
  });
});
