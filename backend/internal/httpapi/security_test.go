package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"szyca/internal/config"
)

func TestPublicRuntimeReportsUptimeWithoutCache(t *testing.T) {
	server := &Server{startedAt: time.Now().Add(-2*time.Minute - 5*time.Second)}
	request := httptest.NewRequest(http.MethodGet, "/api/runtime", nil)
	recorder := httptest.NewRecorder()

	server.handlePublicRuntime(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("runtime status = %d", recorder.Code)
	}
	if got := recorder.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("runtime Cache-Control = %q, want no-store", got)
	}
	var payload struct {
		UptimeSeconds int64 `json:"uptime_seconds"`
		StartedAt     string `json:"started_at"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode runtime: %v", err)
	}
	if payload.UptimeSeconds < 120 || payload.UptimeSeconds > 130 {
		t.Fatalf("runtime uptime = %d, want about 125", payload.UptimeSeconds)
	}
	if _, err := time.Parse(time.RFC3339, payload.StartedAt); err != nil {
		t.Fatalf("runtime started_at is invalid: %v", err)
	}
}

func TestClientIPOnlyTrustsConfiguredProxy(t *testing.T) {
	server := &Server{cfg: config.Config{
		TrustedProxyCIDRs: []string{"127.0.0.1/32"},
	}}

	untrusted := httptest.NewRequest(http.MethodGet, "/", nil)
	untrusted.RemoteAddr = "203.0.113.5:4321"
	untrusted.Header.Set("X-Forwarded-For", "198.51.100.10")
	if got := server.clientIP(untrusted); got != "203.0.113.5" {
		t.Fatalf("untrusted proxy spoofed client IP: %s", got)
	}

	trusted := httptest.NewRequest(http.MethodGet, "/", nil)
	trusted.RemoteAddr = "127.0.0.1:4321"
	trusted.Header.Set("X-Forwarded-For", "spoofed, 198.51.100.20")
	if got := server.clientIP(trusted); got != "198.51.100.20" {
		t.Fatalf("trusted proxy client IP = %s, want rightmost real peer", got)
	}
}

func TestCORSDoesNotAllowArbitraryOrigin(t *testing.T) {
	server := &Server{cfg: config.Config{}}
	handler := server.withCORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	request := httptest.NewRequest(http.MethodOptions, "http://szyca.example/api/site", nil)
	request.Host = "szyca.example"
	request.Header.Set("Origin", "https://evil.example")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("foreign preflight status = %d", recorder.Code)
	}
	if got := recorder.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("foreign origin received CORS permission: %q", got)
	}
}

func TestOriginMatchesForwardedHost(t *testing.T) {
	server := &Server{cfg: config.Config{
		TrustedProxyCIDRs: []string{"127.0.0.1/32"},
	}}
	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/api/admin/auth/login", nil)
	request.RemoteAddr = "127.0.0.1:1234"
	request.Host = "127.0.0.1"
	request.Header.Set("X-Forwarded-Host", "szyca.example")
	request.Header.Set("Origin", "https://szyca.example")
	if !server.originMatches(request) {
		t.Fatal("same-origin request through trusted reverse proxy was rejected")
	}
}
