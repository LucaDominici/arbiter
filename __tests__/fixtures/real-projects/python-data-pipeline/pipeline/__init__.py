"""Minimal ETL pipeline module — read, transform, emit."""
from __future__ import annotations

from typing import Iterable


def read_records(source: Iterable[str]) -> list[dict[str, str]]:
    """Parse newline-separated key=value records into dicts."""
    records = []
    for line in source:
        line = line.strip()
        if not line:
            continue
        pairs = (item.split("=", 1) for item in line.split(","))
        records.append({k.strip(): v.strip() for k, v in pairs if "=" in item for item in [item]})
    return records


def transform(records: list[dict[str, str]], key: str, fn: object) -> list[dict[str, str]]:
    """Apply fn to the value of key in each record, returning a new list."""
    return [{**r, key: fn(r[key])} if key in r else r for r in records]


def emit(records: list[dict[str, str]]) -> list[str]:
    """Serialise records back to comma-separated key=value lines."""
    return [", ".join(f"{k}={v}" for k, v in r.items()) for r in records]
