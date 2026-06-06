---
generated: true
source: 'docs/MIGRATION/deploy-config-consolidation.md'
source_sha: 'a1ed76baf70e3612ec4b9d4d9daa7a1ac2b9c635'
last_updated: '2026-06-06'
---

# Migration: deploy config consolidation (deployTarget)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/MIGRATION/deploy-config-consolidation.md](../docs/MIGRATION/deploy-config-consolidation.md)

# Migration: deploy config consolidation onto `deployTarget`

## What changed

Two derived boolean config fields were **removed** from `ProjectConfig`
(`src/wizard/types.ts`) and from `arbiter.json`:

| Removed field             | Replaced by                              |
| ------------------------- | ---------------------------------------- |
| `enableDeployWorkflows`   | `deployTarget !== 'none'`                |
| `enableAzureContainerApp` | `deployTarget === 'azure-container-app'` |

Both flags were already `@deprecated` (since ADR-078 / #1005, which introduced
`deployTarget`). They were only ever _derived_ from `deployTarget` by the wizard,
so removing them changes no generated output — `deployTarget` is now the **single
source of truth** for deploy-workflow and Azure Container Apps infra emission.

Tracked by #1145 (`enableDeployWorkflows`) and #1146 (`enableAzureContainerApp`).

## Do I need to do anything?

**Almost certainly not.** If your `arbiter.json` was produced by `arbiter init`
on any recent version, it already carries `deployTarget` and never persisted the
derived flags. Unknown fields in `arbiter.json` are ignored, so a stale
`enableDeployWorkflows`/`enableAzureContainerApp` key is harmless — it simply has
no effect.

## Manual migration (only if you hand-edited `arbiter.json`)

If you set one of the removed flags by hand, translate it to `deployTarget`:

| Old hand-edit                      | New `deployTarget` value                         |
| ---------------------------------- | ------------------------------------------------ |
| `"enableDeployWorkflows": true`    | `"deployTarget": "ghcr"` (or your cloud target)  |
| `"enableDeployWorkflows": false`   | `"deployTarget": "none"`                         |
| `"enableAzureContainerApp": true`  | `"deployTarget": "azure-container-app"`          |
| `"enableAzureContainerApp": false` | leave `deployTarget` as-is (any non-azure value) |

Then delete the old keys. Re-run `arbiter doctor` to confirm the config is valid.

## Reference

- `deployTarget` values: see `DeployTarget` in `src/wizard/types.ts`.
- Deploy-workflow gate: `src/generators/github.ts` (`deployTarget !== 'none'`).
- Azure infra gate: `src/generators/infra.ts` / `src/generators/registry.ts`
  (`deployTarget === 'azure-container-app'`).
