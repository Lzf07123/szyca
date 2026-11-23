package httpapi

import (
	"net/http"

	"szyca/internal/site"
)

func (s *Server) registerLotteryRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/lottery/campaign", s.withFeature(site.FeatureLottery, s.handleLotteryCampaign))
	mux.HandleFunc("POST /api/lottery/draw", s.withFeature(site.FeatureLottery, s.withUser(s.handleLotteryDraw)))
	mux.HandleFunc("GET /api/lottery/me", s.withFeature(site.FeatureLottery, s.withUser(s.handleLotteryMe)))

	mux.HandleFunc("GET /api/admin/lottery/campaigns", s.withPermission("lottery.configure", s.handleAdminLotteryCampaigns))
	mux.HandleFunc("POST /api/admin/lottery/campaigns", s.withPermission("lottery.configure", s.handleAdminSaveLotteryCampaign))
	mux.HandleFunc("POST /api/admin/lottery/campaigns/{id}/status", s.withPermission("lottery.configure", s.handleAdminLotteryStatus))
	mux.HandleFunc("POST /api/admin/lottery/campaigns/{id}/prizes", s.withPermission("lottery.configure", s.handleAdminSaveLotteryPrize))
	mux.HandleFunc("DELETE /api/admin/lottery/campaigns/{id}/prizes/{prizeId}", s.withPermission("lottery.configure", s.handleAdminDeleteLotteryPrize))
	mux.HandleFunc("GET /api/admin/lottery/draws", s.withPermission("lottery.configure", s.handleAdminLotteryDraws))
	mux.HandleFunc("POST /api/admin/lottery/draws/{id}/claim", s.withPermission("lottery.claim", s.handleAdminLotteryClaim))
	mux.HandleFunc("GET /api/admin/lottery/export", s.withPermission("lottery.configure", s.handleAdminLotteryExport))
}
