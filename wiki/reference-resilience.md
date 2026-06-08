---
generated: true
source: 'docs/REFERENCE/RESILIENCE.md'
source_sha: '40ec57cb8f19e165814d82ded272958477c8b1d2'
last_updated: '2026-06-08'
---

# Resilience Patterns Generator

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/RESILIENCE.md](../docs/REFERENCE/RESILIENCE.md)

# Resilience Patterns Generator

**Capability:** arbiter emits a `docs/governance/RESILIENCE.md` guide for `backend-web-db`
projects at governance level L2 and above.

**Generator:** `src/generators/resilience.ts`
**Template:** `src/templates/resilience/RESILIENCE.md.ejs`
**Gate:** archetype `backend-web-db` + `governanceLevel` ≠ `L1`

---

## What it emits

A single advisory markdown guide placed at `docs/governance/RESILIENCE.md` in the target project.
The guide covers:

- **Circuit breaker** — failure-rate threshold, minimum-calls window, decorator ordering (CB outer
  wraps retry so the CB observes the final outcome of the whole retry sequence)
- **Retry / backoff** — 3 attempts, exponential with jitter, capped at 30 s; retry predicate
  enforces 5xx-only (4xx never retried)
- **Timeout budget** — 5 s per attempt (not per sequence)
- **Rate limiter** — token-bucket, 100 req/s sustained, burst 20, per-client key
- **External-call / adapter checklist** — 9-item checklist covering isolation, SSRF allowlist,
  secret hygiene, idempotency contract, and dead-letter

## Stack coverage

| Language                        | Config blocks                                 | Status   |
| ------------------------------- | --------------------------------------------- | -------- |
| TypeScript                      | cockatiel policy + rate-limiter-flexible      | Concrete |
| Java                            | Resilience4j Spring Boot 3 YAML + annotations | Concrete |
| multi                           | Both TypeScript and Java blocks               | Concrete |
| Go, Python, Kotlin, Rust, other | Generic guidance (degrade note)               | Advisory |

## L3/L4 additions

At L3/L4 governance the emitted guide appends a hard-requirements section covering:
observability (metrics export), retry counters, runbook linkage, and load-test evidence requirements.

## Advisory status

This generator emits documentation and configuration guidance only. It does not add a hook,
gate, or machine-enforceable invariant — the resilience patterns apply to target projects and
are not enforceable within arbiter itself. No INV entry is added.

For a first-class KIT dimension covering this capability, see the follow-up issue that will add
`N78` to `src/kit/catalog.json` and promote the FEATURE_MATRIX row from `Done` to `Verified`.

## See Also

- [[product-feature-comparison]] — related
