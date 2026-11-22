package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
)

// handleSite is the public composition boundary. The public layout needs only
// this one request for brand, navigation, footer, flags, sections, backgrounds
// and QR resources; legacy endpoints remain available during migration.
func (s *Server) handleSite(w http.ResponseWriter, r *http.Request) {
	data, err := s.site.Public(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	body, err := json.Marshal(data)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "站点配置序列化失败")
		return
	}
	sum := sha256.Sum256(body)
	etag := `"` + hex.EncodeToString(sum[:16]) + `"`
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "public, max-age=15, stale-while-revalidate=45")
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}
