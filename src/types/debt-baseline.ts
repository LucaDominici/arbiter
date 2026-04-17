import type { Archetype } from "../wizard/types.js";

export interface DebtBaselineMetric {
  value: number;
  unit: "percent" | "count" | "bytes" | "kb";
  direction: "higher-is-better" | "lower-is-better";
  items?: string[];
}

export interface DebtBaselineV2 {
  version: 2;
  capturedAt: string;
  commit: string;
  archetype: Archetype;
  metrics: Record<string, DebtBaselineMetric>;
}
