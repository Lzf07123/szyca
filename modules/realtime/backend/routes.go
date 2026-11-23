package ws

import (
	"net/http"

	"szyca/backend/contract"
	"szyca/backend/core/httpx"
)

func (m *module) RegisterHTTP(mux *http.ServeMux, api contract.HTTP) error {
	mux.HandleFunc("GET /ws", api.AnyFeature(
		[]string{"quiz", "screen"},
		Serve(m.service.Hub(), api.ValidateToken, api.WSAllowedOrigins()),
	))
	mux.HandleFunc("POST /api/admin/announce", api.Permission("quiz.operate", func(
		w http.ResponseWriter,
		r *http.Request,
		_ contract.Principal,
	) {
		m.handleAnnounce(w, r)
	}))
	mux.HandleFunc("POST /api/admin/effect", api.Permission("quiz.operate", func(
		w http.ResponseWriter,
		r *http.Request,
		_ contract.Principal,
	) {
		m.handleEffect(w, r)
	}))
	return nil
}

func (m *module) handleAnnounce(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Content string `json:"content"`
		Type    string `json:"type"`
	}
	if err := httpx.ReadJSON(r, &request); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "请求体格式错误")
		return
	}
	if err := m.service.Announce(r.Context(), request.Content, request.Type); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"ok": "true"})
}

func (m *module) handleEffect(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Kind string `json:"kind"`
	}
	_ = httpx.ReadJSON(r, &request)
	if err := m.service.Effect(r.Context(), request.Kind); err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"ok": "true", "kind": request.Kind})
}
