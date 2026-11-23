package httpapi

import (
	"net/http"

	"szyca/internal/site"
	"szyca/internal/ws"
)

func (s *Server) registerRealtimeRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /ws", s.withAnyFeature(
		[]string{site.FeatureQuiz, site.FeatureScreen},
		ws.Serve(s.hub, s.validateToken, s.cfg.WSAllowedOrigins),
	))
	mux.HandleFunc("POST /api/admin/announce", s.withPermission("quiz.operate", s.handleAdminAnnounce))
	mux.HandleFunc("POST /api/admin/effect", s.withPermission("quiz.operate", s.handleAdminEffect))
}
