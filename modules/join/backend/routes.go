package join

import (
	"errors"
	"net/http"
	"strconv"

	"szyca/backend/contract"
	"szyca/backend/core/httpx"
)

func (m *module) RegisterHTTP(mux *http.ServeMux, api contract.HTTP) error {
	mux.HandleFunc("GET /api/qrcode", api.Feature("join", m.handleQrcode))
	mux.HandleFunc("GET /api/admin/qrcodes", api.Permission("site.read", func(
		w http.ResponseWriter,
		r *http.Request,
		_ contract.Principal,
	) {
		m.handleAdminListQrcodes(w, r)
	}))
	mux.HandleFunc("POST /api/admin/qrcodes", api.Permission("site.write", func(
		w http.ResponseWriter,
		r *http.Request,
		principal contract.Principal,
	) {
		m.handleAdminAddQrcode(w, r, principal, api)
	}))
	mux.HandleFunc("POST /api/admin/qrcodes/{id}", api.Permission("site.write", func(
		w http.ResponseWriter,
		r *http.Request,
		principal contract.Principal,
	) {
		m.handleAdminUpdateQrcode(w, r, principal, api)
	}))
	mux.HandleFunc("DELETE /api/admin/qrcodes/{id}", api.Permission("site.write", func(
		w http.ResponseWriter,
		r *http.Request,
		_ contract.Principal,
	) {
		m.handleAdminDeleteQrcode(w, r, api)
	}))
	return nil
}

func (m *module) handleQrcode(w http.ResponseWriter, r *http.Request) {
	qrcodes, err := m.service.Qrcodes(r.Context())
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"qrcodes": qrcodes})
}

func (m *module) handleAdminListQrcodes(w http.ResponseWriter, r *http.Request) {
	qrcodes, err := m.service.AllQrcodes(r.Context())
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"qrcodes": qrcodes})
}

func (m *module) handleAdminAddQrcode(
	w http.ResponseWriter,
	r *http.Request,
	principal contract.Principal,
	api contract.HTTP,
) {
	url, ok := api.SaveImage(w, r)
	if !ok {
		return
	}
	qrcode, err := m.service.AddQrcode(r.Context(), r.FormValue("title"), url)
	if err != nil {
		api.RemoveFile(url)
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	api.AttachMedia(r, principal, url, "site", "qrcode", strconv.FormatInt(qrcode.ID, 10))
	httpx.WriteJSON(w, http.StatusOK, qrcode)
}

func (m *module) handleAdminUpdateQrcode(
	w http.ResponseWriter,
	r *http.Request,
	principal contract.Principal,
	api contract.HTTP,
) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "id 无效")
		return
	}
	var request struct {
		Title    *string `json:"title"`
		ImageURL *string `json:"image_url"`
		Active   *bool   `json:"active"`
	}
	if err := httpx.ReadJSON(r, &request); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "请求体格式错误")
		return
	}
	oldImage, err := m.service.UpdateQrcode(r.Context(), id, request.Title, request.ImageURL, request.Active)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httpx.WriteError(w, http.StatusNotFound, "二维码不存在")
			return
		}
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	if oldImage != "" {
		if request.ImageURL != nil {
			api.AttachMedia(r, principal, *request.ImageURL, "site", "qrcode", strconv.FormatInt(id, 10))
		}
		if request.ImageURL == nil || oldImage != *request.ImageURL {
			api.ReleaseAndCleanup(r, oldImage, "site", "qrcode", strconv.FormatInt(id, 10))
		}
	} else if request.ImageURL != nil {
		api.AttachMedia(r, principal, *request.ImageURL, "site", "qrcode", strconv.FormatInt(id, 10))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": "true"})
}

func (m *module) handleAdminDeleteQrcode(w http.ResponseWriter, r *http.Request, api contract.HTTP) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "id 无效")
		return
	}
	imageURL, err := m.service.DeleteQrcode(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	api.ReleaseAndCleanup(r, imageURL, "site", "qrcode", strconv.FormatInt(id, 10))
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"id": id, "ok": "true"})
}
