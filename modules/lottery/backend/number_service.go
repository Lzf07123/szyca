package lottery

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math/big"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type EventPublisher interface {
	Publish(context.Context, string) error
}

type NumberService struct {
	pool      *pgxpool.Pool
	publisher EventPublisher
	random    io.Reader
}

type numberEventRecord struct {
	ID          int64
	Name        string
	Status      string
	RangeStart  int64
	RangeEnd    int64
	NumberWidth int
	Revision    int64
	PublishedAt *time.Time
	ArchivedAt  *time.Time
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type numberDrawRecord struct {
	ID        int64
	EventID   int64
	LevelID   int64
	LevelName string
	CreatedAt time.Time
}

type numberRowsQueryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

type numberRowQueryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func NewNumberService(pool *pgxpool.Pool, publisher EventPublisher) *NumberService {
	return &NumberService{
		pool:      pool,
		publisher: publisher,
		random:    rand.Reader,
	}
}

func (s *NumberService) Modes(ctx context.Context) (*NumberModeSettings, error) {
	var settings NumberModeSettings
	err := s.pool.QueryRow(ctx, `
		SELECT screen_enabled, personal_enabled, updated_at
		FROM lottery_mode_settings
		WHERE id = 1`,
	).Scan(&settings.ScreenEnabled, &settings.PersonalEnabled, &settings.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &settings, nil
}

func (s *NumberService) PersonalEnabled(ctx context.Context) (bool, error) {
	var enabled bool
	err := s.pool.QueryRow(ctx,
		`SELECT personal_enabled FROM lottery_mode_settings WHERE id = 1`,
	).Scan(&enabled)
	return enabled, err
}

func (s *NumberService) SaveModes(
	ctx context.Context,
	actorID int64,
	settings NumberModeSettings,
) (*NumberModeSettings, error) {
	var saved NumberModeSettings
	err := s.pool.QueryRow(ctx, `
		UPDATE lottery_mode_settings
		SET screen_enabled = $1,
		    personal_enabled = $2,
		    updated_by = NULLIF($3, 0),
		    updated_at = now()
		WHERE id = 1
		RETURNING screen_enabled, personal_enabled, updated_at`,
		settings.ScreenEnabled, settings.PersonalEnabled, actorID,
	).Scan(&saved.ScreenEnabled, &saved.PersonalEnabled, &saved.UpdatedAt)
	if err != nil {
		return nil, err
	}
	s.publishBoard(ctx)
	return &saved, nil
}

func (s *NumberService) Board(ctx context.Context) (*NumberBoard, error) {
	modes, err := s.Modes(ctx)
	if err != nil {
		return nil, err
	}
	board := &NumberBoard{
		Enabled: modes.ScreenEnabled,
		Levels:  []NumberLevelView{},
	}
	if !modes.ScreenEnabled {
		return board, nil
	}

	event, err := s.liveEvent(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return board, nil
	}
	if err != nil {
		return nil, err
	}
	levels, err := s.loadLevels(ctx, s.pool, event.ID, event.NumberWidth, false)
	if err != nil {
		return nil, err
	}
	view := numberEventView(event, levels)
	board.Event = &view
	board.Levels = levels
	return board, nil
}

func (s *NumberService) AdminEvents(ctx context.Context) ([]NumberEventSummary, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT e.id, e.name, e.status, e.range_start, e.range_end,
		       e.number_width, e.revision, e.published_at, e.archived_at,
		       e.created_at, e.updated_at,
		       (SELECT count(*)::int
		        FROM lottery_number_levels l
		        WHERE l.event_id = e.id),
		       (SELECT COALESCE(sum(l.winner_count), 0)::int
		        FROM lottery_number_levels l
		        WHERE l.event_id = e.id),
		       (SELECT count(*)::int
		        FROM lottery_number_draws d
		        WHERE d.event_id = e.id),
		       (SELECT count(*)::int
		        FROM lottery_number_winners w
		        WHERE w.event_id = e.id)
		FROM lottery_number_events e
		ORDER BY CASE e.status WHEN 'live' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
		         e.updated_at DESC, e.id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []NumberEventSummary{}
	for rows.Next() {
		var event numberEventRecord
		var summary NumberEventSummary
		if err := rows.Scan(
			&event.ID, &event.Name, &event.Status, &event.RangeStart,
			&event.RangeEnd, &event.NumberWidth, &event.Revision,
			&event.PublishedAt, &event.ArchivedAt, &event.CreatedAt,
			&event.UpdatedAt, &summary.LevelCount, &summary.PlannedWinners,
			&summary.DrawnLevels, &summary.DrawnWinners,
		); err != nil {
			return nil, err
		}
		summary.NumberEventView = numberEventView(event, nil)
		summary.Completed = summary.LevelCount > 0 &&
			summary.DrawnLevels == summary.LevelCount
		out = append(out, summary)
	}
	return out, rows.Err()
}

func (s *NumberService) AdminEvent(
	ctx context.Context,
	eventID int64,
) (*NumberEventDetail, error) {
	event, err := s.eventByID(ctx, s.pool, eventID, false)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNumberEventNotFound
	}
	if err != nil {
		return nil, err
	}
	levels, err := s.loadLevels(ctx, s.pool, event.ID, event.NumberWidth, true)
	if err != nil {
		return nil, err
	}
	return &NumberEventDetail{
		Event:  numberEventView(event, levels),
		Levels: levels,
	}, nil
}

func (s *NumberService) SaveDraft(
	ctx context.Context,
	actorID int64,
	input NumberEventInput,
) (*NumberEventDetail, error) {
	normalized, err := normalizeNumberEvent(input)
	if err != nil {
		return nil, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var eventID int64
	if input.ID == 0 {
		err = tx.QueryRow(ctx, `
			INSERT INTO lottery_number_events
				(name, range_start, range_end, number_width, created_by)
			VALUES ($1, $2, $3, $4, NULLIF($5, 0))
			RETURNING id`,
			normalized.name, normalized.rangeStart, normalized.rangeEnd,
			normalized.numberWidth, actorID,
		).Scan(&eventID)
		if err != nil {
			return nil, err
		}
	} else {
		var status string
		err = tx.QueryRow(ctx, `
			SELECT status
			FROM lottery_number_events
			WHERE id = $1
			FOR UPDATE`,
			input.ID,
		).Scan(&status)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNumberEventNotFound
		}
		if err != nil {
			return nil, err
		}
		if status != "draft" {
			return nil, ErrNumberEventNotDraft
		}
		eventID = input.ID
		_, err = tx.Exec(ctx, `
			UPDATE lottery_number_events
			SET name = $2,
			    range_start = $3,
			    range_end = $4,
			    number_width = $5,
			    revision = revision + 1,
			    updated_at = now()
			WHERE id = $1`,
			eventID, normalized.name, normalized.rangeStart,
			normalized.rangeEnd, normalized.numberWidth,
		)
		if err != nil {
			return nil, err
		}
		if _, err := tx.Exec(ctx,
			`DELETE FROM lottery_number_levels WHERE event_id = $1`,
			eventID,
		); err != nil {
			return nil, err
		}
	}

	for index, level := range normalized.levels {
		if _, err := tx.Exec(ctx, `
			INSERT INTO lottery_number_levels
				(event_id, name, winner_count, sort)
			VALUES ($1, $2, $3, $4)`,
			eventID, level.Name, level.WinnerCount, (index+1)*10,
		); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.AdminEvent(ctx, eventID)
}

func (s *NumberService) DeleteDraft(ctx context.Context, eventID int64) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var status string
	err = tx.QueryRow(ctx, `
		SELECT status
		FROM lottery_number_events
		WHERE id = $1
		FOR UPDATE`,
		eventID,
	).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNumberEventNotFound
	}
	if err != nil {
		return err
	}
	if status != "draft" {
		return ErrNumberEventNotDraft
	}
	if _, err := tx.Exec(ctx,
		`DELETE FROM lottery_number_events WHERE id = $1`,
		eventID,
	); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *NumberService) Publish(
	ctx context.Context,
	eventID, actorID int64,
) (*NumberEventDetail, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	event, err := s.eventByID(ctx, tx, eventID, true)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNumberEventNotFound
	}
	if err != nil {
		return nil, err
	}
	if event.Status != "draft" {
		return nil, ErrNumberEventNotDraft
	}
	levels, err := s.loadLevels(ctx, tx, eventID, event.NumberWidth, false)
	if err != nil {
		return nil, err
	}
	if err := validatePersistedNumberEvent(event, levels); err != nil {
		return nil, err
	}
	_, err = tx.Exec(ctx, `
		UPDATE lottery_number_events
		SET status = 'live',
		    published_by = NULLIF($2, 0),
		    published_at = now(),
		    revision = revision + 1,
		    updated_at = now()
		WHERE id = $1`,
		eventID, actorID,
	)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, ErrNumberLiveExists
		}
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	detail, err := s.AdminEvent(ctx, eventID)
	if err != nil {
		return nil, err
	}
	s.publishBoard(ctx)
	return detail, nil
}

func (s *NumberService) Archive(
	ctx context.Context,
	eventID, actorID int64,
) (*NumberEventDetail, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	event, err := s.eventByID(ctx, tx, eventID, true)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNumberEventNotFound
	}
	if err != nil {
		return nil, err
	}
	if event.Status != "live" {
		return nil, ErrNumberEventNotLive
	}
	_, err = tx.Exec(ctx, `
		UPDATE lottery_number_events
		SET status = 'archived',
		    archived_by = NULLIF($2, 0),
		    archived_at = now(),
		    revision = revision + 1,
		    updated_at = now()
		WHERE id = $1`,
		eventID, actorID,
	)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	detail, err := s.AdminEvent(ctx, eventID)
	if err != nil {
		return nil, err
	}
	s.publishBoard(ctx)
	return detail, nil
}

func (s *NumberService) Draw(
	ctx context.Context,
	eventID, actorID int64,
	input NumberDrawInput,
) (*NumberDrawResult, error) {
	input.RequestID = strings.TrimSpace(input.RequestID)
	if input.LevelID <= 0 || len(input.RequestID) < 8 ||
		len(input.RequestID) > 128 {
		return nil, fmt.Errorf("%w：开奖参数无效", ErrNumberInvalid)
	}

	if existing, err := s.existingDraw(ctx, s.pool, input.RequestID); err == nil {
		if existing.EventID != eventID || existing.LevelID != input.LevelID {
			return nil, ErrNumberDrawRequest
		}
		return s.drawResult(ctx, s.pool, existing, true)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	event, err := s.eventByID(ctx, tx, eventID, true)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNumberEventNotFound
	}
	if err != nil {
		return nil, err
	}
	if event.Status != "live" {
		return nil, ErrNumberEventNotLive
	}

	if existing, err := s.existingDraw(ctx, tx, input.RequestID); err == nil {
		if existing.EventID != eventID || existing.LevelID != input.LevelID {
			return nil, ErrNumberDrawRequest
		}
		_ = tx.Rollback(ctx)
		return s.drawResult(ctx, s.pool, existing, true)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	var nextLevelID int64
	var nextLevelName string
	var nextWinnerCount int
	err = tx.QueryRow(ctx, `
		SELECT l.id, l.name, l.winner_count
		FROM lottery_number_levels l
		LEFT JOIN lottery_number_draws d ON d.level_id = l.id
		WHERE l.event_id = $1 AND d.id IS NULL
		ORDER BY l.sort, l.id
		LIMIT 1`,
		eventID,
	).Scan(&nextLevelID, &nextLevelName, &nextWinnerCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNumberDrawComplete
	}
	if err != nil {
		return nil, err
	}
	if nextLevelID != input.LevelID {
		var alreadyDrawn bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM lottery_number_draws
				WHERE event_id = $1 AND level_id = $2
			)`,
			eventID, input.LevelID,
		).Scan(&alreadyDrawn); err != nil {
			return nil, err
		}
		if alreadyDrawn {
			return nil, ErrNumberLevelDrawn
		}
		return nil, ErrNumberDrawOutOfOrder
	}

	excluded := map[int64]struct{}{}
	rows, err := tx.Query(ctx,
		`SELECT number FROM lottery_number_winners WHERE event_id = $1`,
		eventID,
	)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var number int64
		if err := rows.Scan(&number); err != nil {
			rows.Close()
			return nil, err
		}
		excluded[number] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	totalCapacity := event.RangeEnd - event.RangeStart + 1
	if int64(len(excluded)+nextWinnerCount) > totalCapacity {
		return nil, fmt.Errorf("%w：剩余号码数量不足", ErrNumberInvalid)
	}
	numbers, err := s.randomNumbers(
		event.RangeStart,
		event.RangeEnd,
		nextWinnerCount,
		excluded,
	)
	if err != nil {
		return nil, err
	}

	var draw numberDrawRecord
	err = tx.QueryRow(ctx, `
		INSERT INTO lottery_number_draws
			(event_id, level_id, request_id, operator_id)
		VALUES ($1, $2, $3, NULLIF($4, 0))
		RETURNING id, created_at`,
		eventID, nextLevelID, input.RequestID, actorID,
	).Scan(&draw.ID, &draw.CreatedAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			_ = tx.Rollback(ctx)
			if existing, lookupErr := s.existingDraw(
				ctx,
				s.pool,
				input.RequestID,
			); lookupErr == nil {
				if existing.EventID != eventID || existing.LevelID != nextLevelID {
					return nil, ErrNumberDrawRequest
				}
				return s.drawResult(ctx, s.pool, existing, true)
			}
			return nil, ErrNumberLevelDrawn
		}
		return nil, err
	}

	if len(numbers) > 0 {
		if _, err := tx.Exec(ctx, `
			INSERT INTO lottery_number_winners
				(draw_id, event_id, level_id, number, position)
			SELECT $1, $2, $3, picked.number, picked.position::int
			FROM unnest($4::bigint[]) WITH ORDINALITY
				AS picked(number, position)`,
			draw.ID, eventID, nextLevelID, numbers,
		); err != nil {
			return nil, err
		}
	}
	if _, err := tx.Exec(ctx, `
		UPDATE lottery_number_events
		SET revision = revision + 1, updated_at = now()
		WHERE id = $1`,
		eventID,
	); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	draw.EventID = eventID
	draw.LevelID = nextLevelID
	draw.LevelName = nextLevelName
	result, err := s.drawResult(ctx, s.pool, draw, false)
	if err != nil {
		return nil, err
	}
	s.publishBoard(ctx)
	return result, nil
}

func (s *NumberService) ExportRows(
	ctx context.Context,
	eventID int64,
) ([]NumberExportRow, error) {
	var width int
	err := s.pool.QueryRow(ctx,
		`SELECT number_width FROM lottery_number_events WHERE id = $1`,
		eventID,
	).Scan(&width)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNumberEventNotFound
	}
	if err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `
		SELECT e.name, l.name, w.number, d.created_at,
		       COALESCE(a.username, '')
		FROM lottery_number_winners w
		JOIN lottery_number_events e ON e.id = w.event_id
		JOIN lottery_number_levels l ON l.id = w.level_id
		JOIN lottery_number_draws d ON d.id = w.draw_id
		LEFT JOIN admin_accounts a ON a.id = d.operator_id
		WHERE w.event_id = $1
		ORDER BY l.sort, l.id, w.number`,
		eventID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []NumberExportRow{}
	for rows.Next() {
		var row NumberExportRow
		var number int64
		if err := rows.Scan(
			&row.Event, &row.Level, &number, &row.DrawnAt, &row.Operator,
		); err != nil {
			return nil, err
		}
		row.Number = formatNumber(number, width)
		out = append(out, row)
	}
	return out, rows.Err()
}

func (s *NumberService) publishBoard(ctx context.Context) {
	if s.publisher == nil {
		return
	}
	board, err := s.Board(ctx)
	if err != nil {
		log.Printf("lottery: build board for websocket: %v", err)
		return
	}
	message, err := json.Marshal(map[string]any{
		"type": "lottery_board",
		"data": board,
	})
	if err != nil {
		log.Printf("lottery: marshal board for websocket: %v", err)
		return
	}
	if err := s.publisher.Publish(ctx, string(message)); err != nil {
		log.Printf("lottery: publish board: %v", err)
	}
}

func (s *NumberService) liveEvent(ctx context.Context) (numberEventRecord, error) {
	return scanNumberEvent(s.pool.QueryRow(ctx, `
		SELECT id, name, status, range_start, range_end, number_width,
		       revision, published_at, archived_at, created_at, updated_at
		FROM lottery_number_events
		WHERE status = 'live'`))
}

func (s *NumberService) eventByID(
	ctx context.Context,
	queryer numberRowQueryer,
	eventID int64,
	lock bool,
) (numberEventRecord, error) {
	query := `
		SELECT id, name, status, range_start, range_end, number_width,
		       revision, published_at, archived_at, created_at, updated_at
		FROM lottery_number_events
		WHERE id = $1`
	if lock {
		query += ` FOR UPDATE`
	}
	return scanNumberEvent(queryer.QueryRow(ctx, query, eventID))
}

func scanNumberEvent(row pgx.Row) (numberEventRecord, error) {
	var event numberEventRecord
	err := row.Scan(
		&event.ID, &event.Name, &event.Status, &event.RangeStart,
		&event.RangeEnd, &event.NumberWidth, &event.Revision,
		&event.PublishedAt, &event.ArchivedAt, &event.CreatedAt,
		&event.UpdatedAt,
	)
	return event, err
}

func (s *NumberService) loadLevels(
	ctx context.Context,
	queryer numberRowsQueryer,
	eventID int64,
	width int,
	includeOperator bool,
) ([]NumberLevelView, error) {
	rows, err := queryer.Query(ctx, `
		SELECT l.id, l.name, l.winner_count, l.sort, d.created_at,
		       COALESCE(a.username, '')
		FROM lottery_number_levels l
		LEFT JOIN lottery_number_draws d ON d.level_id = l.id
		LEFT JOIN admin_accounts a ON a.id = d.operator_id
		WHERE l.event_id = $1
		ORDER BY l.sort, l.id`,
		eventID,
	)
	if err != nil {
		return nil, err
	}
	out := []NumberLevelView{}
	for rows.Next() {
		var level NumberLevelView
		var operator string
		if err := rows.Scan(
			&level.ID, &level.Name, &level.WinnerCount, &level.Sort,
			&level.DrawnAt, &operator,
		); err != nil {
			rows.Close()
			return nil, err
		}
		level.State = "pending"
		level.Winners = []string{}
		if level.DrawnAt != nil {
			level.State = "revealed"
		}
		if includeOperator {
			level.Operator = operator
		}
		out = append(out, level)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	if len(out) == 0 {
		return out, nil
	}

	winnerRows, err := queryer.Query(ctx, `
		SELECT level_id, number
		FROM lottery_number_winners
		WHERE event_id = $1
		ORDER BY level_id, number`,
		eventID,
	)
	if err != nil {
		return nil, err
	}
	defer winnerRows.Close()
	byLevel := make(map[int64][]string, len(out))
	for winnerRows.Next() {
		var levelID int64
		var number int64
		if err := winnerRows.Scan(&levelID, &number); err != nil {
			return nil, err
		}
		byLevel[levelID] = append(byLevel[levelID], formatNumber(number, width))
	}
	if err := winnerRows.Err(); err != nil {
		return nil, err
	}
	for index := range out {
		if winners, ok := byLevel[out[index].ID]; ok {
			out[index].Winners = winners
		}
	}
	return out, nil
}

func (s *NumberService) existingDraw(
	ctx context.Context,
	queryer numberRowQueryer,
	requestID string,
) (numberDrawRecord, error) {
	var draw numberDrawRecord
	err := queryer.QueryRow(ctx, `
		SELECT d.id, d.event_id, d.level_id, l.name, d.created_at
		FROM lottery_number_draws d
		JOIN lottery_number_levels l ON l.id = d.level_id
		WHERE d.request_id = $1`,
		requestID,
	).Scan(&draw.ID, &draw.EventID, &draw.LevelID, &draw.LevelName, &draw.CreatedAt)
	return draw, err
}

func (s *NumberService) drawResult(
	ctx context.Context,
	queryer numberRowsQueryer,
	draw numberDrawRecord,
	duplicate bool,
) (*NumberDrawResult, error) {
	var width int
	rows, err := queryer.Query(ctx, `
		SELECT e.number_width, w.number
		FROM lottery_number_draws d
		JOIN lottery_number_events e ON e.id = d.event_id
		JOIN lottery_number_winners w ON w.draw_id = d.id
		WHERE d.id = $1
		ORDER BY w.number`,
		draw.ID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	winners := []string{}
	for rows.Next() {
		var number int64
		if err := rows.Scan(&width, &number); err != nil {
			return nil, err
		}
		winners = append(winners, formatNumber(number, width))
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return &NumberDrawResult{
		EventID:   draw.EventID,
		LevelID:   draw.LevelID,
		LevelName: draw.LevelName,
		Winners:   winners,
		DrawnAt:   draw.CreatedAt,
		Duplicate: duplicate,
	}, nil
}

func (s *NumberService) randomNumbers(
	start, end int64,
	count int,
	excluded map[int64]struct{},
) ([]int64, error) {
	span := end - start + 1
	if span <= 0 || count <= 0 {
		return nil, fmt.Errorf("%w：随机号码数量无效", ErrNumberInvalid)
	}
	out := make([]int64, 0, count)
	for len(out) < count {
		offset, err := rand.Int(s.random, big.NewInt(span))
		if err != nil {
			return nil, err
		}
		number := start + offset.Int64()
		if _, exists := excluded[number]; exists {
			continue
		}
		excluded[number] = struct{}{}
		out = append(out, number)
	}
	return out, nil
}

func normalizeNumberEvent(input NumberEventInput) (normalizedNumberEvent, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" || utf8.RuneCountInString(name) > maxNumberEventNameLen {
		return normalizedNumberEvent{}, numberInvalid(
			"场次名称需为 1-%d 个字符", maxNumberEventNameLen,
		)
	}
	start, err := parseNumberBoundary(input.RangeStart)
	if err != nil {
		return normalizedNumberEvent{}, numberInvalid("起始号码无效")
	}
	end, err := parseNumberBoundary(input.RangeEnd)
	if err != nil || end < start {
		return normalizedNumberEvent{}, numberInvalid("结束号码必须大于或等于起始号码")
	}
	if input.NumberWidth < 1 || input.NumberWidth > 16 {
		return normalizedNumberEvent{}, numberInvalid("显示位宽需为 1-16")
	}
	endLength := len(strconv.FormatInt(end, 10))
	if input.NumberWidth < endLength {
		return normalizedNumberEvent{}, numberInvalid(
			"显示位宽不能少于结束号码的 %d 位", endLength,
		)
	}
	if len(input.Levels) == 0 || len(input.Levels) > maxNumberLevels {
		return normalizedNumberEvent{}, numberInvalid(
			"中奖等级需为 1-%d 个", maxNumberLevels,
		)
	}

	levels := make([]NumberLevelInput, 0, len(input.Levels))
	names := map[string]struct{}{}
	total := 0
	for _, raw := range input.Levels {
		levelName := strings.TrimSpace(raw.Name)
		if levelName == "" ||
			utf8.RuneCountInString(levelName) > maxNumberLevelNameLen {
			return normalizedNumberEvent{}, numberInvalid(
				"等级名称需为 1-%d 个字符", maxNumberLevelNameLen,
			)
		}
		key := strings.ToLower(levelName)
		if _, exists := names[key]; exists {
			return normalizedNumberEvent{}, numberInvalid("等级名称不能重复")
		}
		names[key] = struct{}{}
		if raw.WinnerCount < 1 || raw.WinnerCount > maxNumberWinners {
			return normalizedNumberEvent{}, numberInvalid(
				"每个等级的中奖人数需为 1-%d", maxNumberWinners,
			)
		}
		total += raw.WinnerCount
		levels = append(levels, NumberLevelInput{
			Name:        levelName,
			WinnerCount: raw.WinnerCount,
		})
	}
	if total > maxNumberWinners {
		return normalizedNumberEvent{}, numberInvalid(
			"单场总中奖人数不能超过 %d", maxNumberWinners,
		)
	}
	capacity := end - start + 1
	if int64(total) > capacity {
		return normalizedNumberEvent{}, numberInvalid(
			"中奖人数不能超过号码范围容量",
		)
	}
	return normalizedNumberEvent{
		name:        name,
		rangeStart:  start,
		rangeEnd:    end,
		numberWidth: input.NumberWidth,
		levels:      levels,
	}, nil
}

func validatePersistedNumberEvent(
	event numberEventRecord,
	levels []NumberLevelView,
) error {
	if len(levels) == 0 || len(levels) > maxNumberLevels {
		return numberInvalid("中奖等级数量无效")
	}
	capacity := event.RangeEnd - event.RangeStart + 1
	total := 0
	for _, level := range levels {
		total += level.WinnerCount
	}
	if total < 1 || total > maxNumberWinners || int64(total) > capacity {
		return numberInvalid("中奖人数超过允许范围")
	}
	return nil
}

func parseNumberBoundary(value string) (int64, error) {
	value = strings.TrimSpace(value)
	if value == "" || strings.HasPrefix(value, "+") {
		return 0, errors.New("号码不能为空")
	}
	number, err := strconv.ParseInt(value, 10, 64)
	if err != nil || number < 0 || number > maxNumberRange {
		return 0, errors.New("号码超出允许范围")
	}
	return number, nil
}

func numberInvalid(format string, args ...any) error {
	return fmt.Errorf("%w：%s", ErrNumberInvalid, fmt.Sprintf(format, args...))
}

func numberEventView(
	event numberEventRecord,
	levels []NumberLevelView,
) NumberEventView {
	completed := len(levels) > 0
	for _, level := range levels {
		if level.DrawnAt == nil {
			completed = false
			break
		}
	}
	return NumberEventView{
		ID:          event.ID,
		Name:        event.Name,
		Status:      event.Status,
		RangeStart:  strconv.FormatInt(event.RangeStart, 10),
		RangeEnd:    strconv.FormatInt(event.RangeEnd, 10),
		NumberWidth: event.NumberWidth,
		Revision:    event.Revision,
		Completed:   completed,
		PublishedAt: event.PublishedAt,
		ArchivedAt:  event.ArchivedAt,
		CreatedAt:   event.CreatedAt,
		UpdatedAt:   event.UpdatedAt,
	}
}

func formatNumber(number int64, width int) string {
	return fmt.Sprintf("%0*d", width, number)
}
