"""Unit tests for the DB-layer CRUD functions — no HTTP layer, no app.main
import — each test gets its own throwaway in-memory engine/session."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import crud
from app.db import Base


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine, autoflush=False, autocommit=False)()
    try:
        yield session
    finally:
        session.close()


def test_create_item_persists_and_assigns_id(db: Session) -> None:
    item = crud.create_item(db, "widget")
    assert item.id is not None
    assert item.name == "widget"


def test_get_item_returns_none_when_missing(db: Session) -> None:
    assert crud.get_item(db, 999) is None


def test_list_items_returns_created_items_in_order(db: Session) -> None:
    crud.create_item(db, "a")
    crud.create_item(db, "b")
    names = [item.name for item in crud.list_items(db)]
    assert names == ["a", "b"]
