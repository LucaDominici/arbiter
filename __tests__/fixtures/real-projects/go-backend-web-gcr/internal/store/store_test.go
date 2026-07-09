package store_test

import (
	"errors"
	"testing"

	"github.com/example/go-backend-web-fixture/internal/store"
)

func TestInMemoryStoreCreateAssignsIncrementingIDs(t *testing.T) {
	s := store.NewInMemoryStore()

	first := s.Create("widget")
	second := s.Create("gadget")

	if first.ID == second.ID {
		t.Fatalf("expected distinct ids, got %d and %d", first.ID, second.ID)
	}
	if first.Name != "widget" || second.Name != "gadget" {
		t.Fatalf("unexpected names: %+v, %+v", first, second)
	}
}

func TestInMemoryStoreGetReturnsErrNotFoundForMissingItem(t *testing.T) {
	s := store.NewInMemoryStore()

	_, err := s.Get(999)

	if !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestInMemoryStoreListReturnsAllCreatedItemsInOrder(t *testing.T) {
	s := store.NewInMemoryStore()
	s.Create("a")
	s.Create("b")

	items := s.List()

	if len(items) != 2 || items[0].Name != "a" || items[1].Name != "b" {
		t.Fatalf("unexpected list result: %+v", items)
	}
}
