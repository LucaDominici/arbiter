"""Integration test: exercises the full stack (HTTP -> routing -> DB session ->
ORM -> sqlite) through real requests against the running app — the
multi-component slice a crud-function unit test alone cannot cover."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.db import Base, engine
from app.main import app


@pytest.fixture(autouse=True)
def reset_db() -> Iterator[None]:
    """Reset the shared in-memory database before each test for isolation."""
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield


def test_create_then_fetch_item_round_trips_through_the_real_db() -> None:
    client = TestClient(app)

    created = client.post("/items", json={"name": "widget"})
    assert created.status_code == 201
    item_id = created.json()["id"]

    fetched = client.get(f"/items/{item_id}")
    assert fetched.status_code == 200
    assert fetched.json() == {"id": item_id, "name": "widget"}


def test_list_items_reflects_persisted_rows() -> None:
    client = TestClient(app)
    client.post("/items", json={"name": "a"})
    client.post("/items", json={"name": "b"})

    listed = client.get("/items")
    assert listed.status_code == 200
    names = [row["name"] for row in listed.json()]
    assert names == ["a", "b"]


def test_fetch_missing_item_returns_404() -> None:
    client = TestClient(app)
    response = client.get("/items/999999")
    assert response.status_code == 404
