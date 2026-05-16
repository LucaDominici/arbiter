---
'@arbiter/cli': minor
---

feat(#725 #726): observability + auth provider abstraction generators

Adds two opt-in generators that emit provider-specific setup docs:

- `generateObservability`: emits `docs/OBSERVABILITY.md` when `observability.provider`
  is set and not `'none'`. Supports 9 providers: stdout-minimal, signoz, openobserve,
  victoria-vector-quickwit, prom-grafana-loki-jaeger, saas-sentry, saas-datadog,
  saas-axiom, saas-betterstack.

- `generateAuth`: emits `docs/AUTH_SETUP.md` when `auth.provider` is set and not
  `'none'`. Supports 10 providers: app-level-ts, authelia, authentik, ory-stack,
  zitadel, keycloak, saas-clerk, saas-auth0, saas-supabase-auth, saas-cognito.

Both generators use `skipIfExists` so user customisations are never overwritten.
Registry entries, diff PATH_TO_KEYS, and type definitions included.
