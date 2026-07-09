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
