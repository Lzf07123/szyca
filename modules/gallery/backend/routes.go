package gallery

import (
	"net/http"
	"strconv"

	"szyca/backend/contract"
	"szyca/backend/core/httpx"
)

func (m *module) RegisterHTTP(mux *http.ServeMux, api contract.HTTP) error {
	mux.HandleFunc("GET /api/admin/gallery/{sectionID}/images", api.Permission(
		"site.read",
		func(w http.ResponseWriter, r *http.Request, _ contract.Principal) {
			m.handleImages(w, r)
		},
	))
	mux.HandleFunc("POST /api/admin/gallery/{sectionID}/images", api.Permission(
		"site.write",
		func(w http.ResponseWriter, r *http.Request, principal contract.Principal) {
			m.handleUpload(w, r, principal, api)
		},
	))
	mux.HandleFunc("POST /api/admin/gallery/{sectionID}/images/{imageID}", api.Permission(
		"site.write",
		func(w http.ResponseWriter, r *http.Request, _ contract.Principal) {
			m.handleUpdate(w, r)
		},
	))
	mux.HandleFunc("DELETE /api/admin/gallery/{sectionID}/images/{imageID}", api.Permission(
		"site.write",
		func(w http.ResponseWriter, r *http.Request, _ contract.Principal) {
			m.handleDelete(w, r, api)
		},
	))
	mux.HandleFunc("PUT /api/admin/gallery/{sectionID}/images/order", api.Permission(
		"site.write",
		func(w http.ResponseWriter, r *http.Request, _ contract.Principal) {
			m.handleReorder(w, r)
		},
	))
	return nil
}

func (m *module) handleImages(w http.ResponseWriter, r *http.Request) {
	sectionID, err := httpx.ParseID(r.PathValue("sectionID"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	images, err := m.service.Images(r.Context(), sectionID)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"images": images})
}

func (m *module) handleUpload(
	w http.ResponseWriter,
	r *http.Request,
	principal contract.Principal,
	api contract.HTTP,
) {
	sectionID, err := httpx.ParseID(r.PathValue("sectionID"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := m.service.Images(r.Context(), sectionID); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	imageURL, ok := api.SaveImage(w, r)
	if !ok {
		return
	}
	image, err := m.service.Create(
		r.Context(), principal.ID, sectionID, r.FormValue("title"), imageURL,
	)
	if err != nil {
		api.RemoveFile(imageURL)
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	api.AttachMedia(
		r, principal, image.ImageURL, "gallery", "image", strconv.FormatInt(image.ID, 10),
	)
	httpx.WriteJSON(w, http.StatusOK, image)
}

func (m *module) handleUpdate(w http.ResponseWriter, r *http.Request) {
	sectionID, imageID, ok := galleryPathIDs(r)
	if !ok {
		httpx.WriteError(w, http.StatusBadRequest, "资源 ID 无效")
		return
	}
	var request struct {
		Title string `json:"title"`
	}
	if err := httpx.ReadJSON(r, &request); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "请求体格式错误")
		return
	}
	image, err := m.service.Update(r.Context(), sectionID, imageID, request.Title)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, image)
}

func (m *module) handleDelete(w http.ResponseWriter, r *http.Request, api contract.HTTP) {
	sectionID, imageID, ok := galleryPathIDs(r)
	if !ok {
		httpx.WriteError(w, http.StatusBadRequest, "资源 ID 无效")
		return
	}
	imageURL, err := m.service.Delete(r.Context(), sectionID, imageID)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	api.ReleaseAndCleanup(
		r, imageURL, "gallery", "image", strconv.FormatInt(imageID, 10),
	)
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"id": imageID, "ok": "true"})
}

func (m *module) handleReorder(w http.ResponseWriter, r *http.Request) {
	sectionID, err := httpx.ParseID(r.PathValue("sectionID"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	var request struct {
		IDs []int64 `json:"ids"`
	}
	if err := httpx.ReadJSON(r, &request); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "请求体格式错误")
		return
	}
	if err := m.service.Reorder(r.Context(), sectionID, request.IDs); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	images, err := m.service.Images(r.Context(), sectionID)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"images": images})
}

func galleryPathIDs(r *http.Request) (int64, int64, bool) {
	sectionID, err := httpx.ParseID(r.PathValue("sectionID"))
	if err != nil {
		return 0, 0, false
	}
	imageID, err := httpx.ParseID(r.PathValue("imageID"))
	if err != nil {
		return 0, 0, false
	}
	return sectionID, imageID, true
}
