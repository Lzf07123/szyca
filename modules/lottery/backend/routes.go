package lottery

import (
	"encoding/csv"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"

	"szyca/backend/contract"
	"szyca/backend/core/httpx"
)

func (m *module) RegisterHTTP(mux *http.ServeMux, api contract.HTTP) error {
	mux.HandleFunc("GET /api/lottery/campaign", api.Feature("lottery", func(
		w http.ResponseWriter,
		r *http.Request,
	) {
		m.handleCampaign(w, r, api)
	}))
	mux.HandleFunc(
		"POST /api/lottery/draw",
		api.Feature("lottery", m.requirePersonal(api.User(m.handleDraw))),
	)
	mux.HandleFunc(
		"GET /api/lottery/me",
		api.Feature("lottery", m.requirePersonal(api.User(m.handleMe))),
	)
	mux.HandleFunc("GET /api/lottery/board", api.Feature("lottery", m.handleNumberBoard))

	mux.HandleFunc("GET /api/admin/lottery/campaigns", api.Permission("lottery.configure", func(
		w http.ResponseWriter,
		r *http.Request,
		_ contract.Principal,
	) {
		m.handleAdminCampaigns(w, r)
	}))
	mux.HandleFunc("POST /api/admin/lottery/campaigns", api.Permission("lottery.configure", func(
		w http.ResponseWriter,
		r *http.Request,
		principal contract.Principal,
	) {
		m.handleAdminSaveCampaign(w, r, principal)
	}))
	mux.HandleFunc("POST /api/admin/lottery/campaigns/{id}/status", api.Permission("lottery.configure", func(
		w http.ResponseWriter,
		r *http.Request,
		_ contract.Principal,
	) {
		m.handleAdminStatus(w, r)
	}))
	mux.HandleFunc("POST /api/admin/lottery/campaigns/{id}/prizes", api.Permission("lottery.configure", func(
		w http.ResponseWriter,
		r *http.Request,
		_ contract.Principal,
	) {
		m.handleAdminSavePrize(w, r)
	}))
	mux.HandleFunc("DELETE /api/admin/lottery/campaigns/{id}/prizes/{prizeId}", api.Permission(
		"lottery.configure",
		func(w http.ResponseWriter, r *http.Request, _ contract.Principal) {
			m.handleAdminDeletePrize(w, r)
		},
	))
	mux.HandleFunc("GET /api/admin/lottery/draws", api.Permission("lottery.configure", func(
		w http.ResponseWriter,
		r *http.Request,
		_ contract.Principal,
	) {
		m.handleAdminDraws(w, r)
	}))
	mux.HandleFunc("POST /api/admin/lottery/draws/{id}/claim", api.Permission("lottery.claim", func(
		w http.ResponseWriter,
		r *http.Request,
		principal contract.Principal,
	) {
		m.handleAdminClaim(w, r, principal)
	}))
	mux.HandleFunc("GET /api/admin/lottery/export", api.Permission("lottery.configure", func(
		w http.ResponseWriter,
		r *http.Request,
		_ contract.Principal,
	) {
		m.handleAdminExport(w, r)
	}))
	m.registerNumberRoutes(mux, api)
	return nil
}

func (m *module) handleCampaign(w http.ResponseWriter, r *http.Request, api contract.HTTP) {
	enabled, err := m.number.PersonalEnabled(r.Context())
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !enabled {
		httpx.WriteErrorCode(w, http.StatusNotFound, "个人抽奖当前未开放", "mode_disabled")
		return
	}
	user, err := api.OptionalUser(r)
	if err != nil {
		httpx.WriteErrorCode(w, http.StatusUnauthorized, "token 无效", "unauthorized")
		return
	}
	var userID *int64
	if user != nil {
		userID = &user.ID
	}
	status, err := m.service.PublicCampaign(r.Context(), userID)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, status)
}

func (m *module) requirePersonal(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		enabled, err := m.number.PersonalEnabled(r.Context())
		if err != nil {
			httpx.WriteError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if !enabled {
			httpx.WriteErrorCode(w, http.StatusNotFound, "个人抽奖当前未开放", "mode_disabled")
			return
		}
		next(w, r)
	}
}

func (m *module) handleDraw(w http.ResponseWriter, r *http.Request, user contract.User) {
	var request struct {
		RequestID string `json:"request_id"`
	}
	if err := httpx.ReadJSON(r, &request); err != nil {
		httpx.WriteErrorCode(w, http.StatusBadRequest, "请求体格式错误", "invalid_request")
		return
	}
	draw, err := m.service.Draw(r.Context(), user.ID, request.RequestID)
	switch {
	case errors.Is(err, ErrCampaignNotActive):
		httpx.WriteErrorCode(w, http.StatusConflict, err.Error(), "campaign_not_active")
	case errors.Is(err, ErrNotEligible):
		httpx.WriteErrorCode(w, http.StatusForbidden, "完成答题资格后再参与抽奖", "not_eligible")
	case errors.Is(err, ErrAlreadyDrawn):
		httpx.WriteErrorCode(w, http.StatusConflict, err.Error(), "already_drawn")
	case errors.Is(err, ErrRequestConflict):
		httpx.WriteErrorCode(w, http.StatusConflict, err.Error(), "request_conflict")
	case errors.Is(err, ErrInvalidRequest):
		httpx.WriteErrorCode(w, http.StatusBadRequest, err.Error(), "invalid_request")
	case err != nil:
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
	default:
		httpx.WriteJSON(w, http.StatusOK, draw)
	}
}

func (m *module) handleMe(w http.ResponseWriter, r *http.Request, user contract.User) {
	status, err := m.service.PublicCampaign(r.Context(), &user.ID)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, status)
}

func (m *module) handleAdminCampaigns(w http.ResponseWriter, r *http.Request) {
	campaigns, err := m.service.AdminCampaigns(r.Context())
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"campaigns": campaigns})
}

func (m *module) handleAdminSaveCampaign(
	w http.ResponseWriter,
	r *http.Request,
	principal contract.Principal,
) {
	var input CampaignInput
	if err := httpx.ReadJSON(r, &input); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "请求体格式错误")
		return
	}
	campaign, err := m.service.SaveCampaign(r.Context(), principal.ID, input)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"campaign": campaign})
}

func (m *module) handleAdminStatus(w http.ResponseWriter, r *http.Request) {
	campaignID, err := httpx.ParseID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "活动 ID 无效")
		return
	}
	var request struct {
		Status string `json:"status"`
	}
	if err := httpx.ReadJSON(r, &request); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "请求体格式错误")
		return
	}
	if err := m.service.SetCampaignStatus(r.Context(), campaignID, request.Status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteError(w, http.StatusNotFound, "抽奖活动不存在")
			return
		}
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"ok": "true", "status": request.Status})
}

func (m *module) handleAdminSavePrize(w http.ResponseWriter, r *http.Request) {
	campaignID, err := httpx.ParseID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "活动 ID 无效")
		return
	}
	var input PrizeInput
	if err := httpx.ReadJSON(r, &input); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "请求体格式错误")
		return
	}
	prize, err := m.service.SavePrize(r.Context(), campaignID, input)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"prize": prize})
}

func (m *module) handleAdminDeletePrize(w http.ResponseWriter, r *http.Request) {
	campaignID, err := httpx.ParseID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "活动 ID 无效")
		return
	}
	prizeID, err := httpx.ParseID(r.PathValue("prizeId"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "奖品 ID 无效")
		return
	}
	err = m.service.DeletePrize(r.Context(), campaignID, prizeID)
	if errors.Is(err, ErrPrizeInUse) {
		httpx.WriteErrorCode(w, http.StatusConflict, err.Error(), "prize_in_use")
		return
	}
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteError(w, http.StatusNotFound, "奖品不存在")
		return
	}
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"ok": "true"})
}

func (m *module) handleAdminDraws(w http.ResponseWriter, r *http.Request) {
	campaignID, _ := strconv.ParseInt(r.URL.Query().Get("campaign_id"), 10, 64)
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	draws, err := m.service.AdminDraws(r.Context(), campaignID, limit)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"draws": draws})
}

func (m *module) handleAdminClaim(
	w http.ResponseWriter,
	r *http.Request,
	principal contract.Principal,
) {
	drawID, err := httpx.ParseID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "抽奖记录 ID 无效")
		return
	}
	draw, err := m.service.Claim(r.Context(), drawID, principal.ID)
	if err != nil {
		httpx.WriteError(w, http.StatusConflict, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"draw": draw})
}

func (m *module) handleAdminExport(w http.ResponseWriter, r *http.Request) {
	campaignID, _ := strconv.ParseInt(r.URL.Query().Get("campaign_id"), 10, 64)
	draws, err := m.service.AdminDraws(r.Context(), campaignID, 1000)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set(
		"Content-Disposition",
		`attachment; filename="lottery-draws-`+time.Now().Format("20060102-150405")+`.csv"`,
	)
	_, _ = w.Write([]byte{0xEF, 0xBB, 0xBF})
	writer := csv.NewWriter(w)
	_ = writer.Write([]string{
		"活动", "抽奖记录", "用户ID", "昵称", "结果", "奖品",
		"领取状态", "request_id", "抽奖时间", "领取时间",
	})
	for _, draw := range draws {
		claimStatus := "未领取"
		if draw.Status == "claimed" {
			claimStatus = "已领取"
		} else if draw.Status == "no_win" {
			claimStatus = "无需领取"
		}
		claimedAt := ""
		if draw.ClaimedAt != nil {
			claimedAt = draw.ClaimedAt.Format(time.RFC3339)
		}
		_ = writer.Write([]string{
			httpx.CSVSafe(draw.Campaign),
			strconv.FormatInt(draw.ID, 10),
			strconv.FormatInt(draw.UserID, 10),
			httpx.CSVSafe(draw.Nickname),
			draw.Status,
			httpx.CSVSafe(draw.Prize),
			claimStatus,
			httpx.CSVSafe(draw.RequestID),
			draw.CreatedAt.Format(time.RFC3339),
			claimedAt,
		})
	}
	writer.Flush()
}
