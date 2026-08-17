#!/usr/bin/env bash
# farm.sh — Arbiter runner farm management
# Homogeneous 4-slot topology: arbiter-slot-build[-2|-3|-4], all sharing the
# docker-ci-build label (ADR-023 / repo var CI_BUILD_RUNNER_LABEL).
#
# Usage:
#   farm.sh start    Start the runner containers
#   farm.sh stop     Stop the runner containers
#   farm.sh status   Show container + GitHub runner status
#   farm.sh logs     Tail runner logs
#   farm.sh health   Exit 0 if healthy, 1 if degraded
#   farm.sh ensure   Start runners and verify topology converges
#   farm.sh doctor   Full diagnostic report
#   farm.sh reregister <slot>  Rebuild ONE slot whose registration GitHub deleted

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.runners.yml"
ENV_FILE="${SCRIPT_DIR}/.env"
EXPECTED_SERVICES=(runner-build runner-build-2 runner-build-3 runner-build-4)
EXPECTED_SCALE=4

export DOCKER_HOST="${DOCKER_HOST:-unix:///var/run/docker-ci/docker.sock}"

usage() {
  cat <<EOF
Usage: $(basename "$0") <command>

Commands:
  start    Start the 4 runner containers
  stop     Stop the runner containers
  status   Container list + GitHub runner inventory
  logs     Tail runner logs (Ctrl-C to exit)
  health   Quick health check (exit 0=healthy, 1=degraded)
  ensure   Start and wait for topology convergence
  doctor   Full stack diagnostic
  reregister <slot>
           Rebuild exactly one slot whose server-side registration GitHub has
           deleted: remove that service, wipe its own -state volume, bring it back
           with a fresh RUNNER_TOKEN. Takes one slot (service name or runner name);
           there is no --all. Refuses unless the slot is PROVEN unregistered.

Environment:
  DOCKER_HOST defaults to ${DOCKER_HOST}
  Non-secret runner config lives in scripts/runner/.env (copy from .env.example).
  No long-lived credential is stored: start/ensure mint a short-lived RUNNER_TOKEN
  via the GitHub API (requires an authenticated gh CLI on the host with repo
  admin access). Pattern: a sibling repo#434.
EOF
}

require_env() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    echo "ERROR: ${ENV_FILE} not found. Copy .env.example to .env (non-secret config only)." >&2
    exit 1
  fi
  # Guard: no long-lived credential may live in .env. env_file injects every
  # line into all 4 containers, so a leftover ACCESS_TOKEN would reintroduce
  # the plaintext long-lived token this farm was migrated off.
  if grep -qE '^ACCESS_TOKEN=.+' "${ENV_FILE}"; then
    echo "ERROR: ${ENV_FILE} still contains an ACCESS_TOKEN value." >&2
    echo "Long-lived tokens are no longer used: delete the ACCESS_TOKEN line (and revoke the token on GitHub)." >&2
    echo "farm.sh now mints a short-lived RUNNER_TOKEN via the GitHub API at startup." >&2
    exit 1
  fi
}

# Mint a short-lived (60-min) runner registration token via the GitHub API.
# One mint is valid for ~60 minutes and can register multiple runners, so a
# single token covers all 4 slots for one `compose up` (pattern: sibling-repo runner farm).
fetch_runner_token() {
  gh api -X POST repos/LucaDominici/arbiter/actions/runners/registration-token --jq '.token'
}

# Start only the expected services that are not already running, minting a
# fresh RUNNER_TOKEN just for them. Running containers are NEVER touched:
# the token differs on every mint, so passing it through `compose up` on a
# running service changes the compose config hash and triggers a mid-job
# container recreate (observed on a sibling repo's farm 2026-07-09: an hourly ensure timer
# recreated runners and killed an in-flight CI job). `ensure`/`start`
# therefore guarantee presence, not config sync; to roll out compose config
# changes, run `farm.sh stop && farm.sh start` at a CI-idle window. The
# token is passed only via the process environment — never echoed, never
# written to disk. Already-configured runners (registration persisted in
# the per-slot -state volume) ignore it and reuse their existing
# registration.
compose_up_registered() {
  local running to_start=() svc runner_token
  # FAIL-OPEN-INTENT: empty running-list just means "start every service" below.
  running="$(compose ps --status running --services 2>/dev/null || true)"
  for svc in "${EXPECTED_SERVICES[@]}"; do
    grep -qx "${svc}" <<<"${running}" || to_start+=("${svc}")
  done

  if [[ ${#to_start[@]} -eq 0 ]]; then
    echo "All runner containers already running — leaving them untouched."
    return 0
  fi

  if ! runner_token=$(fetch_runner_token) || [[ -z "${runner_token}" ]]; then
    echo "ERROR: could not mint a runner registration token from the GitHub API." >&2
    echo "Check: gh auth status — the host gh CLI must be authenticated with admin access to the repo." >&2
    return 1
  fi

  # Pull before starting (#2280). The compose file pins `:latest`, which docker
  # resolves against the LOCAL cache — a slot restarted on a stale local image
  # comes back on the same deprecated runner version and goes straight back to
  # Up-but-offline, which is why the hourly ensure timer could not heal the
  # 2026-08-15 queue stall. Only the services about to start are pulled, so
  # running containers keep their image and are never recreated mid-job.
  # FAIL-OPEN-INTENT: a pull failure (registry down, rate limit) must not stop
  # a farm from coming up on the image it already has — the health/doctor
  # deprecation check is what turns a stale image into a RED.
  compose pull "${to_start[@]}" || echo "WARN: image pull failed — starting on the cached image." >&2

  RUNNER_TOKEN="${runner_token}" compose up -d "${to_start[@]}"
}

compose() {
  docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" "$@"
}

runner_inventory() {
  gh api repos/LucaDominici/arbiter/actions/runners 2>/dev/null || return 1
}

runner_count_online() {
  local inventory
  if inventory=$(runner_inventory); then
    echo "$inventory" | jq '[.runners[] | select(.status == "online")] | length' 2>/dev/null || echo "UNKNOWN"
  else
    echo "UNKNOWN"
  fi
}

container_running_count() {
  compose ps --status running --quiet 2>/dev/null | wc -l | tr -d ' '
}

# ── Per-slot correlation (#2287) ─────────────────────────────────────────────
#
# The farm used to compare two integers — containers=4 vs online=3 — which cannot
# name a slot and cannot tell "still registering" from "registration deleted". The
# join key is exact: the compose file pins RUNNER_NAME and sets
# RANDOM_RUNNER_SUFFIX=false, so a slot's GitHub name is a pure function of its
# compose service, and the inventory reports that same string.
#
#   service            runner name             state volume
#   runner-build       arbiter-slot-build      runner-arbiter-build-state
#   runner-build-N     arbiter-slot-build-N    runner-arbiter-build-N-state
#
# All three derive from the service suffix, so there is one mapping, not three lists.

# runner-build-2 -> build-2
slot_suffix() {
  echo "${1#runner-}"
}

# runner-build-2 -> arbiter-slot-build-2
slot_runner_name() {
  echo "arbiter-slot-$(slot_suffix "$1")"
}

# runner-build-2 -> runner-arbiter-build-2-state
slot_state_volume() {
  echo "runner-arbiter-$(slot_suffix "$1")-state"
}

# Accept either the compose service (runner-build-2) or the runner name shown by
# health/doctor (arbiter-slot-build-2). Echoes the SERVICE and returns 0 only for a
# slot this farm actually owns — an unknown name must never reach a `volume rm`.
normalize_slot() {
  local want="$1" svc
  for svc in "${EXPECTED_SERVICES[@]}"; do
    if [[ "${want}" == "${svc}" || "${want}" == "$(slot_runner_name "${svc}")" ]]; then
      echo "${svc}"
      return 0
    fi
  done
  return 1
}

# Newline-separated runner names present in the GitHub inventory.
# Returns 1 — never an empty success — when the API cannot be read. Callers MUST
# treat that as UNKNOWN: reading a failed query as "nothing is registered" would
# mark every slot an orphan and invite exactly the farm-wide recreate that killed an
# in-flight job on 2026-07-09.
registered_runner_names() {
  local inventory names
  inventory=$(runner_inventory) || return 1
  names="$(jq -r '.runners[].name' <<<"${inventory}" 2>/dev/null)" || return 1
  # An inventory that parses to nothing is indistinguishable from a malformed read.
  [[ -n "${names}" ]] || return 1
  echo "${names}"
}

# Newline-separated SERVICE names that are running but whose runner name is absent
# from the GitHub inventory — the #2287 signature. A container in a crashloop is
# `running` at sample time, which is precisely why compose_up_registered skips it
# and why counting cannot see this.
# Returns 1 (and prints nothing) when the inventory is UNKNOWN: unproven is not
# unregistered.
unregistered_running_slots() {
  local running registered svc
  # FAIL-OPEN-INTENT: an empty running-list means no slot is running, which yields an empty orphan list — the conservative answer; the registration side below is the one that fails closed.
  running="$(compose ps --status running --services 2>/dev/null || true)"
  registered="$(registered_runner_names)" || return 1
  for svc in "${EXPECTED_SERVICES[@]}"; do
    grep -qx "${svc}" <<<"${running}" || continue
    grep -qx "$(slot_runner_name "${svc}")" <<<"${registered}" || echo "${svc}"
  done
  return 0
}

# Print the per-slot diagnosis + remedy for every orphaned slot. Returns 0 only when
# at least one was found, so callers can escalate. Diagnostic only — the remedy is
# printed, never auto-applied, for the same reason diagnose_up_but_offline is.
report_unregistered_slots() {
  local orphans self
  self="$(basename "$0")"
  orphans="$(unregistered_running_slots)" || return 1
  [[ -n "${orphans}" ]] || return 1

  local svc
  while IFS= read -r svc; do
    [[ -n "${svc}" ]] || continue
    echo "UNREGISTERED SLOT: $(slot_runner_name "${svc}") (service ${svc}) is running but absent from the GitHub inventory."
    echo "  CAUSE: GitHub deletes a registration that has not connected recently. The slot restarts"
    echo "  on its persisted $(slot_state_volume "${svc}") volume, reuses the dead .runner config"
    echo "  (\"The runner has already been configured\"), fails to open a session, and crashloops."
    echo "  \`start\`/\`ensure\` cannot heal it: a crashlooping container is 'running', so it is never"
    echo "  restarted and never receives a fresh RUNNER_TOKEN."
    echo "  REMEDY: ${self} reregister ${svc}"
  done <<<"${orphans}"
  return 0
}

# #2280 — the "Up but offline" deprecation signature. GitHub stops delivering
# messages to a runner whose version it has deprecated; the container keeps
# running, so docker-side health is green while every job on the label queues
# forever. Grep the container logs for GitHub's own wording.
# Logs are captured into a variable rather than piped into `grep -q`: under
# `set -o pipefail` an early-exiting grep SIGPIPEs `compose logs` and the
# pipeline reports 141, which would read as "no deprecation found".
runner_deprecation_in_logs() {
  local logs
  # FAIL-OPEN-INTENT: unreadable logs must not manufacture a deprecation verdict; an empty capture falls through to the generic degraded report, which is the conservative answer.
  logs="$(compose logs --tail=200 --no-color 2>/dev/null || true)"
  grep -Eqi 'cannot receive messages|Runner version .* is deprecated' <<<"${logs}"
}

# Print the root-cause diagnosis for an Up-but-offline farm. Returns 0 only when
# the deprecation signature is confirmed, so callers can escalate that case from
# "maybe still registering" to a hard failure with a remedy.
# Deliberately diagnostic, not corrective: recreating a live container is what
# killed an in-flight CI job on a sibling farm (see compose_up_registered), so
# the remedy is printed for a human/idle-window run, never auto-applied here.
diagnose_up_but_offline() {
  local containers="$1" online="$2" self
  self="$(basename "$0")"
  [[ "${online}" == "UNKNOWN" ]] && return 1
  [[ "${containers}" -ge "${EXPECTED_SCALE}" && "${online}" -lt "${EXPECTED_SCALE}" ]] || return 1

  echo "Up-but-offline: ${containers} container(s) running but only ${online} runner(s) online."
  if runner_deprecation_in_logs; then
    echo "ROOT CAUSE: the runner image is stale and GitHub has deprecated its runner version."
    echo "  The compose file pins :latest, which resolves against the LOCAL image cache, so"
    echo "  restarting the slots re-registers the same deprecated version and the queue stays stuck."
    echo "REMEDY: docker pull myoung34/github-runner:latest && ${self} stop && ${self} start"
    return 0
  fi
  echo "  (no stale-image signature in the logs — slots may still be registering)"
  return 1
}

cmd_start() {
  require_env
  echo "Starting arbiter runner farm (${EXPECTED_SCALE} slots)..."
  compose_up_registered
  echo "Runners started. It may take ~30s to register with GitHub."
}

cmd_stop() {
  require_env
  echo "Stopping arbiter runner farm..."
  compose down --remove-orphans
  echo "Runners stopped."
}

cmd_status() {
  require_env
  echo "=== Container status ==="
  compose ps
  echo ""
  echo "=== GitHub runner inventory ==="
  if inventory=$(runner_inventory); then
    echo "$inventory" | jq -r '.runners[] | "\(.name)  status=\(.status)  busy=\(.busy)  labels=\([.labels[].name] | join(","))"'
  else
    echo "(could not reach GitHub API — gh CLI not authenticated?)"
  fi
}

cmd_logs() {
  require_env
  compose logs -f --tail=120
}

cmd_health() {
  require_env
  local containers online ok=true

  containers="$(container_running_count)"
  online="$(runner_count_online)"

  if [[ "$containers" -lt "$EXPECTED_SCALE" ]]; then
    echo "DEGRADED: expected ${EXPECTED_SCALE} running container(s), found ${containers}" >&2
    ok=false
  fi

  if [[ "$online" == "UNKNOWN" ]]; then
    echo "WARN: GitHub API unreachable — cannot verify runner registration" >&2
  elif [[ "$online" -lt "$EXPECTED_SCALE" ]]; then
    echo "DEGRADED: expected ${EXPECTED_SCALE} online runner(s), found ${online}" >&2
    # #2287: name the slot and the cause before falling back to the count-only
    # diagnosis. A running-but-unregistered slot is a DIFFERENT failure from a stale
    # image, and reporting it as "containers=4, online=3" is what left the operator
    # with no slot, no cause and no remedy through 116 restarts.
    # FAIL-OPEN-INTENT: additive detail on an ALREADY-failing branch (ok=false below); a 1 from either diagnosis means "signature not confirmed", not an error.
    report_unregistered_slots >&2 || diagnose_up_but_offline "$containers" "$online" >&2 || true
    ok=false
  fi

  if $ok; then
    echo "HEALTHY: ${containers} container(s), ${online} runner(s) online"
    return 0
  fi
  return 1
}

cmd_ensure() {
  require_env
  echo "Ensuring arbiter farm topology (expected scale: ${EXPECTED_SCALE})..."
  compose_up_registered

  local retries=0
  local max_retries=12  # 12 x 5s = 60s
  while [[ $retries -lt $max_retries ]]; do
    local containers online
    containers="$(container_running_count)"
    online="$(runner_count_online)"

    if [[ "$online" == "UNKNOWN" ]]; then
      echo "  [${retries}/${max_retries}] containers=${containers} online=UNKNOWN (GitHub API unreachable) — waiting 5s..."
    elif [[ "$containers" -ge "$EXPECTED_SCALE" ]] && [[ "$online" -ge "$EXPECTED_SCALE" ]]; then
      echo "OK: ${containers} container(s) running, ${online} runner(s) online."
      return 0
    else
      echo "  [${retries}/${max_retries}] containers=${containers} online=${online} — waiting 5s..."
    fi

    retries=$((retries + 1))
    sleep 5
  done

  echo "ERROR: topology did not converge after $((max_retries * 5))s" >&2
  compose ps >&2
  # This is the path the hourly ensure timer took during the 2026-08-15 stall:
  # it reported non-convergence every hour without ever naming the stale image.
  # FAIL-OPEN-INTENT: additive detail on an already-failing path (return 1 below); a 1 from the diagnosis means "no deprecation signature", not an error.
  diagnose_up_but_offline "$(container_running_count)" "$(runner_count_online)" >&2 || true
  return 1
}

# Rebuild exactly ONE slot whose registration GitHub deleted (#2287). This is the
# only corrective verb in this script, and every guard below exists because the
# 2026-07-09 incident was a farm-wide recreate that killed an in-flight CI job:
#
#   * one slot per invocation — no --all, no glob, no default target;
#   * the slot must be PROVEN unregistered. A registered slot may be executing a
#     job right now; an unregistered one cannot be, because a runner GitHub has no
#     record of is a runner GitHub cannot have dispatched to. That is what makes an
#     automatic-looking remedy safe here and nowhere else (AC-4);
#   * an unreadable inventory is UNKNOWN, not "unregistered" — refuse, so a gh
#     outage can never be the thing that wipes a slot;
#   * an unknown slot name is refused before any volume name is derived from it.
#
# The other three services are never named on any command line this function runs.
cmd_reregister() {
  require_env
  local want="${1:-}" svc orphans self
  self="$(basename "$0")"

  if [[ -z "${want}" ]]; then
    echo "ERROR: reregister needs exactly one slot. Usage: ${self} reregister <slot>" >&2
    echo "  Slots: ${EXPECTED_SERVICES[*]} (or their arbiter-slot-* runner names)." >&2
    return 1
  fi

  if ! svc="$(normalize_slot "${want}")"; then
    echo "ERROR: '${want}' is not a slot of this farm." >&2
    echo "  Slots: ${EXPECTED_SERVICES[*]} (or their arbiter-slot-* runner names)." >&2
    return 1
  fi

  if ! orphans="$(unregistered_running_slots)"; then
    echo "REFUSED: cannot reach the GitHub runner inventory, so '${svc}' cannot be PROVEN" >&2
    echo "  unregistered. Unproven is not unregistered — a slot that is merely unverified may" >&2
    echo "  be running a job, and recreating it would kill that job (2026-07-09)." >&2
    echo "  Check: gh auth status" >&2
    return 1
  fi

  if ! grep -qx "${svc}" <<<"${orphans}"; then
    echo "REFUSED: $(slot_runner_name "${svc}") is registered with GitHub (or not running)." >&2
    echo "  A registered slot may be executing a job right now; this command only ever rebuilds" >&2
    echo "  a slot GitHub has no record of, which by definition cannot have been dispatched to." >&2
    echo "  To roll out compose config changes instead, run '${self} stop && ${self} start' at a" >&2
    echo "  CI-idle window." >&2
    return 1
  fi

  local volume runner_token
  volume="$(slot_state_volume "${svc}")"
  echo "Reregistering ${svc} ($(slot_runner_name "${svc}")) — its registration was deleted server-side."

  # Order matters: the container holds the volume mounted, so it goes first.
  compose rm -sf "${svc}"
  # The dead .runner config lives here; without this wipe the entrypoint says
  # "already configured" again and the crashloop simply resumes.
  docker volume rm "${volume}"

  if ! runner_token=$(fetch_runner_token) || [[ -z "${runner_token}" ]]; then
    echo "ERROR: could not mint a runner registration token from the GitHub API." >&2
    echo "  ${svc} is now stopped with a clean volume; re-run this command once gh is authenticated." >&2
    return 1
  fi
  compose pull "${svc}" || echo "WARN: image pull failed — starting on the cached image." >&2
  RUNNER_TOKEN="${runner_token}" compose up -d "${svc}"
  echo "Done. ${svc} will re-register within ~30s; verify with '${self} health'."
}

cmd_doctor() {
  require_env
  local ok=true

  echo "=== Arbiter Farm Doctor ==="
  echo ""

  echo "[1] Docker daemon reachability (${DOCKER_HOST})"
  local docker_info_err
  if docker_info_err=$(docker info 2>&1 >/dev/null); then
    echo "    OK"
  else
    echo "    FAIL — cannot reach Docker daemon at ${DOCKER_HOST}"
    echo "    Error: ${docker_info_err}"
    ok=false
  fi

  echo ""
  echo "[2] Runner containers"
  local containers
  containers="$(container_running_count)"
  if [[ "$containers" -ge "$EXPECTED_SCALE" ]]; then
    echo "    OK — ${containers} container(s) running"
  else
    echo "    FAIL — expected ${EXPECTED_SCALE}, found ${containers}"
    compose ps
    ok=false
  fi

  echo ""
  echo "[3] GitHub runner registration"
  if inventory=$(runner_inventory); then
    local online
    online="$(echo "$inventory" | jq '[.runners[] | select(.status == "online")] | length')"
    if [[ "$online" -ge "$EXPECTED_SCALE" ]]; then
      echo "    OK — ${online} runner(s) online"
    else
      echo "    WARN — only ${online} runner(s) online (expected ${EXPECTED_SCALE})"
      echo "$inventory" | jq -r '.runners[] | "    \(.name): status=\(.status) busy=\(.busy)"'
      # Neither a confirmed deprecation signature (#2280) nor a slot whose
      # registration was deleted server-side (#2287) is a transient registration
      # lag — in both cases nothing on the label will ever run again without an
      # operator action, so doctor must go RED rather than WARN.
      local diag diag_rc=0
      diag="$(report_unregistered_slots)" || diag_rc=$?
      if [[ $diag_rc -ne 0 ]]; then
        diag_rc=0
        diag="$(diagnose_up_but_offline "$containers" "$online")" || diag_rc=$?
      fi
      [[ -n "$diag" ]] && sed 's/^/    /' <<<"$diag"
      [[ $diag_rc -eq 0 ]] && ok=false
      true
    fi
  else
    echo "    WARN — GitHub API unreachable (gh CLI not authenticated?)"
  fi

  echo ""
  echo "[4] Disk space"
  df -h /var/lib/docker-ci 2>/dev/null || df -h / 2>/dev/null
  echo ""

  if $ok; then
    echo "Doctor: all checks passed."
    return 0
  else
    echo "Doctor: one or more checks failed." >&2
    return 1
  fi
}

case "${1:-}" in
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  status)  cmd_status ;;
  logs)    cmd_logs ;;
  health)  cmd_health ;;
  ensure)  cmd_ensure ;;
  doctor)  cmd_doctor ;;
  reregister) cmd_reregister "${2:-}" ;;
  *)       usage; exit 1 ;;
esac
