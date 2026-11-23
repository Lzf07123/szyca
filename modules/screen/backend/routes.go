package screen

import (
	"log"
	"net/http"
	"strconv"
	"time"

	"szyca/backend/contract"
	"szyca/backend/core/httpx"
)

func (m *module) RegisterHTTP(mux *http.ServeMux, api contract.HTTP) error {
	mux.HandleFunc("GET /api/rank", api.Feature("screen", m.handleRank))
	return nil
}

func (m *module) handleRank(w http.ResponseWriter, r *http.Request) {
	started := time.Now()
	defer func() {
		if elapsed := time.Since(started); elapsed > 80*time.Millisecond {
			log.Printf("rank slow: %v", elapsed)
		}
	}()
	limit := 99
	if value := r.URL.Query().Get("top"); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil && parsed > 0 && parsed <= 500 {
			limit = parsed
		}
	}
	entries, total, err := m.service.Leaderboard(r.Context(), limit)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"entries": entries, "total": total})
}
