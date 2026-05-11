import { resolve } from "node:path";
import { loadConfig, saveConfig } from "../utils/config.js";
import { loadPlugin } from "../utils/plugin-loader.js";
import { jsonOutput } from "../utils/json-output.js";

export interface PluginAddOptions {
  dir?: string;
  pkg: string;
  json?: boolean | undefined;
}

export interface PluginRemoveOptions {
  dir?: string;
  pkg: string;
  json?: boolean | undefined;
}

export interface PluginListOptions {
  dir?: string;
  json?: boolean | undefined;
}

export async function runPluginAdd(opts: PluginAddOptions): Promise<void> {
  const targetDir = resolve(opts.dir ?? process.cwd());
  const stored = loadConfig(targetDir);
  if (!stored) {
    if (opts.json) {
      jsonOutput("plugin-add", "error", {}, [
        "No arbiter.json found. Run `arbiter init` first.",
      ]);
      process.exit(1);
      return;
    }
    console.error("  No arbiter.json found. Run `arbiter init` first.");
    process.exit(1);
  }

  await loadPlugin(opts.pkg, targetDir);

  const plugins = Array.isArray(stored.plugins) ? stored.plugins : [];
  if (!plugins.includes(opts.pkg)) {
    plugins.push(opts.pkg);
  }
  saveConfig(targetDir, { ...stored, plugins });

  if (opts.json) {
    jsonOutput("plugin-add", "ok", { pkg: opts.pkg });
    return;
  }

  console.log(`  Plugin added: ${opts.pkg}`);
  console.log(
    `  Security advisory: Plugin ${opts.pkg} will execute Node code during \`arbiter update\`. Verify source before use.`,
  );
}

export function runPluginRemove(opts: PluginRemoveOptions): void {
  const targetDir = resolve(opts.dir ?? process.cwd());
  const stored = loadConfig(targetDir);
  if (!stored) {
    if (opts.json) {
      jsonOutput("plugin-remove", "error", {}, [
        "No arbiter.json found. Run `arbiter init` first.",
      ]);
      process.exit(1);
      return;
    }
    console.error("  No arbiter.json found. Run `arbiter init` first.");
    process.exit(1);
  }

  const plugins = (stored.plugins ?? []).filter((p) => p !== opts.pkg);
  saveConfig(targetDir, { ...stored, plugins });

  if (opts.json) {
    jsonOutput("plugin-remove", "ok", { pkg: opts.pkg });
    return;
  }
  console.log(`  Plugin removed: ${opts.pkg}`);
}

export async function runPluginList(opts: PluginListOptions): Promise<void> {
  const targetDir = resolve(opts.dir ?? process.cwd());
  const stored = loadConfig(targetDir);
  if (!stored) {
    if (opts.json) {
      jsonOutput("plugin-list", "error", {}, [
        "No arbiter.json found. Run `arbiter init` first.",
      ]);
      process.exit(1);
      return;
    }
    console.error("  No arbiter.json found. Run `arbiter init` first.");
    process.exit(1);
  }

  const pluginNames = Array.isArray(stored.plugins) ? stored.plugins : [];

  if (opts.json) {
    const pluginStatuses: Array<{ pkg: string; status: string }> = [];
    for (const pkg of pluginNames) {
      let status: string;
      try {
        await loadPlugin(pkg, targetDir);
        status = "resolved";
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        status = `not loadable: ${raw.split("\n")[0]}`;
      }
      pluginStatuses.push({ pkg, status });
    }
    jsonOutput("plugin-list", "ok", { plugins: pluginStatuses });
    return;
  }

  if (pluginNames.length === 0) {
    console.log("  No plugins configured.");
    return;
  }

  console.log("  Configured plugins:");
  for (const pkg of pluginNames) {
    let status: string;
    try {
      await loadPlugin(pkg, targetDir);
      status = "resolved";
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      status = `not loadable: ${raw.split("\n")[0]}`;
    }
    console.log(`  ├── ${pkg} (${status})`);
  }
}
