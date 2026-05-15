# Quickstart

Get arbiter running in under two minutes.

```bash
npx arbiter init
```

The wizard detects your stack and generates a complete governance setup: `AGENTS.md`, tool configs, quality gates, hooks, and CI workflows.

## Options

```
arbiter init [options]

  -y, --yes          Skip wizard — use auto-detected defaults
  --tools <list>     AI tools: claude,codex,cursor,copilot  (default: claude,codex)
  --level <level>    Governance level: L1, L2, L3            (default: L2)
  --dir <path>       Target directory                        (default: cwd)
```

## Next Steps

- [CLI Reference](/reference/cli) — full option documentation
- [Concepts](/concepts/) — understand governance levels and what gets generated
- [Stack Support](/reference/stacks) — which languages and tools are supported
