package httpapi

import (
	"context"
	"net/http"
	"time"
)

// registerCoreRoutes contains the site shell and platform governance routes.
// Feature modules are composed separately through apiRouteModules.
func (s *Server) registerCoreRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := s.readiness.Ready(ctx); err != nil {
			writeErr(w, http.StatusServiceUnavailable, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
	})

	mux.HandleFunc("GET /api/site", s.handleSite)
	mux.HandleFunc("GET /api/runtime", s.handlePublicRuntime)
	mux.HandleFunc("GET /api/backgrounds", s.handleBackgrounds)
	mux.HandleFunc("GET /api/config", s.handleConfig)
	mux.HandleFunc("GET /api/content/pages/{slug}", s.handleSitePage)

	mux.HandleFunc("POST /api/admin/auth/login", s.handleAdminLogin)
	mux.HandleFunc("GET /api/admin/auth/status", s.handleAdminAuthStatus)
	mux.HandleFunc("GET /api/admin/auth/me", s.withAuthenticated(s.handleAdminMe))
	mux.HandleFunc("POST /api/admin/auth/logout", s.withAuthenticated(s.handleAdminLogout))
	mux.HandleFunc("GET /api/admin/accounts", s.withPermission("access.manage", s.handleAdminListAccounts))
	mux.HandleFunc("POST /api/admin/accounts", s.withPermission("access.manage", s.handleAdminCreateAccount))
	mux.HandleFunc("POST /api/admin/accounts/{id}/disabled", s.withPermission("access.manage", s.handleAdminDisableAccount))
	mux.HandleFunc("GET /api/admin/audit", s.withPermission("audit.read", s.handleAdminAudit))

	mux.HandleFunc("GET /api/admin/site", s.withPermission("site.read", s.handleAdminSite))
	mux.HandleFunc("GET /api/admin/site/sections", s.withPermission("site.read", s.handleAdminSections))
	mux.HandleFunc("GET /api/admin/site/section-plugins", s.withPermission("site.read", s.handleAdminSectionPlugins))
	mux.HandleFunc("PUT /api/admin/site/sections", s.withPermission("site.write", s.handleAdminSaveSections))
	mux.HandleFunc("GET /api/admin/platform/features", s.withPermission("site.read", s.handleAdminFeatures))
	mux.HandleFunc("PUT /api/admin/platform/features", s.withAuthenticated(s.handleAdminSaveFeatures))
	mux.HandleFunc("GET /api/admin/overview", s.withPermission("site.read", s.handleAdminOverview))

	mux.HandleFunc("GET /api/admin/media", s.withPermission("media.read", s.handleAdminMedia))
	mux.HandleFunc("DELETE /api/admin/media/{id}", s.withPermission("media.write", s.handleAdminDeleteMedia))
	mux.HandleFunc("POST /api/admin/backgrounds", s.withPermission("media.write", s.handleAdminUploadBackground))
	mux.HandleFunc("GET /api/admin/backgrounds", s.withPermission("media.read", s.handleAdminListBackgrounds))
	mux.HandleFunc("POST /api/admin/backgrounds/{id}/active", s.withPermission("media.write", s.handleAdminSetBgActive))
	mux.HandleFunc("DELETE /api/admin/backgrounds/{id}", s.withPermission("media.write", s.handleAdminDeleteBackground))
	mux.HandleFunc("DELETE /api/admin/backgrounds", s.withPermission("media.write", s.handleAdminClearBackgrounds))
	mux.HandleFunc("POST /api/admin/uploads", s.withPermission("media.write", s.handleAdminUpload))
	mux.HandleFunc("GET /api/admin/footer", s.withPermission("site.read", s.handleAdminGetFooter))
	mux.HandleFunc("POST /api/admin/footer", s.withPermission("site.write", s.handleAdminSaveFooter))
	mux.HandleFunc("GET /api/admin/logo", s.withPermission("site.read", s.handleAdminGetLogo))
	mux.HandleFunc("POST /api/admin/logo", s.withPermission("site.write", s.handleAdminSaveLogo))

	mux.Handle("GET /uploads/", http.StripPrefix("/uploads/", http.FileServer(http.Dir(s.cfg.UploadDir))))
}
