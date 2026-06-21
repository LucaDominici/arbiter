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

| Action                              | When                              | Why                                            |
| ----------------------------------- | --------------------------------- | ---------------------------------------------- |
| `arbiter plugin add <name>`         | You run this command              | Fetches the named plugin from the npm registry |
| `arbiter ci plan` with `--gh-token` | You pass a GitHub token           | Uses the GitHub API to read issue/PR data      |
| `arbiter init --recipe <https://…>` | You pass an `https://` recipe URL | Fetches the recipe JSON you pointed it at      |

In every case, the network call is a direct consequence of a command (and, for recipes, a URL) you explicitly ran. Arbiter does not call home in the background, on startup, or at any other time.

---

## How to Verify

**Offline use:**

Arbiter's core commands (`init`, `check`, `generate`) work without any network access. You can run them with your firewall fully blocking outbound connections.

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

- `src/commands/plugin.ts` — npm registry fetch for plugin install
- `src/github/` — GitHub API calls, only when a token is explicitly provided
- `src/recipes/loader.ts` — fetches a recipe JSON, only when you pass an `https://` URL to `arbiter init --recipe` (size-capped, 10s timeout, redirects not followed)

---

## Anti-Telemetry CI Enforcement (#642)

Every pull request runs an automated scan of `dist/` and `src/templates/` for network call patterns. Any match not present in [`suppressions/telemetry-allowlist.json`](suppressions/telemetry-allowlist.json) fails the build.

**Scanned patterns:** `fetch(`, `http.request(`, `https.request(`, `axios`, `segment.`, `amplitude.`, `mixpanel`, `posthog`, `sentry`, `bugsnag`

The allowlist lists every permitted occurrence with a justification. Currently permitted patterns are generated test fixtures that call local mock servers in test scope only — never production endpoints.

---

## Local Observability Artifacts (#635-#640)

Arbiter writes three categories of local-only files for debugging and bug reports:

| Location                                 | Written by                   | Default lifecycle                         |
| ---------------------------------------- | ---------------------------- | ----------------------------------------- |
| `~/.arbiter/logs/<runId>/`               | Every invocation (default)   | LRU-rotated; only the 10 most recent kept |
| `~/.arbiter/reports/<runId>.tar.gz`      | `arbiter report` (explicit)  | Kept until you delete it                  |
| `~/.arbiter/profiles/<runId>.cpuprofile` | `arbiter --profile` (opt-in) | Kept until you delete it                  |

**All three are local. None are uploaded anywhere.** They exist for you to inspect or attach to a bug report at your discretion.

**Redaction.** Environment variables captured in `env.json` are redacted by name match: any variable whose name (case-insensitive, underscore-segment-aware) contains `TOKEN`, `SECRET`, `KEY`, `PASSWORD`, `PASS`, `AUTH`, `CREDENTIAL`, `PRIVATE`, or `API`, or starts with `GH_`, `GITHUB_`, or `NPM_`, has its value replaced with `***REDACTED***`. Patterns and behavior are tested in `__tests__/utils/replay.test.ts`.

**Opt-out.** Pass `--no-replay` to skip writing any replay log for an invocation. The flag is also recognized via `ARBITER_NO_REPLAY=1`.

**Bundling.** `arbiter report` defaults to spawning `$EDITOR` so you can preview and trim the manifest before tar.gz is written — no file leaves the host without your explicit edit pass. Pass `--auto` to skip the editor or `--print-only` to inspect the manifest without producing a bundle.

---

## Reporting Privacy Concerns

If you discover unexpected network activity, please report it via [SECURITY.md](SECURITY.md).

---

_Last reviewed: 2026-06-22_
