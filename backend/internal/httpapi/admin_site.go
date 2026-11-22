package httpapi

import (
	"encoding/json"
	"net/http"

	"szyca/internal/access"
	"szyca/internal/site"
)

func (s *Server) handleSitePage(w http.ResponseWriter, r *http.Request) {
	page, err := s.site.Page(r.Context(), r.PathValue("slug"))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if page == nil {
		writeErrCode(w, http.StatusNotFound, "内容页面不存在", "not_found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"page": page})
}

func (s *Server) handleAdminSite(w http.ResponseWriter, r *http.Request) {
	public, err := s.site.Public(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, public)
}

func (s *Server) handleAdminSections(w http.ResponseWriter, r *http.Request) {
	sections, err := s.site.AdminSections(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sections": sections})
}

func (s *Server) handleAdminSaveSections(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Sections []site.SectionUpdate `json:"sections"`
	}
	if err := readJSON(r, &request); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体格式错误")
		return
	}
	principal := principalFromRequest(r)
	if err := s.site.UpdateSections(r.Context(), principal.ID, request.Sections); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"ok": "true"})
}

func (s *Server) handleAdminFeatures(w http.ResponseWriter, r *http.Request) {
	features, err := s.site.Features(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"features": features})
}

func (s *Server) handleAdminSaveFeatures(
	w http.ResponseWriter,
	r *http.Request,
	principal access.Principal,
) {
	var request struct {
		Features []site.FeatureUpdate `json:"features"`
	}
	if err := readJSON(r, &request); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体格式错误")
		return
	}
	for _, feature := range request.Features {
		permission := "site.write"
		if feature.Key == site.FeatureLottery {
			permission = "lottery.configure"
		}
		if !access.Can(principal, permission) {
			writeErrCode(w, http.StatusForbidden, "当前角色无权修改该模块开关", "forbidden")
			return
		}
	}
	s.auditWrite(principal, func(w http.ResponseWriter, r *http.Request) {
		if err := s.site.UpdateFeatures(r.Context(), principal.ID, request.Features); err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"ok": "true"})
	}).ServeHTTP(w, r)
}

// Keep JSON strongly validated at this boundary so callers cannot persist
// arbitrary HTML through a generic map.
func decodeObject(raw json.RawMessage, target any) error {
	return json.Unmarshal(raw, target)
}
