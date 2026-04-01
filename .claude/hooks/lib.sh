#!/usr/bin/env bash
# Arbiter hook library — shared utilities for all hooks
# Project: arbiter

PROJECT="arbiter"
LOG_DIR=".claude/hooks/logs"
LOG_FILE="$LOG_DIR/hook-events.log"

mkdir -p "$LOG_DIR"

log_event() {
  local level="$1"
  local message="$2"
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [$PROJECT] [$level] $message" >> "$LOG_FILE"
}

log_info()  { log_event "INFO"  "$1"; }
log_warn()  { log_event "WARN"  "$1"; }
log_error() { log_event "ERROR" "$1"; }
