// Package main is a minimal stdlib HTTP server fixture used by brownfield safety tests.
package main

import (
	"fmt"
	"net/http"
)

func hello() string {
	return "hello"
}

func main() {
	http.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, `{"status":"ok"}`)
	})
	if err := http.ListenAndServe(":0", nil); err != nil {
		fmt.Println(err)
	}
}
