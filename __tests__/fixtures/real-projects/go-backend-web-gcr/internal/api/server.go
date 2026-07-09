// Package api wires HTTP handlers to an ItemStore, exposing /health and the
// /items resource over plain net/http (no framework dependency).
package api

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/example/go-backend-web-fixture/internal/store"
)

// NewServer returns an http.Handler exposing /health and the /items resource,
// backed by the given ItemStore.
func NewServer(items store.ItemStore) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", handleHealth)
	mux.HandleFunc("POST /items", handleCreateItem(items))
	mux.HandleFunc("GET /items", handleListItems(items))
	mux.HandleFunc("GET /items/{id}", handleGetItem(items))
	return mux
}

func handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

type createItemRequest struct {
	Name string `json:"name"`
}

func handleCreateItem(items store.ItemStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req createItemRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Name) == "" {
			http.Error(w, "name is required", http.StatusBadRequest)
			return
		}
		item := items.Create(req.Name)
		writeJSON(w, http.StatusCreated, item)
	}
}

func handleGetItem(items store.ItemStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil {
			http.Error(w, "invalid id", http.StatusBadRequest)
			return
		}
		item, err := items.Get(id)
		if err != nil {
			if errors.Is(err, store.ErrNotFound) {
				http.Error(w, "item not found", http.StatusNotFound)
				return
			}
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, item)
	}
}

func handleListItems(items store.ItemStore) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, items.List())
	}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		log.Printf("api: failed to encode response: %v", err)
	}
}
