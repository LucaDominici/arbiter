---
'@arbiter/cli': minor
---

feat(#729): industrial-grade meta-preset

Adds `--preset industrial-grade` to `arbiter init` (and the programmatic
`applyPreset` function). Applying the preset enables the full compliance +
governance stack in one opt-in:

- ISO 27001 / NIS2 / GDPR control-mapping (`enableIso27001Mapping/Nis2/Gdpr`)
- Risk register + P×I assessment (`enableRiskRegister`)
- Evidence harness (`enableEvidenceHarness`)
- Operations handbook (`enableOperationsHandbook`)
- MCP fallback determinism rule (`enableMcpFallback`)
- Auth scaffold with `tenantIsolation: true` (provider stays `'none'`)
- Observability scaffold with metrics + logs + alerts (provider stays `'none'`)

Providers are left as `'none'` so no files are generated until the user
explicitly picks one via `--auth-provider` / `--observability-provider`.

Also fixes the pre-existing schema gap: `ArbiterConfigV2` now includes
`observability?`, `auth?`, and `preset?` fields, enabling round-trip
persistence of provider + preset config through `arbiter.json`.

See `docs/PRODUCT/PRESETS.md` for usage examples.
