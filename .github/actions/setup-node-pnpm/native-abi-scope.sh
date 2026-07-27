#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail

abi=''
detected=''
case "${RUNNER_OS:-unknown}" in
  Linux)
    if command -v getconf >/dev/null 2>&1; then
      if detected="$(getconf GNU_LIBC_VERSION 2>/dev/null)"; then
        abi="$detected"
      fi
    fi
    if [[ -z "$abi" ]] && command -v ldd >/dev/null 2>&1; then
      ldd_status=0
      detected="$(ldd --version 2>&1)" || ldd_status=$?
      if [[ "$detected" =~ [Mm][Uu][Ss][Ll] ]]; then
        musl_banner=''
        musl_version=''
        while IFS= read -r line; do
          if [[ -z "$musl_banner" && "$line" =~ [Mm][Uu][Ss][Ll] ]]; then
            musl_banner="$line"
          fi
          if [[ -z "$musl_version" && "$line" =~ ^Version[[:space:]]+([0-9]+(\.[0-9]+)+) ]]; then
            musl_version="Version ${BASH_REMATCH[1]}"
          fi
        done <<<"$detected"
        # A musl banner without its version cannot safely isolate native binaries.
        if [[ -n "$musl_banner" && -n "$musl_version" ]]; then
          abi="$musl_banner $musl_version"
        fi
      elif ((ldd_status == 0)); then
        abi="${detected%%$'\n'*}"
      fi
    fi
    ;;
  macOS)
    if detected="$(sw_vers -productVersion 2>/dev/null)"; then
      abi="macos-$detected"
    fi
    ;;
  Windows)
    if detected="$(uname -sr 2>/dev/null)"; then
      abi="windows-$detected"
    fi
    ;;
  *)
    if detected="$(uname -srm 2>/dev/null)"; then
      abi="$detected"
    fi
    ;;
esac

node_version=''
node_modules_abi=''
if detected="$(node --version 2>/dev/null)"; then
  node_version="$detected"
fi
if detected="$(node -p 'process.versions.modules' 2>/dev/null)"; then
  node_modules_abi="$detected"
fi

if [[ -z "$abi" ]]; then
  echo "cannot determine native ABI for node_modules cache" >&2
  exit 2
fi
if [[ -z "$node_version" || -z "$node_modules_abi" ]]; then
  echo "cannot determine Node version/module ABI for node_modules cache" >&2
  exit 2
fi

scope="$(
  printf '%s' \
    "${RUNNER_OS:-unknown}-${RUNNER_ARCH:-unknown}-$abi-node-$node_version-modules-$node_modules_abi" |
    tr -c 'A-Za-z0-9._-' '-'
)"
if [[ -z "$scope" ]]; then
  echo "native ABI cache scope normalized to an empty value" >&2
  exit 2
fi
printf '%s\n' "$scope"
