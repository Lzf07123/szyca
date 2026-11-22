package ws

import (
	"net/http/httptest"
	"testing"
)

func TestOriginAllowed(t *testing.T) {
	tests := []struct {
		name    string
		host    string
		origin  string
		allowed []string
		want    bool
	}{
		{name: "missing origin", host: "quiz.example.com", want: true},
		{name: "same origin", host: "quiz.example.com", origin: "https://quiz.example.com", want: true},
		{name: "external origin", host: "quiz.example.com", origin: "https://evil.example", want: false},
		{name: "configured origin", host: "quiz.example.com", origin: "https://preview.example", allowed: []string{"https://preview.example"}, want: true},
		{name: "local development", host: "localhost:8080", origin: "http://localhost:5173", want: true},
		{name: "malformed origin", host: "quiz.example.com", origin: "://bad", want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequest("GET", "http://"+tt.host+"/ws", nil)
			r.Host = tt.host
			if tt.origin != "" {
				r.Header.Set("Origin", tt.origin)
			}
			if got := originAllowed(r, tt.allowed); got != tt.want {
				t.Fatalf("originAllowed() = %v, want %v", got, tt.want)
			}
		})
	}
}
