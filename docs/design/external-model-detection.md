---
title: 'External Model Detection — local CLI probe, no network, no token'
doc_version: '0.1.0'
status: draft
last_review: '2026-08-26'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'audience/agent', 'kind/design']
related: ['src/detectors/github.ts', 'src/utils/run-cli.ts']
---

# External Model Detection — local CLI probe, no network, no token

Detecting external LLM providers via their local CLI — no network, no token read.

## Problem statement

arbiter today has **no** notion of an LLM provider: no SDK dependency, no API-key read, no config field. The only host awareness is the `CLAUDECODE` boolean in `src/capabilities/host-probe.ts`. Verified: the entire `process.env` surface read by `src/` is `ARBITER_*`, `CI`, `HOME`, `CLAUDECODE`, `WSL*` — nothing else.

Before a review slot can be handed to a different vendor, we need to know, reliably and at negligible cost, **whether a second vendor's CLI exists on this machine and whether it is authenticated**. Without that, every downstream decision (wizard question, slot allocation, degradation) is blind.

The constraint that determines the whole design: `scripts/check-anti-telemetry.mjs` fails the build if `dist/` or `src/templates/` contain `fetch(`, `http.request(`, `axios`. **arbiter cannot call an LLM HTTP API.** This is not an obstacle to route around: it is the reason the correct design is to delegate to a local CLI the user has already installed and authenticated.

## Chosen approach

New module `src/detectors/external-model.ts`, modelled **on `src/detectors/github.ts`** — the exact precedent: `gh --version` for presence, `gh auth status` for authentication, returning a `{available, authenticated, …}` object, and **never** reading a token.

```ts
export type ExternalModelProvider = 'codex' // extensible table, one active adapter

export interface ExternalModelAccess {
  provider: ExternalModelProvider
  vendor: 'openai'
  available: boolean
  authenticated: boolean
  version: string | null
  error: string | null
}

export function detectExternalModel(p: ExternalModelProvider): ExternalModelAccess
export function detectExternalModels(): ExternalModelAccess[]
```

Per-provider details (binary, version args, how auth is established, install hint) live in a declarative `PROVIDER_SPECS` table rather than scattered through the code. Invocation via `runCli()` (INV-12/CANON-12 — never direct `child_process`), `timeoutMs: 5_000`, `retries: 0`, with **typed** branching on `CliError.notFound` and `.timedOut`. Per-process memoization: one `/ship` run must not spawn `codex --version` five times.

The module earns its keep immediately by being printed by `arbiter doctor health` (`codex: available, authenticated`) — that makes it independently shippable, and more importantly guarantees a **real reader** exists before there is any configuration to read (see D4).

## Key decisions and rejected alternatives

**D1 — Delegate to the CLI, do not call the API.**
This is not a workaround to stay inside `check-anti-telemetry`: it is the better design. arbiter never sees a credential, never opens a socket, and the "zero telemetry" claim stays a green gate instead of becoming an asterisk. It mirrors the `gh` precedent exactly, already described in `PRIVACY.md` as "shells out to your local `gh` CLI, which uses its own auth — arbiter never receives or transmits a token itself". _Rejected_ an HTTP client: it violates the anti-telemetry constraint, adds a runtime dependency, and moves credential custody onto arbiter.

**D2 — Codex authentication is an inference, and must be labelled as one.**
Verified caveat: unlike `gh auth status --json`, **Codex has no non-interactive auth-status command** — it is an open upstream request (openai/codex#10233). So `authenticated` is derived from indirect signals (presence of `~/.codex/auth.json`, or `OPENAI_API_KEY` being _defined_), never from reading a credential's value and never logging one. This difference from `gh` must be written into the code and into the evidence: it is an inference, not an assertion, and passing it off as a verification would be exactly the kind of overclaim arbiter polices elsewhere.

**D3 — New file, not an extension of `github.ts` (CANON-16 Existing Code Survey).**
Survey performed: `src/detectors/github.ts` is the pattern to mirror, but `GithubAccess` carries `username`, is consumed by `WizardInput.githubAccess` and by the Q12 gating; widening it into a provider table would force the `gh` path to carry vendor fields it never reads. `src/capabilities/host-probe.ts` detects _host_ facts from env/fs and spawns nothing: wrong subject. `src/detectors/{language,build,package-manager}.ts` detect the _project's_ toolchain from marker files: wrong subject. `src/utils/run-cli.ts` is **reused**, not duplicated. Verdict: new file justified — sibling of `github.ts`, distinct subject (third-party model CLIs), same shape.

**D4 — Independently shippable, for a precise reason.**
This PR is read-only and introduces no configuration. By being printed by `arbiter doctor` it becomes the **reader** that must already exist when the config block arrives: this is the direct mitigation of the #2344/#2333 bug class (field validated and never read). _Rejected_ merging detection and configuration into one PR: it would produce exactly the accept-then-ignore the repo has already opened twice.

**D5 — Extensible table, one customer-facing adapter.**
`src/wizard/types.ts:94-112` already writes the policy: only what is dogfooded end-to-end gets exposed; the rest is retained but not advertised. It applies identically here — `codex` is the only verified one, and the table allows adding more without a refactor. _Rejected_ both hardcoding codex (it would need redoing at the second provider) and exposing gemini now (not dogfooded: that would be overclaim).

**D6 — No bare `catch` (INV-96).**
`scripts/check-fail-closed-audit.mjs` rejects `catch {}` without a `// FAIL-OPEN-INTENT:` comment. Every error branch is typed and lands in a readable `error`, never in silence.

**Declared blind spot:** this presence check is a fail-open living in `src/`, while `arbiter doctor fail-open-census` scans only `scripts/`. The census **will not see it**. The compensating control is the mandatory degradation artifact in the downstream issue; it must be stated explicitly here rather than passed over in silence.

## Open questions

- The presence probe costs ~50-200 ms per provider. Is per-process memoization enough, or is an on-disk cache with a TTL needed so it is not paid on every `arbiter` invocation?
- If `OPENAI_API_KEY` is defined but `~/.codex/auth.json` is absent, does `codex exec` actually work? This must be confirmed empirically before treating the two signals as equivalent.
- Should `arbiter doctor health` always print providers, or only when at least one is `available` (so as not to advertise a feature to someone who will not use it)?

---

## Acceptance Criteria

- [ ] AC-1: `src/detectors/external-model.ts` exports `detectExternalModel` and `detectExternalModels` returning `ExternalModelAccess`, with per-provider details in a declarative `PROVIDER_SPECS` table.
- [ ] AC-2: detection uses `runCli()` from `src/utils/run-cli.ts` exclusively; the `check-no-direct-spawn.mjs` hook stays green (INV-12/CANON-12).
- [ ] AC-3: CLI absent ⇒ `{available:false, authenticated:false}` with `error` carrying the install hint — proven via `CliError.notFound`.
- [ ] AC-4: no credential **value** is ever read, returned or logged: a test asserts the returned object does not contain the value of `OPENAI_API_KEY` when it is set to a known sentinel.
- [ ] AC-5: `authenticated` is documented in code as an **inference** (not an assertion), citing the openai/codex#10233 caveat.
- [ ] AC-6: two consecutive calls for the same provider invoke `runCli` once (memoization), with a reset exposed for tests.
- [ ] AC-7: `arbiter doctor health` prints detected provider status — the module has a real consumer in this same PR.
- [ ] AC-8: `node scripts/check-all.mjs L2` green, `check-anti-telemetry` included; no new runtime dependency in `package.json`.

## Non-Goals

- No review invocation, no prompt, no diff sent anywhere: this PR **detects only**.
- No `arbiter.json` config block, no wizard question, no `/ship` change.
- No active `gemini` adapter (the table allows it; the adapter is not dogfooded).
- No reading or validating an API key against a remote endpoint.

## Files / contracts touched

- `src/detectors/external-model.ts` — new (CANON-16 survey in D3)
- `src/config/env-registry.ts` — registration of any env var read from `src/`
- `src/commands/doctor/health.ts` — the real consumer (D4)
- `src/utils/run-cli.ts` — reused, unmodified
- `__tests__/detectors/external-model.test.ts` — new
- Contract: no public API changes; no runtime dependency added

## Wave placement

Lane **B (provider detection)**, parallel-safe with Lane A. Blocks the config and slot issues.

## Implementation status

Issue #2355 implements the Codex probe and exposes its inferred availability and
authentication state through `arbiter doctor health`. The probe remains local-only:
it checks the CLI version and credential-presence signals without reading or logging
credential contents.
