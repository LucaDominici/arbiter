---
title: 'Recipe B10 — Debugging an arbiter command'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: []
---

# Recipe B10 — Debugging an arbiter command

**Goal:** Figure out where an arbiter command is spending time, failing, or behaving unexpectedly.

**Issue:** #636 (R1.M2)

---

## TL;DR

```bash
arbiter --debug <your-command>
```

`--debug` is equivalent to `--log-level debug` and emits structured records on **stderr** for every internal phase. Stdout (the command's actual output) is untouched.

---

## Add structure with `--log-format`

```bash
arbiter --debug --log-format json doctor 2>debug.log
jq 'select(.event=="plugin.load")' < debug.log
```

The JSON record shape is stable:

```json
{
  "ts": "2026-05-17T00:12:34.567Z",
  "level": "debug",
  "event": "plugin.load",
  "runId": "8f5b…",
  "name": "rust-binary-size",
  "ms": 12
}
```

`runId` correlates every record from the same invocation across processes that share the import (`src/utils/logger.ts` singleton + AsyncLocalStorage).

---

## Environment variables

| Variable             | Effect                                      |
| -------------------- | ------------------------------------------- |
| `ARBITER_LOG_LEVEL`  | Default level if `--log-level` not passed   |
| `ARBITER_LOG_FORMAT` | Default format if `--log-format` not passed |

Flag wins over env. Env wins over default (`info` / `text`).

---

## When `--debug` is not enough

Bundle the full replay (argv + redacted env + output + arbiter state) with [`arbiter report`](../FAQ.md), or profile the command with [`--profile`](perf-debugging.md).
