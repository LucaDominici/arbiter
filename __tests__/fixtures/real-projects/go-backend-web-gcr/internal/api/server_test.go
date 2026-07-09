// Integration test: exercises the full stack (HTTP routing → handler →
// ItemStore) through real HTTP requests against a running httptest server —
// the multi-component slice a unit test on InMemoryStore alone cannot cover.
package api_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/example/go-backend-web-fixture/internal/api"
	"github.com/example/go-backend-web-fixture/internal/store"
)

// closeBody closes body and reports a close failure as a test error, so the
// error is never silently discarded (errcheck-clean without a blank-assign).
func closeBody(t *testing.T, body io.Closer) {
	t.Helper()
	if err := body.Close(); err != nil {
		t.Errorf("close response body: %v", err)
	}
}

func TestServerHealthReturnsOK(t *testing.T) {
	srv := httptest.NewServer(api.NewServer(store.NewInMemoryStore()))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/health") //nolint:noctx // fixture test, no context plumbing needed
	if err != nil {
		t.Fatalf("GET /health: %v", err)
	}
	defer closeBody(t, resp.Body)

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
}

func TestServerCreateThenFetchItemRoundTripsThroughTheStore(t *testing.T) {
	srv := httptest.NewServer(api.NewServer(store.NewInMemoryStore()))
	defer srv.Close()

	reqBody, err := json.Marshal(map[string]string{"name": "widget"})
	if err != nil {
		t.Fatalf("marshal request body: %v", err)
	}
	createResp, err := http.Post(srv.URL+"/items", "application/json", bytes.NewReader(reqBody)) //nolint:noctx
	if err != nil {
		t.Fatalf("POST /items: %v", err)
	}
	defer closeBody(t, createResp.Body)
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201, got %d", createResp.StatusCode)
	}

	var created store.Item
	if err := json.NewDecoder(createResp.Body).Decode(&created); err != nil {
		t.Fatalf("decode create response: %v", err)
	}

	getResp, err := http.Get(srv.URL + "/items/" + strconv.FormatInt(created.ID, 10)) //nolint:noctx
	if err != nil {
		t.Fatalf("GET /items/{id}: %v", err)
	}
	defer closeBody(t, getResp.Body)
	if getResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", getResp.StatusCode)
	}

	var fetched store.Item
	if err := json.NewDecoder(getResp.Body).Decode(&fetched); err != nil {
		t.Fatalf("decode get response: %v", err)
	}
	if fetched != created {
		t.Fatalf("expected %+v, got %+v", created, fetched)
	}
}

func TestServerFetchMissingItemReturns404(t *testing.T) {
	srv := httptest.NewServer(api.NewServer(store.NewInMemoryStore()))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/items/999999") //nolint:noctx
	if err != nil {
		t.Fatalf("GET /items/999999: %v", err)
	}
	defer closeBody(t, resp.Body)

	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", resp.StatusCode)
	}
}
