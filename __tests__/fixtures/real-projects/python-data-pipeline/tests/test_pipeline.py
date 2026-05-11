"""Tests for the minimal ETL pipeline fixture."""
from pipeline import emit, transform


def test_transform_uppercases_value() -> None:
    records = [{"name": "alice", "score": "42"}]
    result = transform(records, "name", str.upper)
    assert result == [{"name": "ALICE", "score": "42"}]


def test_emit_serialises_record() -> None:
    records = [{"city": "rome", "pop": "3000000"}]
    lines = emit(records)
    assert lines == ["city=rome, pop=3000000"]


def test_transform_skips_missing_key() -> None:
    records = [{"x": "1"}]
    result = transform(records, "y", str.upper)
    assert result == [{"x": "1"}]
