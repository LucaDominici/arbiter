"""SQLAlchemy engine/session wiring for the fixture's DB-backed API.

Uses an in-memory sqlite database shared via StaticPool: one connection lives
for the process, so data persists across requests within a run — the property
this fixture demonstrates — without writing anything to disk. Table creation
is deferred to app.main (after app.models has registered the ORM tables on
Base.metadata), not performed here.
"""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""


engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Iterator[Session]:
    """FastAPI dependency yielding a request-scoped database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
