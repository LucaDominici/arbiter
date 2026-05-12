import { describe, it, expect } from "vitest";
import { TASK_SIZE_LABELS } from "../../src/generators/labels.js";
import type { LabelSpec } from "../../src/generators/labels.js";

describe("TASK_SIZE_LABELS", () => {
  it("exports three size labels", () => {
    expect(TASK_SIZE_LABELS).toHaveLength(3);
  });

  it("each label has name, description, and color", () => {
    for (const label of TASK_SIZE_LABELS) {
      expect(label.name).toBeTruthy();
      expect(label.description).toBeTruthy();
      expect(label.color).toBeTruthy();
    }
  });

  it("label names are the expected tier names", () => {
    const names = TASK_SIZE_LABELS.map((l) => l.name);
    expect(names).toContain("size:XS");
    expect(names).toContain("size:S");
    expect(names).toContain("size:Standard");
  });

  it("hex colors are 6-char strings without leading #", () => {
    for (const label of TASK_SIZE_LABELS) {
      expect(label.color).toMatch(/^[0-9a-f]{6}$/i);
    }
  });

  it("conforms to LabelSpec interface shape", () => {
    const spec: LabelSpec = TASK_SIZE_LABELS[0];
    expect(typeof spec.name).toBe("string");
    expect(typeof spec.description).toBe("string");
    expect(typeof spec.color).toBe("string");
  });
});
