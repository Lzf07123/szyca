package httpapi

import (
	"net/http"

	"szyca/internal/site"
)

func (s *Server) registerJoinRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/qrcode", s.withFeature(site.FeatureJoin, s.handleQrcode))
	mux.HandleFunc("GET /api/admin/qrcodes", s.withPermission("site.read", s.handleAdminListQrcodes))
	mux.HandleFunc("POST /api/admin/qrcodes", s.withPermission("site.write", s.handleAdminAddQrcode))
	mux.HandleFunc("POST /api/admin/qrcodes/{id}", s.withPermission("site.write", s.handleAdminUpdateQrcode))
	mux.HandleFunc("DELETE /api/admin/qrcodes/{id}", s.withPermission("site.write", s.handleAdminDeleteQrcode))
}
