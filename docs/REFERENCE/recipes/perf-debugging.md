---
title: 'Recipe — Profiling a slow arbiter command'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: []
---

# Recipe — Profiling a slow arbiter command

**Goal:** Capture a V8 CPU profile of an arbiter invocation and inspect it in Chrome DevTools.

**Issue:** #640 (R1.M6, Tier 3)

---

## Capture

```bash
arbiter --profile <your-command>
```

A `.cpuprofile` is written to `~/.arbiter/profiles/<runId>.cpuprofile` when the process exits. The profile covers the **whole process** — startup, argv parse, plugin load, generator dispatch, and command body — because most perceived slowness is in dispatch/load overhead before the command body even runs.

The flag is a no-op (with a warning) on Bun and Deno. `node:inspector` is Node.js-only.

---

## Inspect in Chrome DevTools

1. Open `chrome://inspect` in Chrome or Chromium.
2. Click **Open dedicated DevTools for Node**.
3. In the DevTools window, go to the **Profiler** tab.
4. Click **Load** and choose `~/.arbiter/profiles/<runId>.cpuprofile`.
5. Switch the visualization to **Chart** or **Bottom-Up** depending on whether you are hunting hot paths or aggregating self-time.

---

## Correlate with logs

The `<runId>` in the profile filename matches the `runId` field in any `--log-format json` record from the same invocation and the directory name under `~/.arbiter/logs/<runId>/` (when replay is enabled). Use it to cross-reference profile hotspots with debug events.

---

## Bundle for a bug report

```bash
arbiter report --run-id <runId>
```

The bundle is local-only — it is never uploaded automatically. Attach the resulting `.tar.gz` to your GitHub issue if you want maintainers to see the profile alongside the replay log.
