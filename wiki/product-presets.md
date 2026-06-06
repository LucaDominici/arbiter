---
generated: true
source: 'docs/PRODUCT/PRESETS.md'
source_sha: '40250af9deaa4368b15eed83d466c1bbcbfb16cb'
last_updated: '2026-06-06'
---

# Arbiter Project Presets

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/PRODUCT/PRESETS.md](../docs/PRODUCT/PRESETS.md)

# Arbiter Project Presets

Presets are meta-bundles that configure multiple governance features at once.
Apply with `arbiter init --preset <name>` or `arbiter update --preset <name>`.

## Available Presets

### `industrial-grade`

Enables the full compliance + governance stack in a single opt-in. Providers
(auth, observability) are left as `'none'` — set them separately via
`--auth-provider` and `--observability-provider`.

**What it enables:**

| Category      | Fields set                                                         |
| ------------- | ------------------------------------------------------------------ |
| Compliance    | `enableIso27001Mapping`, `enableNis2Mapping`, `enableGdprMapping`  |
| Governance    | `enableRiskRegister`, `enableEvidenceHarness`, `enableMcpFallback` |
| Operations    | `enableOperationsHandbook`                                         |
| Auth scaffold | `auth.tenantIsolation: true`, provider: `'none'`                   |
| Observability | `metrics`, `logs`, `alerts` on; provider: `'none'`                 |

**Usage:**

```bash
# Apply preset — providers stay 'none' (no files generated yet)
arbiter init --preset industrial-grade --yes --level L3

# Apply preset + pick providers in one shot
arbiter init --preset industrial-grade \
  --auth-provider keycloak \
  --observability-provider prom-grafana-loki-jaeger \
  --yes --level L3
```

**Stored in `arbiter.json`:**

```jsonc
{
  "preset": "industrial-grade",
  "auth": { "provider": "keycloak", "tenantIsolation": true },
  "observability": {
    "provider": "prom-grafana-loki-jaeger",
    "metrics": true,
    "logs": true,
    "traces": false,
    "alerts": true,
  },
}
```

### `none` (default)

No preset applied. All feature flags retain their individual defaults.

---

## Provider Selection

The `industrial-grade` preset enables auth and observability scaffolding but
leaves providers as `'none'` so no files are generated until you choose:

```bash
# Add auth provider to an existing preset project
arbiter update --auth-provider authentik

# Add observability provider
arbiter update --observability-provider signoz
```

**Auth providers** (from `--auth-provider`):
`app-level-ts`, `authelia`, `authentik`, `ory-stack`, `zitadel`, `keycloak`,
`saas-clerk`, `saas-auth0`, `saas-supabase-auth`, `saas-cognito`

**Observability providers** (from `--observability-provider`):
`stdout-minimal`, `victoria-vector-quickwit`, `signoz`, `openobserve`,
`prom-grafana-loki-jaeger`, `saas-sentry`, `saas-datadog`, `saas-axiom`,
`saas-betterstack`

---

## Future Presets

The following features are planned for `industrial-grade` when their generators
land:

- Contract integrity 5-gate suite (depends on #716)
- Context-economy knowledge map (depends on #720)
- Evidence retention policy configuration (depends on #718)
