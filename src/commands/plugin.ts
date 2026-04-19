import { resolve } from "node:path";
import { loadConfig, saveConfig } from "../utils/config.js";
import { loadPlugin } from "../utils/plugin-loader.js";

export interface PluginAddOptions {
  dir?: string;
  pkg: string;
}

export interface PluginRemoveOptions {
  dir?: string;
  pkg: string;
}

export interface PluginListOptions {
  dir?: string;
}

export async function runPluginAdd(opts: PluginAddOptions): Promise<void> {
  const targetDir = resolve(opts.dir ?? process.cwd());
  const stored = loadConfig(targetDir);
  if (!stored) {
    console.error("  No arbiter.json found. Run `arbiter init` first.");
    process.exit(1);
  }

  await loadPlugin(opts.pkg, targetDir);

  const plugins = stored.plugins ?? [];
  if (!plugins.includes(opts.pkg)) {
    plugins.push(opts.pkg);
  }
  saveConfig(targetDir, { ...stored, plugins });

  console.log(`  Plugin added: ${opts.pkg}`);
  console.log(
    `  Security advisory: Plugin ${opts.pkg} will execute Node code during \`arbiter update\`. Verify source before use.`,
  );
}

export function runPluginRemove(opts: PluginRemoveOptions): void {
  const targetDir = resolve(opts.dir ?? process.cwd());
  const stored = loadConfig(targetDir);
  if (!stored) {
    console.error("  No arbiter.json found. Run `arbiter init` first.");
    process.exit(1);
  }

  const plugins = (stored.plugins ?? []).filter((p) => p !== opts.pkg);
  saveConfig(targetDir, { ...stored, plugins });
  console.log(`  Plugin removed: ${opts.pkg}`);
}

export async function runPluginList(opts: PluginListOptions): Promise<void> {
  const targetDir = resolve(opts.dir ?? process.cwd());
  const stored = loadConfig(targetDir);
  if (!stored) {
    console.error("  No arbiter.json found. Run `arbiter init` first.");
    process.exit(1);
  }

  const plugins = stored.plugins ?? [];
  if (plugins.length === 0) {
    console.log("  No plugins configured.");
    return;
  }

  console.log("  Configured plugins:");
  for (const pkg of plugins) {
    let status: string;
    try {
      await loadPlugin(pkg, targetDir);
      status = "resolved";
    } catch {
      status = "not found";
    }
    console.log(`  ├── ${pkg} (${status})`);
  }
}
