## Arbiter Runner Farm (4-slot `docker-ci-build` pool)

Containerized GitHub runners (`myoung34/github-runner`) on the isolated `docker-ci`
daemon (socket: `/var/run/docker-ci/docker.sock`), registered under the
`docker-ci-build` label referenced by the `CI_BUILD_RUNNER_LABEL` repo variable
(ADR-023).

| Component       | Detail                                                                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Runner image    | `myoung34/github-runner:latest`                                                                                                     |
| Slot identities | `arbiter-slot-build`, `arbiter-slot-build-2/3/4`                                                                                    |
| Caches          | Per-slot named volumes: `runner-arbiter-build[-N]-{state,work,npm-cache}`                                                           |
| Credential      | Short-lived `RUNNER_TOKEN` minted via `gh api` at `compose up` time — no long-lived PAT on disk (pattern: sibling-repo runner farm) |

### Quick start

```bash
cp scripts/runner/.env.example scripts/runner/.env
# Fill REPO_URL. No token needed — requires `gh auth login` with repo admin access.

scripts/runner/farm.sh start
scripts/runner/farm.sh health
scripts/runner/farm.sh doctor
```

### Commands

| Command          | Description                                     |
| ---------------- | ----------------------------------------------- |
| `farm.sh start`  | Start all 4 runner containers                   |
| `farm.sh stop`   | Stop all runners                                |
| `farm.sh status` | Container list + GitHub runner inventory        |
| `farm.sh health` | Quick health check (exit 0=healthy, 1=degraded) |
| `farm.sh ensure` | Start and wait for topology convergence         |
| `farm.sh doctor` | Full stack diagnostic                           |

Already-registered runners (state persisted in the per-slot `-state` volume) ignore
`RUNNER_TOKEN` and reuse their existing registration, so recreating containers is
safe without deregistering anything.

### Failure mode: "Up but offline" (stale runner image) — #2280

The compose file pins `myoung34/github-runner:latest`, and `:latest` resolves against
the **local** image cache. A farm left running long enough drifts onto a runner version
GitHub has since deprecated. GitHub then refuses to deliver messages to it:

```
Runner version v2.334.0 is deprecated and cannot receive messages.
```

Docker still reports every container `Up`, so container-level health is green while the
GitHub runner inventory lists every slot **offline** and every job on the `docker-ci-build`
label sits `queued` forever. Because the hourly farm-ensure timer / `farm.sh ensure` restarted the
slots on the same cached image, the state was self-healing-proof (observed 2026-08-15:
PR #2276 queued from 17:40, nightly from 02:53).

Two guards now cover it:

- **`farm.sh start` / `ensure` pull first.** `compose pull` runs for the services about to
  start, immediately before `compose up -d`. Only stopped slots are pulled — running
  containers are never touched, because recreating a live runner kills its in-flight job.
  A failed pull is a warning, not a stop: the farm still comes up on the cached image and
  the health check below is what turns that into a RED.
- **`farm.sh health` / `doctor` diagnose the mismatch.** When docker reports `>= 4`
  containers running but GitHub reports fewer online, the container logs are scanned for
  GitHub's deprecation wording. A confirmed hit prints the root cause and the remedy and
  exits non-zero (`doctor` escalates it from WARN to FAIL — nothing on the label will run
  again until the image is pulled). Without that signature the slots are reported as plain
  degraded, since they may simply still be registering.

Manual remedy (also printed by `health`/`doctor`), to run at a CI-idle window:

```bash
DOCKER_HOST=unix:///var/run/docker-ci/docker.sock docker pull myoung34/github-runner:latest
scripts/runner/farm.sh stop && scripts/runner/farm.sh start
scripts/runner/farm.sh health   # expect: HEALTHY: 4 container(s), 4 runner(s) online
```

Behavioural coverage: `__tests__/scripts/runner-farm-stale-image.test.ts` drives the real
`farm.sh` against fixture `docker`/`gh` shims (deprecation log, clean log, converged farm).
