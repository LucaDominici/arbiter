"""DB-layer functions kept free of the HTTP layer, so they are unit-testable
directly against a Session (no FastAPI app / TestClient needed)."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import Item


def create_item(db: Session, name: str) -> Item:
    """Persist a new item and return it with its assigned id."""
    item = Item(name=name)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def get_item(db: Session, item_id: int) -> Item | None:
    """Return the item with `item_id`, or None if it does not exist."""
    return db.get(Item, item_id)


def list_items(db: Session) -> list[Item]:
    """Return every persisted item, ordered by id."""
    return list(db.query(Item).order_by(Item.id).all())
