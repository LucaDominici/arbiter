"""Minimal FastAPI backend-web-db fixture: /health + a sqlite-backed /items
resource.

Entry point convention (`app.main:app`) matches arbiter's own generated L2 e2e
start command for the python backend-web archetype (see scripts/check-all.mjs's
`E2E_START_CMD` default: `python -m uvicorn app.main:app`).
"""

from __future__ import annotations

from fastapi import Depends, FastAPI, HTTPException
from sqlalchemy.orm import Session

from app import crud
from app import models  # noqa: F401 — registers Item on Base.metadata before create_all
from app.db import Base, engine, get_db
from app.models import Item
from app.schemas import ItemCreate, ItemRead

Base.metadata.create_all(bind=engine)

app = FastAPI(title="python-backend-web fixture")


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness/readiness probe."""
    return {"status": "ok"}


@app.post("/items", response_model=ItemRead, status_code=201)
def create_item_endpoint(payload: ItemCreate, db: Session = Depends(get_db)) -> Item:
    """Create an item, persisted in the sqlite-backed database."""
    return crud.create_item(db, payload.name)


@app.get("/items/{item_id}", response_model=ItemRead)
def read_item(item_id: int, db: Session = Depends(get_db)) -> Item:
    """Fetch a single item by id, 404 if it does not exist."""
    item = crud.get_item(db, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="item not found")
    return item


@app.get("/items", response_model=list[ItemRead])
def list_all_items(db: Session = Depends(get_db)) -> list[Item]:
    """List every persisted item."""
    return crud.list_items(db)
