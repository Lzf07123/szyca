package lottery

import (
	"encoding/csv"
	"errors"
	"net/http"
	"time"

	"szyca/backend/contract"
	"szyca/backend/core/httpx"
)

func (m *module) registerNumberRoutes(mux *http.ServeMux, api contract.HTTP) {
	mux.HandleFunc("GET /api/admin/lottery/modes", api.Permission(
		"lottery.configure",
		func(w http.ResponseWriter, r *http.Request, _ contract.Principal) {
			m.handleNumberModes(w, r)
		},
	))
	mux.HandleFunc("PUT /api/admin/lottery/modes", api.Permission(
		"lottery.configure",
		func(w http.ResponseWriter, r *http.Request, principal contract.Principal) {
			m.handleNumberSaveModes(w, r, principal)
		},
	))
	mux.HandleFunc("GET /api/admin/lottery/number-events", api.Permission(
		"lottery.configure",
		func(w http.ResponseWriter, r *http.Request, _ contract.Principal) {
			m.handleNumberEvents(w, r)
		},
	))
	mux.HandleFunc("POST /api/admin/lottery/number-events", api.Permission(
		"lottery.configure",
		func(w http.ResponseWriter, r *http.Request, principal contract.Principal) {
			m.handleNumberSaveEvent(w, r, principal)
		},
	))
	mux.HandleFunc("GET /api/admin/lottery/number-events/{id}", api.Permission(
		"lottery.configure",
		func(w http.ResponseWriter, r *http.Request, _ contract.Principal) {
			m.handleNumberEvent(w, r)
		},
	))
	mux.HandleFunc("DELETE /api/admin/lottery/number-events/{id}", api.Permission(
		"lottery.configure",
		func(w http.ResponseWriter, r *http.Request, _ contract.Principal) {
			m.handleNumberDeleteEvent(w, r)
		},
	))
	mux.HandleFunc("POST /api/admin/lottery/number-events/{id}/publish", api.Permission(
		"lottery.configure",
		func(w http.ResponseWriter, r *http.Request, principal contract.Principal) {
			m.handleNumberPublish(w, r, principal)
		},
	))
	mux.HandleFunc("POST /api/admin/lottery/number-events/{id}/archive", api.Permission(
		"lottery.configure",
		func(w http.ResponseWriter, r *http.Request, principal contract.Principal) {
			m.handleNumberArchive(w, r, principal)
		},
	))
	mux.HandleFunc("POST /api/admin/lottery/number-events/{id}/draw", api.Permission(
		"lottery.configure",
		func(w http.ResponseWriter, r *http.Request, principal contract.Principal) {
			m.handleNumberDraw(w, r, principal)
		},
	))
	mux.HandleFunc("GET /api/admin/lottery/number-events/{id}/export", api.Permission(
		"lottery.configure",
		func(w http.ResponseWriter, r *http.Request, _ contract.Principal) {
			m.handleNumberExport(w, r)
		},
	))
}

func (m *module) handleNumberBoard(w http.ResponseWriter, r *http.Request) {
	board, err := m.number.Board(r.Context())
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusOK, board)
}

func (m *module) handleNumberModes(w http.ResponseWriter, r *http.Request) {
	settings, err := m.number.Modes(r.Context())
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"modes": settings})
}

func (m *module) handleNumberSaveModes(
	w http.ResponseWriter,
	r *http.Request,
	principal contract.Principal,
) {
	var request NumberModeSettings
	if err := httpx.ReadJSON(r, &request); err != nil {
		httpx.WriteErrorCode(w, http.StatusBadRequest, "请求体格式错误", "invalid_request")
		return
	}
	settings, err := m.number.SaveModes(r.Context(), principal.ID, request)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"modes": settings})
}

func (m *module) handleNumberEvents(w http.ResponseWriter, r *http.Request) {
	events, err := m.number.AdminEvents(r.Context())
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"events": events})
}

func (m *module) handleNumberSaveEvent(
	w http.ResponseWriter,
	r *http.Request,
	principal contract.Principal,
) {
	var input NumberEventInput
	if err := httpx.ReadJSON(r, &input); err != nil {
		httpx.WriteErrorCode(w, http.StatusBadRequest, "请求体格式错误", "invalid_request")
		return
	}
	detail, err := m.number.SaveDraft(r.Context(), principal.ID, input)
	if err != nil {
		m.writeNumberError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"event":  detail.Event,
		"levels": detail.Levels,
	})
}

func (m *module) handleNumberEvent(w http.ResponseWriter, r *http.Request) {
	eventID, err := httpx.ParseID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "场次 ID 无效")
		return
	}
	detail, err := m.number.AdminEvent(r.Context(), eventID)
	if err != nil {
		m.writeNumberError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"event":  detail.Event,
		"levels": detail.Levels,
	})
}

func (m *module) handleNumberDeleteEvent(w http.ResponseWriter, r *http.Request) {
	eventID, err := httpx.ParseID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "场次 ID 无效")
		return
	}
	if err := m.number.DeleteDraft(r.Context(), eventID); err != nil {
		m.writeNumberError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"ok": "true"})
}

func (m *module) handleNumberPublish(
	w http.ResponseWriter,
	r *http.Request,
	principal contract.Principal,
) {
	eventID, err := httpx.ParseID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "场次 ID 无效")
		return
	}
	detail, err := m.number.Publish(r.Context(), eventID, principal.ID)
	if err != nil {
		m.writeNumberError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"event":  detail.Event,
		"levels": detail.Levels,
	})
}

func (m *module) handleNumberArchive(
	w http.ResponseWriter,
	r *http.Request,
	principal contract.Principal,
) {
	eventID, err := httpx.ParseID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "场次 ID 无效")
		return
	}
	detail, err := m.number.Archive(r.Context(), eventID, principal.ID)
	if err != nil {
		m.writeNumberError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"event":  detail.Event,
		"levels": detail.Levels,
	})
}

func (m *module) handleNumberDraw(
	w http.ResponseWriter,
	r *http.Request,
	principal contract.Principal,
) {
	eventID, err := httpx.ParseID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "场次 ID 无效")
		return
	}
	var input NumberDrawInput
	if err := httpx.ReadJSON(r, &input); err != nil {
		httpx.WriteErrorCode(w, http.StatusBadRequest, "请求体格式错误", "invalid_request")
		return
	}
	result, err := m.number.Draw(r.Context(), eventID, principal.ID, input)
	if err != nil {
		m.writeNumberError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"draw": result})
}

func (m *module) handleNumberExport(w http.ResponseWriter, r *http.Request) {
	eventID, err := httpx.ParseID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "场次 ID 无效")
		return
	}
	rows, err := m.number.ExportRows(r.Context(), eventID)
	if err != nil {
		m.writeNumberError(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set(
		"Content-Disposition",
		`attachment; filename="lottery-number-`+
			time.Now().Format("20060102-150405")+`.csv"`,
	)
	_, _ = w.Write([]byte{0xEF, 0xBB, 0xBF})
	writer := csv.NewWriter(w)
	_ = writer.Write([]string{"场次", "等级", "中奖号码", "开奖时间", "操作员"})
	for _, row := range rows {
		_ = writer.Write([]string{
			httpx.CSVSafe(row.Event),
			httpx.CSVSafe(row.Level),
			row.Number,
			row.DrawnAt.Format(time.RFC3339),
			httpx.CSVSafe(row.Operator),
		})
	}
	writer.Flush()
}

func (m *module) writeNumberError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrNumberInvalid):
		httpx.WriteErrorCode(w, http.StatusBadRequest, err.Error(), "invalid_number_event")
	case errors.Is(err, ErrNumberEventNotFound):
		httpx.WriteErrorCode(w, http.StatusNotFound, err.Error(), "event_not_found")
	case errors.Is(err, ErrNumberEventNotDraft):
		httpx.WriteErrorCode(w, http.StatusConflict, err.Error(), "event_not_draft")
	case errors.Is(err, ErrNumberEventNotLive):
		httpx.WriteErrorCode(w, http.StatusConflict, err.Error(), "event_not_live")
	case errors.Is(err, ErrNumberLiveExists):
		httpx.WriteErrorCode(w, http.StatusConflict, err.Error(), "live_event_exists")
	case errors.Is(err, ErrNumberDrawComplete):
		httpx.WriteErrorCode(w, http.StatusConflict, err.Error(), "event_complete")
	case errors.Is(err, ErrNumberDrawOutOfOrder):
		httpx.WriteErrorCode(w, http.StatusConflict, err.Error(), "level_out_of_order")
	case errors.Is(err, ErrNumberLevelDrawn):
		httpx.WriteErrorCode(w, http.StatusConflict, err.Error(), "level_already_drawn")
	case errors.Is(err, ErrNumberDrawRequest):
		httpx.WriteErrorCode(w, http.StatusConflict, err.Error(), "draw_request_conflict")
	default:
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
	}
}
