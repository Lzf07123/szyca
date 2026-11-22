package httpapi

import (
	"encoding/csv"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"szyca/internal/lottery"
	"szyca/internal/store"
)

func (s *Server) handleLotteryCampaign(w http.ResponseWriter, r *http.Request) {
	user, err := s.optionalUser(r)
	if err != nil {
		writeErrCode(w, http.StatusUnauthorized, "token 无效", "unauthorized")
		return
	}
	var userID *int64
	if user != nil {
		userID = &user.ID
	}
	status, err := s.lottery.PublicCampaign(r.Context(), userID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, status)
}

func (s *Server) handleLotteryDraw(w http.ResponseWriter, r *http.Request, user *store.User) {
	var request struct {
		RequestID string `json:"request_id"`
	}
	if err := readJSON(r, &request); err != nil {
		writeErrCode(w, http.StatusBadRequest, "请求体格式错误", "invalid_request")
		return
	}
	draw, err := s.lottery.Draw(r.Context(), user.ID, request.RequestID)
	switch {
	case errors.Is(err, lottery.ErrCampaignNotActive):
		writeErrCode(w, http.StatusConflict, err.Error(), "campaign_not_active")
	case errors.Is(err, lottery.ErrNotEligible):
		writeErrCode(w, http.StatusForbidden, "完成答题资格后再参与抽奖", "not_eligible")
	case errors.Is(err, lottery.ErrAlreadyDrawn):
		writeErrCode(w, http.StatusConflict, err.Error(), "already_drawn")
	case errors.Is(err, lottery.ErrRequestConflict):
		writeErrCode(w, http.StatusConflict, err.Error(), "request_conflict")
	case errors.Is(err, lottery.ErrInvalidRequest):
		writeErrCode(w, http.StatusBadRequest, err.Error(), "invalid_request")
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusOK, draw)
	}
}

func (s *Server) handleLotteryMe(w http.ResponseWriter, r *http.Request, user *store.User) {
	status, err := s.lottery.PublicCampaign(r.Context(), &user.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, status)
}

func (s *Server) handleAdminLotteryCampaigns(w http.ResponseWriter, r *http.Request) {
	campaigns, err := s.lottery.AdminCampaigns(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"campaigns": campaigns})
}

func (s *Server) handleAdminSaveLotteryCampaign(w http.ResponseWriter, r *http.Request) {
	var input lottery.CampaignInput
	if err := readJSON(r, &input); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体格式错误")
		return
	}
	principal := principalFromRequest(r)
	campaign, err := s.lottery.SaveCampaign(r.Context(), principal.ID, input)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"campaign": campaign})
}

func (s *Server) handleAdminLotteryStatus(w http.ResponseWriter, r *http.Request) {
	campaignID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || campaignID <= 0 {
		writeErr(w, http.StatusBadRequest, "活动 ID 无效")
		return
	}
	var request struct {
		Status string `json:"status"`
	}
	if err := readJSON(r, &request); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体格式错误")
		return
	}
	if err := s.lottery.SetCampaignStatus(r.Context(), campaignID, request.Status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeErr(w, http.StatusNotFound, "抽奖活动不存在")
			return
		}
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"ok": "true", "status": request.Status})
}

func (s *Server) handleAdminSaveLotteryPrize(w http.ResponseWriter, r *http.Request) {
	campaignID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || campaignID <= 0 {
		writeErr(w, http.StatusBadRequest, "活动 ID 无效")
		return
	}
	var input lottery.PrizeInput
	if err := readJSON(r, &input); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体格式错误")
		return
	}
	prize, err := s.lottery.SavePrize(r.Context(), campaignID, input)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"prize": prize})
}

func (s *Server) handleAdminDeleteLotteryPrize(w http.ResponseWriter, r *http.Request) {
	campaignID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || campaignID <= 0 {
		writeErr(w, http.StatusBadRequest, "活动 ID 无效")
		return
	}
	prizeID, err := strconv.ParseInt(r.PathValue("prizeId"), 10, 64)
	if err != nil || prizeID <= 0 {
		writeErr(w, http.StatusBadRequest, "奖品 ID 无效")
		return
	}
	err = s.lottery.DeletePrize(r.Context(), campaignID, prizeID)
	if errors.Is(err, lottery.ErrPrizeInUse) {
		writeErrCode(w, http.StatusConflict, err.Error(), "prize_in_use")
		return
	}
	if errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, http.StatusNotFound, "奖品不存在")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"ok": "true"})
}

func (s *Server) handleAdminLotteryDraws(w http.ResponseWriter, r *http.Request) {
	campaignID, _ := strconv.ParseInt(r.URL.Query().Get("campaign_id"), 10, 64)
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	draws, err := s.lottery.AdminDraws(r.Context(), campaignID, limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"draws": draws})
}

func (s *Server) handleAdminLotteryClaim(w http.ResponseWriter, r *http.Request) {
	drawID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || drawID <= 0 {
		writeErr(w, http.StatusBadRequest, "抽奖记录 ID 无效")
		return
	}
	principal := principalFromRequest(r)
	draw, err := s.lottery.Claim(r.Context(), drawID, principal.ID)
	if err != nil {
		writeErr(w, http.StatusConflict, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"draw": draw})
}

func (s *Server) handleAdminLotteryExport(w http.ResponseWriter, r *http.Request) {
	campaignID, _ := strconv.ParseInt(r.URL.Query().Get("campaign_id"), 10, 64)
	draws, err := s.lottery.AdminDraws(r.Context(), campaignID, 1000)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
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
			csvSafe(draw.Campaign),
			strconv.FormatInt(draw.ID, 10),
			strconv.FormatInt(draw.UserID, 10),
			csvSafe(draw.Nickname),
			draw.Status,
			csvSafe(draw.Prize),
			claimStatus,
			csvSafe(draw.RequestID),
			draw.CreatedAt.Format(time.RFC3339),
			claimedAt,
		})
	}
	writer.Flush()
}

func (s *Server) optionalUser(r *http.Request) (*store.User, error) {
	token := r.URL.Query().Get("token")
	if token == "" {
		if header := r.Header.Get("Authorization"); strings.HasPrefix(header, "Bearer ") {
			token = strings.TrimPrefix(header, "Bearer ")
		}
	}
	if token == "" {
		return nil, nil
	}
	return s.svc.ValidateToken(r.Context(), token)
}
