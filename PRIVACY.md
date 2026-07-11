# Privacy Policy

**Arbiter collects zero telemetry and makes zero unsolicited network calls.**

---

## What Arbiter Does NOT Collect

- Usage statistics or analytics
- Error reports or crash data
- Machine identifiers or IP addresses
- Project structure, file names, or code content
- Command-line arguments or flags you pass
- Timing data or performance metrics

There is no opt-out because there is nothing to opt out of.

---

## What Arbiter Does Over the Network

Arbiter is offline by default. The only network activity is explicit and user-initiated:

| Action                                   | When                                                                    | Why                                                                                                             |
| ---------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `arbiter init` (GitHub-backend projects) | Repo setup step touches branch protection, labels, or the project board | Shells out to your local `gh` CLI, which uses its own auth — arbiter never receives or transmits a token itself |
| `arbiter init --recipe <https://…>`      | You pass an `https://` recipe URL                                       | Fetches the recipe JSON you pointed it at                                                                       |

In every case, the network call is a direct consequence of a command (and, for recipes, a URL) you explicitly ran. Arbiter does not call home in the background, on startup, or at any other time.

---

## How to Verify

**Offline use:**

Arbiter's core commands (`init`, `update`, `diff`, `doctor`, `validate`) work without any network access. You can run them with your firewall fully blocking outbound connections.

**Packet capture:**

```bash
# macOS / Linux — watch for unexpected outbound connections
sudo tcpdump -i any -n "host not 127.0.0.1 and not ::1" &
arbiter init --yes
kill %1
```

Any connection you see will be from npm (package resolution) or your own toolchain, not from arbiter itself.

**Code audit:**

The full source is at `src/`. Network-capable code paths are limited to:

- `src/utils/plugin-loader.ts` — loads an already npm-installed plugin from local `node_modules`; arbiter itself makes no registry call (you run `npm install <pkg>` yourself first)
- `src/github/` — branch protection, labels, and project-board setup during `arbiter init`, shelled out to your local `gh` CLI (its own auth, not a token passed to arbiter)
- `src/recipes/loader.ts` — fetches a recipe JSON, only when you pass an `https://` URL to `arbiter init --recipe` (size-capped, 10s timeout, redirects not followed)

---

## Anti-Telemetry CI Enforcement (#642)

Every pull request runs an automated scan of `dist/` and `src/templates/` for network call patterns. Any match not present in [`suppressions/telemetry-allowlist.json`](suppressions/telemetry-allowlist.json) fails the build.

**Scanned patterns:** `fetch(`, `http.request(`, `https.request(`, `axios`, `segment.`, `amplitude.`, `mixpanel`, `posthog`, `sentry`, `bugsnag`

The allowlist lists every permitted occurrence with a justification. Currently permitted patterns are generated test fixtures that call local mock servers in test scope only — never production endpoints.

---

## Local Observability Artifacts (#635-#640)

Arbiter writes two categories of local-only files for debugging and bug reports:

| Location                                 | Written by                   | Default lifecycle                         |
| ---------------------------------------- | ---------------------------- | ----------------------------------------- |
| `~/.arbiter/logs/<runId>/`               | Every invocation (default)   | LRU-rotated; only the 10 most recent kept |
| `~/.arbiter/profiles/<runId>.cpuprofile` | `arbiter --profile` (opt-in) | Kept until you delete it                  |

**Both are local. Neither is uploaded anywhere.** They exist for you to inspect or attach to a bug report at your discretion.

**Redaction.** Environment variables captured in `env.json` are redacted by name match: any variable whose name (case-insensitive, underscore-segment-aware) contains `TOKEN`, `SECRET`, `KEY`, `PASSWORD`, `PASS`, `AUTH`, `CREDENTIAL`, `PRIVATE`, or `API`, or starts with `GH_`, `GITHUB_`, or `NPM_`, has its value replaced with `***REDACTED***`. Patterns and behavior are tested in `__tests__/utils/replay.test.ts`.

**Opt-out.** Pass `--no-replay` to skip writing any replay log for an invocation. The flag is also recognized via `ARBITER_NO_REPLAY=1`.

---

## Reporting Privacy Concerns

If you discover unexpected network activity, please report it via [SECURITY.md](SECURITY.md).

---

_Last reviewed: 2026-06-22_
