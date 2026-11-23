package lottery

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"math/big"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrCampaignNotActive = errors.New("活动未开始、已暂停或已结束")
	ErrNotEligible       = errors.New("尚未满足抽奖资格")
	ErrAlreadyDrawn      = errors.New("该活动每人仅可抽取一次")
	ErrRequestConflict   = errors.New("request_id 已用于其他抽奖")
	ErrInvalidRequest    = errors.New("抽奖请求无效")
	ErrPrizeInUse        = errors.New("奖品已有抽奖记录，不能删除")
)

type EligibilityReader interface {
	LotteryEligible(
		ctx context.Context,
		userID int64,
		kind string,
		minScore, minimumQuestions int,
	) (bool, error)
}

type Service struct {
	pool          *pgxpool.Pool
	eligibility   EligibilityReader
	questionCount int
	random        io.Reader
}

type Campaign struct {
	ID                  int64      `json:"id"`
	Name                string     `json:"name"`
	Status              string     `json:"status"`
	StartsAt            *time.Time `json:"starts_at,omitempty"`
	EndsAt              *time.Time `json:"ends_at,omitempty"`
	Eligibility         string     `json:"eligibility"`
	EligibilityMinScore int        `json:"eligibility_min_score"`
	MaxDrawsPerUser     int        `json:"max_draws_per_user"`
	NoWinWeight         int        `json:"no_win_weight"`
	Enabled             bool       `json:"enabled"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
}

type PublicPrize struct {
	Name      string `json:"name"`
	Remaining int    `json:"remaining"`
}

type PublicCampaign struct {
	ID                  int64         `json:"id"`
	Name                string        `json:"name"`
	Status              string        `json:"status"`
	State               string        `json:"state"`
	StartsAt            *time.Time    `json:"starts_at,omitempty"`
	EndsAt              *time.Time    `json:"ends_at,omitempty"`
	Eligibility         string        `json:"eligibility"`
	EligibilityMinScore int           `json:"eligibility_min_score"`
	Prizes              []PublicPrize `json:"prizes"`
}

type Draw struct {
	ID         int64      `json:"id"`
	CampaignID int64      `json:"campaign_id"`
	UserID     int64      `json:"-"`
	PrizeID    *int64     `json:"-"`
	Result     string     `json:"result"`
	PrizeName  string     `json:"-"`
	Claimed    bool       `json:"claimed"`
	RequestID  string     `json:"-"`
	CreatedAt  time.Time  `json:"created_at"`
	ClaimedAt  *time.Time `json:"claimed_at,omitempty"`
	Duplicate  bool       `json:"duplicate,omitempty"`
}

type DrawResponse struct {
	ID         int64      `json:"draw_id"`
	CampaignID int64      `json:"campaign_id"`
	Result     string     `json:"result"`
	Prize      *PrizeView `json:"prize,omitempty"`
	Claimed    bool       `json:"claimed"`
	ClaimedAt  *time.Time `json:"claimed_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	Duplicate  bool       `json:"duplicate,omitempty"`
}

type PrizeView struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

type UserStatus struct {
	Campaign *PublicCampaign `json:"campaign"`
	Draw     *DrawResponse   `json:"draw,omitempty"`
	Eligible bool            `json:"eligible"`
}

type Prize struct {
	ID         int64     `json:"id"`
	CampaignID int64     `json:"campaign_id"`
	Name       string    `json:"name"`
	Total      int       `json:"total"`
	Remaining  int       `json:"remaining"`
	Won        int       `json:"won"`
	Claimed    int       `json:"claimed"`
	Weight     int       `json:"weight"`
	Enabled    bool      `json:"enabled"`
	Sort       int       `json:"sort"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type AdminCampaign struct {
	Campaign
	Prizes []Prize `json:"prizes"`
}

type CampaignInput struct {
	ID                  int64      `json:"id"`
	Name                string     `json:"name"`
	Status              string     `json:"status"`
	StartsAt            *time.Time `json:"starts_at"`
	EndsAt              *time.Time `json:"ends_at"`
	Eligibility         string     `json:"eligibility"`
	EligibilityMinScore int        `json:"eligibility_min_score"`
	NoWinWeight         int        `json:"no_win_weight"`
	Enabled             bool       `json:"enabled"`
}

type PrizeInput struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	Total     int    `json:"total"`
	Remaining int    `json:"remaining"`
	Weight    int    `json:"weight"`
	Enabled   bool   `json:"enabled"`
	Sort      int    `json:"sort"`
}

type AdminDraw struct {
	ID         int64      `json:"id"`
	CampaignID int64      `json:"campaign_id"`
	Campaign   string     `json:"campaign"`
	UserID     int64      `json:"user_id"`
	Nickname   string     `json:"nickname"`
	PrizeID    *int64     `json:"prize_id,omitempty"`
	Prize      string     `json:"prize"`
	Status     string     `json:"status"`
	RequestID  string     `json:"request_id"`
	CreatedAt  time.Time  `json:"created_at"`
	ClaimedAt  *time.Time `json:"claimed_at,omitempty"`
}

func New(
	pool *pgxpool.Pool,
	eligibility EligibilityReader,
	questionCount int,
) *Service {
	if questionCount <= 0 {
		questionCount = 1
	}
	return &Service{
		pool:          pool,
		eligibility:   eligibility,
		questionCount: questionCount,
		random:        rand.Reader,
	}
}

func (s *Service) PublicCampaign(ctx context.Context, userID *int64) (*UserStatus, error) {
	campaign, err := s.publicCampaign(ctx)
	if err != nil {
		return nil, err
	}
	status := &UserStatus{Campaign: campaign}
	if campaign == nil || userID == nil {
		return status, nil
	}
	draw, err := s.userDraw(ctx, campaign.ID, *userID)
	if err != nil {
		return nil, err
	}
	status.Draw = draw
	if status.Draw == nil && campaign.State == "active" {
		eligible, err := s.eligibility.LotteryEligible(
			ctx,
			*userID,
			campaign.Eligibility,
			campaign.EligibilityMinScore,
			s.questionCount,
		)
		if err != nil {
			return nil, err
		}
		status.Eligible = eligible
	}
	return status, nil
}

// SectionAvailability keeps homepage lottery entries aligned with the two
// public sub-modes while leaving the module-wide feature flag in core Site.
func (s *Service) SectionAvailability(
	ctx context.Context,
	kinds []string,
) (map[string]bool, error) {
	requested := make(map[string]struct{}, len(kinds))
	for _, kind := range kinds {
		switch kind {
		case numberScreenSection, numberParticipateSection:
			requested[kind] = struct{}{}
		}
	}
	if len(requested) == 0 {
		return map[string]bool{}, nil
	}
	modes, err := readNumberModes(ctx, s.pool)
	if err != nil {
		return nil, err
	}
	availability := make(map[string]bool, len(requested))
	if _, ok := requested[numberScreenSection]; ok {
		availability[numberScreenSection] = modes.ScreenEnabled
	}
	if _, ok := requested[numberParticipateSection]; ok {
		availability[numberParticipateSection] = modes.PersonalEnabled
	}
	return availability, nil
}

func (s *Service) Draw(
	ctx context.Context,
	userID int64,
	requestID string,
) (*DrawResponse, error) {
	requestID = strings.TrimSpace(requestID)
	if userID <= 0 || len(requestID) < 8 || len(requestID) > 128 {
		return nil, ErrInvalidRequest
	}

	// Replays are answered before checking the current lifecycle so a retry
	// still receives the original result after the campaign closes.
	if existing, err := drawByRequest(ctx, s.pool, requestID); err == nil {
		if existing.UserID != userID {
			return nil, ErrRequestConflict
		}
		existing.Duplicate = true
		return drawResponse(existing), nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	campaign, err := s.activeCampaign(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrCampaignNotActive
	}
	if err != nil {
		return nil, err
	}
	eligible, err := s.eligibility.LotteryEligible(
		ctx,
		userID,
		campaign.Eligibility,
		campaign.EligibilityMinScore,
		s.questionCount,
	)
	if err != nil {
		return nil, err
	}
	if !eligible {
		return nil, ErrNotEligible
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	lockedCampaign, err := lockActiveCampaign(ctx, tx, campaign.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrCampaignNotActive
	}
	if err != nil {
		return nil, err
	}
	if lockedCampaign.Eligibility != campaign.Eligibility ||
		lockedCampaign.EligibilityMinScore != campaign.EligibilityMinScore {
		return nil, ErrCampaignNotActive
	}
	campaign = lockedCampaign

	existingRequest, err := drawByRequest(ctx, tx, requestID)
	if err == nil {
		if existingRequest.UserID != userID || existingRequest.CampaignID != campaign.ID {
			return nil, ErrRequestConflict
		}
		existingRequest.Duplicate = true
		return drawResponse(existingRequest), tx.Rollback(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	_, err = drawByUser(ctx, tx, campaign.ID, userID)
	if err == nil {
		_ = tx.Rollback(ctx)
		return nil, ErrAlreadyDrawn
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	prizes, err := s.drawPrizes(ctx, tx, campaign.ID)
	if err != nil {
		return nil, err
	}
	selected, err := s.selectPrize(prizes, campaign.NoWinWeight)
	if err != nil {
		return nil, err
	}

	var prizeID *int64
	result := "no_win"
	if selected != nil {
		var updatedID int64
		err = tx.QueryRow(ctx, `
			UPDATE lottery_prizes
			SET remaining = remaining - 1, updated_at = now()
			WHERE id = $1 AND remaining > 0
			RETURNING id`,
			selected.ID,
		).Scan(&updatedID)
		if errors.Is(err, pgx.ErrNoRows) {
			// Another draw consumed the last unit after our stock snapshot.
			// This request deterministically becomes a no-win without a
			// partial row or negative inventory.
			selected = nil
		} else if err != nil {
			return nil, err
		} else {
			prizeID = &selected.ID
			result = "won"
		}
	}

	var draw Draw
	err = tx.QueryRow(ctx, `
		INSERT INTO lottery_draws
			(campaign_id, user_id, prize_id, status, request_id)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, created_at`,
		campaign.ID, userID, prizeID, result, requestID,
	).Scan(&draw.ID, &draw.CreatedAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			if strings.Contains(pgErr.ConstraintName, "request_id") {
				_ = tx.Rollback(ctx)
				if existing, lookupErr := drawByRequest(ctx, s.pool, requestID); lookupErr == nil &&
					existing.UserID == userID {
					existing.Duplicate = true
					return drawResponse(existing), nil
				}
				return nil, ErrRequestConflict
			}
			return nil, ErrAlreadyDrawn
		}
		return nil, err
	}
	draw.CampaignID = campaign.ID
	draw.UserID = userID
	draw.PrizeID = prizeID
	draw.Result = result
	if selected != nil {
		draw.PrizeName = selected.Name
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return drawResponse(&draw), nil
}

func (s *Service) AdminCampaigns(ctx context.Context) ([]AdminCampaign, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, name, status, starts_at, ends_at, eligibility,
		       eligibility_min_score, max_draws_per_user, no_win_weight,
		       enabled, created_at, updated_at
		FROM lottery_campaigns
		ORDER BY id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AdminCampaign{}
	for rows.Next() {
		campaign, err := scanCampaign(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, AdminCampaign{Campaign: campaign})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for index := range out {
		prizes, err := s.adminPrizes(ctx, out[index].ID)
		if err != nil {
			return nil, err
		}
		out[index].Prizes = prizes
	}
	return out, nil
}

func (s *Service) SaveCampaign(
	ctx context.Context,
	actorID int64,
	input CampaignInput,
) (*Campaign, error) {
	if err := validateCampaign(input); err != nil {
		return nil, err
	}
	if input.ID == 0 {
		row := s.pool.QueryRow(ctx, `
			INSERT INTO lottery_campaigns
				(name, status, starts_at, ends_at, eligibility,
				 eligibility_min_score, no_win_weight, enabled, created_by)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULLIF($9,0))
			RETURNING id, name, status, starts_at, ends_at, eligibility,
			          eligibility_min_score, max_draws_per_user, no_win_weight,
			          enabled, created_at, updated_at`,
			input.Name, input.Status, input.StartsAt, input.EndsAt, input.Eligibility,
			input.EligibilityMinScore, input.NoWinWeight, input.Enabled, actorID,
		)
		campaign, err := scanCampaign(row)
		if err != nil {
			return nil, err
		}
		return &campaign, nil
	}
	row := s.pool.QueryRow(ctx, `
		UPDATE lottery_campaigns
		SET name = $2, status = $3, starts_at = $4, ends_at = $5,
		    eligibility = $6, eligibility_min_score = $7,
		    no_win_weight = $8, enabled = $9, updated_at = now()
		WHERE id = $1
		RETURNING id, name, status, starts_at, ends_at, eligibility,
		          eligibility_min_score, max_draws_per_user, no_win_weight,
		          enabled, created_at, updated_at`,
		input.ID, input.Name, input.Status, input.StartsAt, input.EndsAt,
		input.Eligibility, input.EligibilityMinScore, input.NoWinWeight, input.Enabled,
	)
	campaign, err := scanCampaign(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errors.New("抽奖活动不存在")
	}
	if err != nil {
		return nil, err
	}
	return &campaign, nil
}

func (s *Service) SetCampaignStatus(ctx context.Context, campaignID int64, status string) error {
	if !validStatus(status) {
		return errors.New("活动状态无效")
	}
	tag, err := s.pool.Exec(ctx, `
		UPDATE lottery_campaigns
		SET status = $2, updated_at = now()
		WHERE id = $1`,
		campaignID, status,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (s *Service) SavePrize(
	ctx context.Context,
	campaignID int64,
	input PrizeInput,
) (*Prize, error) {
	if campaignID <= 0 || strings.TrimSpace(input.Name) == "" ||
		len([]rune(input.Name)) > 80 || input.Total < 0 ||
		input.Remaining < 0 || input.Remaining > input.Total ||
		input.Weight <= 0 {
		return nil, errors.New("奖品配置无效")
	}
	var exists bool
	if err := s.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM lottery_campaigns WHERE id = $1)`,
		campaignID,
	).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, errors.New("抽奖活动不存在")
	}

	if input.ID == 0 {
		row := s.pool.QueryRow(ctx, `
			INSERT INTO lottery_prizes
				(campaign_id, name, total, remaining, weight, enabled, sort)
			VALUES ($1,$2,$3,$4,$5,$6,$7)
			RETURNING id, campaign_id, name, total, remaining, weight,
			          enabled, sort, created_at, updated_at`,
			campaignID, strings.TrimSpace(input.Name), input.Total, input.Remaining,
			input.Weight, input.Enabled, input.Sort,
		)
		prize, err := scanPrize(row)
		if err != nil {
			return nil, err
		}
		return &prize, nil
	}

	var won int
	if err := s.pool.QueryRow(ctx, `
		SELECT count(*) FROM lottery_draws
		WHERE prize_id = $1 AND status IN ('won','claimed')`,
		input.ID,
	).Scan(&won); err != nil {
		return nil, err
	}
	if input.Total < won+input.Remaining {
		return nil, fmt.Errorf("总库存不能小于已抽取 %d 件加剩余 %d 件", won, input.Remaining)
	}
	row := s.pool.QueryRow(ctx, `
		UPDATE lottery_prizes
		SET name = $3, total = $4, remaining = $5, weight = $6,
		    enabled = $7, sort = $8, updated_at = now()
		WHERE id = $1 AND campaign_id = $2
		RETURNING id, campaign_id, name, total, remaining, weight,
		          enabled, sort, created_at, updated_at`,
		input.ID, campaignID, strings.TrimSpace(input.Name), input.Total,
		input.Remaining, input.Weight, input.Enabled, input.Sort,
	)
	prize, err := scanPrize(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errors.New("奖品不存在")
	}
	if err != nil {
		return nil, err
	}
	prize.Won = won
	return &prize, nil
}

func (s *Service) DeletePrize(ctx context.Context, campaignID, prizeID int64) error {
	var used bool
	if err := s.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM lottery_draws WHERE prize_id = $1)`,
		prizeID,
	).Scan(&used); err != nil {
		return err
	}
	if used {
		return ErrPrizeInUse
	}
	tag, err := s.pool.Exec(ctx, `
		DELETE FROM lottery_prizes
		WHERE id = $1 AND campaign_id = $2`,
		prizeID, campaignID,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (s *Service) AdminDraws(ctx context.Context, campaignID int64, limit int) ([]AdminDraw, error) {
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	query := `
		SELECT d.id, d.campaign_id, c.name, d.user_id, u.nickname,
		       d.prize_id, COALESCE(p.name, ''), d.status, d.request_id,
		       d.created_at, d.claimed_at
		FROM lottery_draws d
		JOIN lottery_campaigns c ON c.id = d.campaign_id
		JOIN users u ON u.id = d.user_id
		LEFT JOIN lottery_prizes p ON p.id = d.prize_id
		WHERE ($1 = 0 OR d.campaign_id = $1)
		ORDER BY d.created_at DESC, d.id DESC
		LIMIT $2`
	rows, err := s.pool.Query(ctx, query, campaignID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AdminDraw{}
	for rows.Next() {
		var draw AdminDraw
		if err := rows.Scan(
			&draw.ID, &draw.CampaignID, &draw.Campaign, &draw.UserID,
			&draw.Nickname, &draw.PrizeID, &draw.Prize, &draw.Status,
			&draw.RequestID, &draw.CreatedAt, &draw.ClaimedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, draw)
	}
	return out, rows.Err()
}

func (s *Service) Claim(ctx context.Context, drawID, actorID int64) (*AdminDraw, error) {
	if drawID <= 0 || actorID <= 0 {
		return nil, errors.New("领取参数无效")
	}
	var draw AdminDraw
	err := s.pool.QueryRow(ctx, `
		WITH claimed AS (
			UPDATE lottery_draws
			SET status = 'claimed', claimed_at = now(), claimed_by = $2
			WHERE id = $1 AND status = 'won'
			RETURNING *
		)
		SELECT d.id, d.campaign_id, c.name, d.user_id, u.nickname,
		       d.prize_id, COALESCE(p.name, ''), d.status, d.request_id,
		       d.created_at, d.claimed_at
		FROM claimed d
		JOIN lottery_campaigns c ON c.id = d.campaign_id
		JOIN users u ON u.id = d.user_id
		LEFT JOIN lottery_prizes p ON p.id = d.prize_id`,
		drawID, actorID,
	).Scan(
		&draw.ID, &draw.CampaignID, &draw.Campaign, &draw.UserID,
		&draw.Nickname, &draw.PrizeID, &draw.Prize, &draw.Status,
		&draw.RequestID, &draw.CreatedAt, &draw.ClaimedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errors.New("记录不是待领取状态")
	}
	if err != nil {
		return nil, err
	}
	return &draw, nil
}

func (s *Service) publicCampaign(ctx context.Context) (*PublicCampaign, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT id, name, status, starts_at, ends_at, eligibility,
		       eligibility_min_score, max_draws_per_user, no_win_weight,
		       enabled, created_at, updated_at
		FROM lottery_campaigns
		WHERE enabled AND status <> 'draft'
		ORDER BY
			CASE status
				WHEN 'active' THEN 0
				WHEN 'paused' THEN 1
				ELSE 2
			END,
			id DESC
		LIMIT 1`)
	campaign, err := scanCampaign(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `
		SELECT name, remaining
		FROM lottery_prizes
		WHERE campaign_id = $1 AND enabled
		ORDER BY sort, id`,
		campaign.ID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	prizes := []PublicPrize{}
	for rows.Next() {
		var prize PublicPrize
		if err := rows.Scan(&prize.Name, &prize.Remaining); err != nil {
			return nil, err
		}
		prizes = append(prizes, prize)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return &PublicCampaign{
		ID:                  campaign.ID,
		Name:                campaign.Name,
		Status:              campaign.Status,
		State:               campaignState(campaign, time.Now()),
		StartsAt:            campaign.StartsAt,
		EndsAt:              campaign.EndsAt,
		Eligibility:         campaign.Eligibility,
		EligibilityMinScore: campaign.EligibilityMinScore,
		Prizes:              prizes,
	}, nil
}

func (s *Service) userDraw(ctx context.Context, campaignID, userID int64) (*DrawResponse, error) {
	draw, err := drawByUser(ctx, s.pool, campaignID, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return drawResponse(draw), nil
}

func (s *Service) selectPrize(prizes []Prize, noWinWeight int) (*Prize, error) {
	total := int64(max(noWinWeight, 0))
	for _, prize := range prizes {
		if prize.Remaining > 0 && prize.Enabled {
			total += int64(prize.Weight)
		}
	}
	if total <= 0 {
		return nil, nil
	}
	index, err := secureIndex(s.random, total)
	if err != nil {
		return nil, err
	}
	if index < int64(max(noWinWeight, 0)) {
		return nil, nil
	}
	index -= int64(max(noWinWeight, 0))
	for i := range prizes {
		prize := &prizes[i]
		if !prize.Enabled || prize.Remaining <= 0 {
			continue
		}
		if index < int64(prize.Weight) {
			return prize, nil
		}
		index -= int64(prize.Weight)
	}
	return nil, nil
}

func secureIndex(reader io.Reader, total int64) (int64, error) {
	if total <= 0 {
		return 0, errors.New("随机范围必须大于 0")
	}
	value, err := rand.Int(reader, big.NewInt(total))
	if err != nil {
		return 0, err
	}
	return value.Int64(), nil
}

func (s *Service) activeCampaign(ctx context.Context) (*Campaign, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT id, name, status, starts_at, ends_at, eligibility,
		       eligibility_min_score, max_draws_per_user, no_win_weight,
		       enabled, created_at, updated_at
		FROM lottery_campaigns
		WHERE enabled
		  AND status = 'active'
		  AND (starts_at IS NULL OR starts_at <= now())
		  AND (ends_at IS NULL OR ends_at > now())
		ORDER BY id DESC
		LIMIT 1`)
	campaign, err := scanCampaign(row)
	if err != nil {
		return nil, err
	}
	return &campaign, nil
}

func lockActiveCampaign(ctx context.Context, tx pgx.Tx, campaignID int64) (*Campaign, error) {
	row := tx.QueryRow(ctx, `
		SELECT id, name, status, starts_at, ends_at, eligibility,
		       eligibility_min_score, max_draws_per_user, no_win_weight,
		       enabled, created_at, updated_at
		FROM lottery_campaigns
		WHERE id = $1
		  AND enabled
		  AND status = 'active'
		  AND (starts_at IS NULL OR starts_at <= now())
		  AND (ends_at IS NULL OR ends_at > now())
		FOR SHARE`,
		campaignID,
	)
	campaign, err := scanCampaign(row)
	if err != nil {
		return nil, err
	}
	return &campaign, nil
}

func (s *Service) drawPrizes(ctx context.Context, tx pgx.Tx, campaignID int64) ([]Prize, error) {
	rows, err := tx.Query(ctx, `
		SELECT id, campaign_id, name, total, remaining, weight,
		       enabled, sort, created_at, updated_at
		FROM lottery_prizes
		WHERE campaign_id = $1
		  AND enabled
		  AND remaining > 0
		ORDER BY sort, id`,
		campaignID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	prizes := []Prize{}
	for rows.Next() {
		prize, err := scanPrize(rows)
		if err != nil {
			return nil, err
		}
		prizes = append(prizes, prize)
	}
	return prizes, rows.Err()
}

type rowQueryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func drawByRequest(ctx context.Context, queryer rowQueryer, requestID string) (*Draw, error) {
	row := queryer.QueryRow(ctx, `
		SELECT d.id, d.campaign_id, d.user_id, d.prize_id,
		       COALESCE(p.name, ''), d.status, d.request_id,
		       d.created_at, d.claimed_at
		FROM lottery_draws d
		LEFT JOIN lottery_prizes p ON p.id = d.prize_id
		WHERE d.request_id = $1`,
		requestID,
	)
	return scanDraw(row)
}

func drawByUser(ctx context.Context, queryer rowQueryer, campaignID, userID int64) (*Draw, error) {
	row := queryer.QueryRow(ctx, `
		SELECT d.id, d.campaign_id, d.user_id, d.prize_id,
		       COALESCE(p.name, ''), d.status, d.request_id,
		       d.created_at, d.claimed_at
		FROM lottery_draws d
		LEFT JOIN lottery_prizes p ON p.id = d.prize_id
		WHERE d.campaign_id = $1 AND d.user_id = $2`,
		campaignID, userID,
	)
	return scanDraw(row)
}

type scanner interface {
	Scan(...any) error
}

func scanCampaign(row scanner) (Campaign, error) {
	var campaign Campaign
	err := row.Scan(
		&campaign.ID, &campaign.Name, &campaign.Status,
		&campaign.StartsAt, &campaign.EndsAt, &campaign.Eligibility,
		&campaign.EligibilityMinScore, &campaign.MaxDrawsPerUser,
		&campaign.NoWinWeight, &campaign.Enabled,
		&campaign.CreatedAt, &campaign.UpdatedAt,
	)
	return campaign, err
}

func scanPrize(row scanner) (Prize, error) {
	var prize Prize
	err := row.Scan(
		&prize.ID, &prize.CampaignID, &prize.Name, &prize.Total,
		&prize.Remaining, &prize.Weight, &prize.Enabled, &prize.Sort,
		&prize.CreatedAt, &prize.UpdatedAt,
	)
	return prize, err
}

func scanDraw(row scanner) (*Draw, error) {
	var draw Draw
	var status string
	err := row.Scan(
		&draw.ID, &draw.CampaignID, &draw.UserID, &draw.PrizeID,
		&draw.PrizeName, &status, &draw.RequestID,
		&draw.CreatedAt, &draw.ClaimedAt,
	)
	if err != nil {
		return nil, err
	}
	draw.Claimed = status == "claimed"
	if draw.PrizeID == nil {
		draw.Result = "no_win"
	} else {
		draw.Result = "won"
	}
	return &draw, nil
}

func drawResponse(draw *Draw) *DrawResponse {
	response := &DrawResponse{
		ID:         draw.ID,
		CampaignID: draw.CampaignID,
		Result:     draw.Result,
		Claimed:    draw.Claimed,
		ClaimedAt:  draw.ClaimedAt,
		CreatedAt:  draw.CreatedAt,
		Duplicate:  draw.Duplicate,
	}
	if draw.PrizeID != nil {
		response.Prize = &PrizeView{ID: *draw.PrizeID, Name: draw.PrizeName}
	}
	return response
}

func (s *Service) adminPrizes(ctx context.Context, campaignID int64) ([]Prize, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT p.id, p.campaign_id, p.name, p.total, p.remaining, p.weight,
		       p.enabled, p.sort, p.created_at, p.updated_at,
		       count(d.id) FILTER (WHERE d.status IN ('won','claimed')),
		       count(d.id) FILTER (WHERE d.status = 'claimed')
		FROM lottery_prizes p
		LEFT JOIN lottery_draws d ON d.prize_id = p.id
		WHERE p.campaign_id = $1
		GROUP BY p.id
		ORDER BY p.sort, p.id`,
		campaignID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Prize{}
	for rows.Next() {
		prize, err := scanAdminPrize(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, prize)
	}
	return out, rows.Err()
}

func scanAdminPrize(row scanner) (Prize, error) {
	var prize Prize
	err := row.Scan(
		&prize.ID, &prize.CampaignID, &prize.Name, &prize.Total,
		&prize.Remaining, &prize.Weight, &prize.Enabled, &prize.Sort,
		&prize.CreatedAt, &prize.UpdatedAt, &prize.Won, &prize.Claimed,
	)
	return prize, err
}

func validateCampaign(input CampaignInput) error {
	if strings.TrimSpace(input.Name) == "" || len([]rune(input.Name)) > 80 {
		return errors.New("活动名称需为 1-80 个字符")
	}
	if !validStatus(input.Status) {
		return errors.New("活动状态无效")
	}
	if input.Eligibility != "completed_round" && input.Eligibility != "min_score" {
		return errors.New("资格条件无效")
	}
	if input.EligibilityMinScore < 0 || input.NoWinWeight < 0 {
		return errors.New("资格分数和未中奖权重不能为负数")
	}
	if input.StartsAt != nil && input.EndsAt != nil && !input.EndsAt.After(*input.StartsAt) {
		return errors.New("结束时间必须晚于开始时间")
	}
	return nil
}

func validStatus(status string) bool {
	return status == "draft" || status == "active" || status == "paused" || status == "ended"
}

func campaignState(campaign Campaign, now time.Time) string {
	if campaign.Status == "paused" {
		return "paused"
	}
	if campaign.Status == "ended" || (campaign.EndsAt != nil && !campaign.EndsAt.After(now)) {
		return "ended"
	}
	if campaign.StartsAt != nil && campaign.StartsAt.After(now) {
		return "upcoming"
	}
	if campaign.Status == "active" {
		return "active"
	}
	return "upcoming"
}
