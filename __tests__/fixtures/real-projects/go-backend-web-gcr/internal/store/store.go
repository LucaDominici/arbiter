// Package store provides the persistence abstraction for the fixture's items
// resource. InMemoryStore is the only implementation — swapping in a real
// database (sqlite, Cloud SQL, …) means implementing ItemStore against it, no
// handler changes required.
package store

import (
	"errors"
	"sync"
)

// ErrNotFound is returned when an item does not exist.
var ErrNotFound = errors.New("item not found")

// Item is the persisted resource the fixture's API exposes.
type Item struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

// ItemStore persists and retrieves Items.
type ItemStore interface {
	Create(name string) Item
	Get(id int64) (Item, error)
	List() []Item
}

// InMemoryStore is a goroutine-safe ItemStore backed by an in-memory map.
type InMemoryStore struct {
	mu     sync.Mutex
	nextID int64
	items  map[int64]Item
}

// NewInMemoryStore returns an empty InMemoryStore.
func NewInMemoryStore() *InMemoryStore {
	return &InMemoryStore{items: make(map[int64]Item)}
}

// Create persists a new item and returns it with its assigned id.
func (s *InMemoryStore) Create(name string) Item {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.nextID++
	item := Item{ID: s.nextID, Name: name}
	s.items[item.ID] = item
	return item
}

// Get returns the item with id, or ErrNotFound if it does not exist.
func (s *InMemoryStore) Get(id int64) (Item, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	item, ok := s.items[id]
	if !ok {
		return Item{}, ErrNotFound
	}
	return item, nil
}

// List returns every persisted item, ordered by id.
func (s *InMemoryStore) List() []Item {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Item, 0, len(s.items))
	for id := int64(1); id <= s.nextID; id++ {
		if item, ok := s.items[id]; ok {
			out = append(out, item)
		}
	}
	return out
}
