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

| Action                              | When                    | Why                                            |
| ----------------------------------- | ----------------------- | ---------------------------------------------- |
| `arbiter plugin add <name>`         | You run this command    | Fetches the named plugin from the npm registry |
| `arbiter ci plan` with `--gh-token` | You pass a GitHub token | Uses the GitHub API to read issue/PR data      |

In both cases, the network call is a direct consequence of a command you explicitly ran. Arbiter does not call home in the background, on startup, or at any other time.

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

---

## Reporting Privacy Concerns

If you discover unexpected network activity, please report it via [SECURITY.md](SECURITY.md).

---

_Last reviewed: 2026-05-15_
