import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { GovernanceLevel } from "../wizard/types.js";
import { loadConfig, saveConfig } from "../utils/config.js";
import type { ArbiterConfig } from "../utils/config.js";
import { runCli } from "../utils/run-cli.js";

export interface UpgradeLevelOptions {
  dir?: string;
  /** Required unless --extend is set. */
  target?: GovernanceLevel;
  extend?: boolean;
  days?: number;
}

const LEVEL_RANK: Record<GovernanceLevel, number> = { L1: 1, L2: 2, L3: 3 };
const DEFAULT_GRACE_DAYS = 30;

export function runUpgradeLevel(opts: UpgradeLevelOptions): void {
  const dir = resolve(opts.dir ?? ".");
  const stored = loadConfig(dir);

  if (!stored) {
    throw new Error("No arbiter.json found. Run arbiter init first.");
  }

  if (opts.extend) {
    handleExtend(dir, stored, opts.days ?? DEFAULT_GRACE_DAYS);
    return;
  }

  if (!opts.target) {
    throw new Error("--target is required. Specify L2 or L3.");
  }
  const target = opts.target;
  const current = stored.governanceLevel;

  if (target === current) {
    throw new Error(`Already at ${current}. Nothing to upgrade.`);
  }

  if (LEVEL_RANK[target] < LEVEL_RANK[current]) {
    throw new Error(
      "Downgrade not supported. Edit arbiter.json manually and run arbiter update.",
    );
  }

  const days = opts.days ?? DEFAULT_GRACE_DAYS;
  const graceEndsAt = new Date(Date.now() + days * 86400000).toISOString();

  // INV-33: capture debt baseline before persisting graceEndsAt — see ADR-028
  runCli("node", ["scripts/capture-debt-baseline.mjs", "--update"], {
    cwd: dir,
  });

  saveConfig(dir, {
    ...stored,
    governanceLevel: target,
    graceFromLevel: current,
    graceEndsAt,
  });

  const endsDate = graceEndsAt.slice(0, 10);
  if (current === "L1") {
    console.log(
      `Grace ends ${endsDate} (${days} days). ${target} gates will WARN until then.`,
    );
  } else {
    console.log(
      `Upgraded to ${target}. Grace period recorded until ${endsDate} (${days} days).`,
    );
    console.log(
      `  Note: grace-period warn mode is L1→L2 only in this release; ${target} gates activate immediately.`,
    );
  }
}

function handleExtend(dir: string, stored: ArbiterConfig, days: number): void {
  const existing = stored.graceEndsAt;
  if (!existing || Date.parse(existing) <= Date.now()) {
    throw new Error("No grace period to extend (none set or already expired).");
  }

  const newEndsAt = new Date(
    Date.parse(existing) + days * 86400000,
  ).toISOString();

  const arbiterDir = join(dir, ".arbiter");
  if (!existsSync(arbiterDir)) {
    mkdirSync(arbiterDir, { recursive: true });
  }

  const logPath = join(arbiterDir, "grace-log.json");
  const log: unknown[] = existsSync(logPath)
    ? (JSON.parse(readFileSync(logPath, "utf-8")) as unknown[])
    : [];

  log.push({
    action: "extend",
    at: new Date().toISOString(),
    previousEndsAt: existing,
    newEndsAt,
    days,
  });

  writeFileSync(logPath, JSON.stringify(log, null, 2) + "\n", "utf-8");

  saveConfig(dir, { ...stored, graceEndsAt: newEndsAt });

  const endsDate = newEndsAt.slice(0, 10);
  console.log(`Grace extended to ${endsDate} (+${days} days).`);
}
