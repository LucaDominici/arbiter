// Command go-backend-web-fixture starts the fixture's minimal HTTP API: a
// /health probe plus a sqlite-class /items resource kept in memory behind the
// store.ItemStore interface (see internal/store).
package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"github.com/example/go-backend-web-fixture/internal/api"
	"github.com/example/go-backend-web-fixture/internal/store"
)

func main() {
	srv := &http.Server{
		Addr:              ":" + portOrDefault(),
		Handler:           api.NewServer(store.NewInMemoryStore()),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	log.Printf("listening on %s", srv.Addr)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}

func portOrDefault() string {
	if p := os.Getenv("PORT"); p != "" {
		return p
	}
	return "8080"
}
