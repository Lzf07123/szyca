package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"szyca/internal/platform/migrate"
)

var (
	ErrNotFound             = errors.New("not found")
	ErrNicknameTaken        = errors.New("nickname already exists")
	ErrDeviceTaken          = errors.New("device already bound")
	ErrQuestionOrder        = errors.New("not current question")
	ErrQuestionExpired      = errors.New("question expired")
	ErrQuestionAlreadyTaken = errors.New("question already answered")
	ErrRequestConflict      = errors.New("request id belongs to another user")
	ErrQuizStopped          = errors.New("quiz not started")
)

type Store struct{ pool *pgxpool.Pool }

type User struct {
	ID        int64
	Nickname  string
	Token     string
	DeviceFP  string
	Abandoned bool
	CreatedAt time.Time
}

type Question struct {
	ID         int64    `json:"id"`
	Content    string   `json:"content"`
	Options    []string `json:"options"`
	Answer     int      `json:"-"`
	Score      int      `json:"score"`
	Sort       int      `json:"sort"`
	Active     bool     `json:"active"`
	Difficulty string   `json:"difficulty"`
}

type Attempt struct {
	ID         int64
	UserID     int64
	QuestionID int64
	Selected   *int
	Correct    bool
	Score      int
	RequestID  string
	RoundNo    int
	CreatedAt  time.Time
}

type UserStats struct {
	Correct int
	Score   int
	Count   int
	First   time.Time
	Last    time.Time
}

type Qrcode struct {
	ID       int64  `json:"id"`
	Title    string `json:"title"`
	ImageURL string `json:"image_url"`
	Active   bool   `json:"active"`
}

type Background struct {
	ID        int64     `json:"id"`
	FilePath  string    `json:"file_path"`
	Active    bool      `json:"active"`
	CreatedAt time.Time `json:"created_at"`
}

type Announcement struct {
	ID        int64
	Content   string
	Type      string
	CreatedAt time.Time
}

func Open(ctx context.Context, dsn string, maxConns int) (*Store, error) {
	pc, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}
	if maxConns > 0 {
		pc.MaxConns = int32(maxConns)
	}
	pool, err := pgxpool.NewWithConfig(ctx, pc)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	if err := migrate.Run(ctx, pool); err != nil {
		pool.Close()
		return nil, fmt.Errorf("apply migrations: %w", err)
	}
	s := &Store{pool: pool}
	if err := s.seedQuestions(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("seed: %w", err)
	}
	return s, nil
}

func (s *Store) Close() { s.pool.Close() }

// Pool exposes the shared connection pool to domain services. Store remains the
// owner of lifecycle and migrations; business modules own their own tables.
func (s *Store) Pool() *pgxpool.Pool { return s.pool }

// ---------- users ----------

func (s *Store) CreateUser(ctx context.Context, nickname, token, deviceFP string) (*User, error) {
	u := &User{Nickname: nickname, Token: token, DeviceFP: deviceFP}
	err := s.pool.QueryRow(ctx,
		`INSERT INTO users (nickname, token, device_fp) VALUES ($1,$2,$3) RETURNING id, created_at`,
		nickname, token, deviceFP).Scan(&u.ID, &u.CreatedAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			switch pgErr.ConstraintName {
			case "users_nickname_unique":
				return nil, ErrNicknameTaken
			case "users_active_device_unique":
				return nil, ErrDeviceTaken
			}
		}
		return nil, err
	}
	return u, nil
}

// GetUserByNickname 按昵称查用户（含已放弃），用于昵称唯一性与封存校验。
func (s *Store) GetUserByNickname(ctx context.Context, nickname string) (*User, error) {
	return s.getUser(ctx, `SELECT id, nickname, token, device_fp, abandoned, created_at FROM users WHERE nickname = $1 ORDER BY id LIMIT 1`, nickname)
}

// GetUserByDeviceFP 只匹配未放弃的身份（放弃后本机可注册新身份）。
func (s *Store) GetUserByDeviceFP(ctx context.Context, deviceFP string) (*User, error) {
	return s.getUser(ctx,
		`SELECT id, nickname, token, device_fp, abandoned, created_at FROM users WHERE device_fp = $1 AND NOT abandoned ORDER BY id LIMIT 1`,
		deviceFP)
}

func (s *Store) GetUserByToken(ctx context.Context, token string) (*User, error) {
	return s.getUser(ctx, `SELECT id, nickname, token, device_fp, abandoned, created_at FROM users WHERE token = $1`, token)
}

func (s *Store) GetUser(ctx context.Context, id int64) (*User, error) {
	return s.getUser(ctx, `SELECT id, nickname, token, device_fp, abandoned, created_at FROM users WHERE id = $1`, id)
}

// AbandonUser 放弃身份：解除设备绑定并标记弃用（保留答题历史用于统计）。
func (s *Store) AbandonUser(ctx context.Context, userID int64) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE users SET abandoned = TRUE, device_fp = '' WHERE id = $1`, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) getUser(ctx context.Context, q string, arg any) (*User, error) {
	u := &User{}
	err := s.pool.QueryRow(ctx, q, arg).Scan(&u.ID, &u.Nickname, &u.Token, &u.DeviceFP, &u.Abandoned, &u.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return u, nil
}

// ---------- questions ----------

func (s *Store) ListActiveQuestions(ctx context.Context, difficulty string) ([]Question, error) {
	return s.listQuestions(ctx,
		`SELECT id, content, options, answer, score, sort, active, difficulty
		 FROM questions WHERE active AND ($1 = '全部' OR difficulty = $1) ORDER BY sort, id`, difficulty)
}

func (s *Store) AllQuestions(ctx context.Context) ([]Question, error) {
	return s.listQuestions(ctx, `SELECT id, content, options, answer, score, sort, active, difficulty FROM questions ORDER BY sort, id`)
}

func (s *Store) listQuestions(ctx context.Context, q string, args ...any) ([]Question, error) {
	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Question{}
	for rows.Next() {
		var item Question
		var raw []byte
		if err := rows.Scan(&item.ID, &item.Content, &raw, &item.Answer, &item.Score, &item.Sort, &item.Active, &item.Difficulty); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(raw, &item.Options); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *Store) GetQuestion(ctx context.Context, id int64) (*Question, error) {
	item := &Question{}
	var raw []byte
	err := s.pool.QueryRow(ctx,
		`SELECT id, content, options, answer, score, sort, active, difficulty FROM questions WHERE id = $1`, id).
		Scan(&item.ID, &item.Content, &raw, &item.Answer, &item.Score, &item.Sort, &item.Active, &item.Difficulty)
	if err != nil {
		if err.Error() == "no rows in result set" {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if err := json.Unmarshal(raw, &item.Options); err != nil {
		return nil, err
	}
	return item, nil
}

func (s *Store) CreateQuestion(ctx context.Context, content string, options []string, answer, score, sort int, difficulty string) (*Question, error) {
	raw, _ := json.Marshal(options)
	item := &Question{Content: content, Options: options, Answer: answer, Score: score, Sort: sort, Difficulty: difficulty}
	err := s.pool.QueryRow(ctx,
		`INSERT INTO questions (content, options, answer, score, sort, difficulty) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
		content, raw, answer, score, sort, difficulty).Scan(&item.ID)
	if err != nil {
		return nil, err
	}
	return item, nil
}

func (s *Store) SetQuestionActive(ctx context.Context, id int64, active bool) error {
	tag, err := s.pool.Exec(ctx, `UPDATE questions SET active = $2 WHERE id = $1`, id, active)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ---------- attempts ----------

type RecordAttemptResult struct {
	Attempt             *Attempt
	Duplicate           bool
	CurrentQuestionIdx  int
	NextQuestionStarted time.Time
}

// RecordAttempt 在用户行锁内完成“当前题序校验 + 唯一作答 + 推进题序”，
// 保证同一轮每题只计分一次，并阻止跳题、重复提交和超时后继续作答。
func (s *Store) RecordAttempt(ctx context.Context, a *Attempt, questionSeconds, graceSeconds int) (*RecordAttemptResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var roundNo, currentIdx int
	var startedAt time.Time
	var state string
	err = tx.QueryRow(ctx,
		`SELECT u.current_round, u.current_question_idx, u.question_started_at, qs.state
		 FROM users u CROSS JOIN quiz_state qs
		 WHERE u.id = $1 AND qs.id = 1
		 FOR UPDATE OF u`, a.UserID).
		Scan(&roundNo, &currentIdx, &startedAt, &state)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if roundNo == 0 {
		return nil, ErrNotFound
	}

	// 同一 request_id 的并发重试必须返回原结果，不推进题序。
	if existing, err := getAttemptByRequest(ctx, tx, a.RequestID); err == nil {
		if existing.UserID != a.UserID {
			return nil, ErrRequestConflict
		}
		return &RecordAttemptResult{
			Attempt: existing, Duplicate: true, CurrentQuestionIdx: currentIdx,
			NextQuestionStarted: startedAt,
		}, nil
	} else if !errors.Is(err, ErrNotFound) {
		return nil, err
	}
	if state != "start" {
		return nil, ErrQuizStopped
	}

	var expectedQuestionID int64
	err = tx.QueryRow(ctx,
		`SELECT question_id FROM round_questions
		 WHERE user_id = $1 AND round_no = $2 AND position = $3`,
		a.UserID, roundNo, currentIdx).Scan(&expectedQuestionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if expectedQuestionID != a.QuestionID {
		return nil, ErrQuestionOrder
	}
	deadline := startedAt.Add(time.Duration(questionSeconds+graceSeconds) * time.Second)
	if time.Now().After(deadline) {
		return nil, ErrQuestionExpired
	}

	a.RoundNo = roundNo
	err = tx.QueryRow(ctx,
		`INSERT INTO attempts (user_id, question_id, selected, correct, score, request_id, round_no)
		 VALUES ($1,$2,$3,$4,$5,$6,$7)
		 ON CONFLICT (request_id) DO NOTHING
		 RETURNING id, created_at`,
		a.UserID, a.QuestionID, a.Selected, a.Correct, a.Score, a.RequestID, a.RoundNo).
		Scan(&a.ID, &a.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			existing, lookupErr := getAttemptByRequest(ctx, tx, a.RequestID)
			if lookupErr != nil {
				return nil, lookupErr
			}
			if existing.UserID != a.UserID {
				return nil, ErrRequestConflict
			}
			return &RecordAttemptResult{
				Attempt: existing, Duplicate: true, CurrentQuestionIdx: currentIdx,
				NextQuestionStarted: startedAt,
			}, nil
		}
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" &&
			pgErr.ConstraintName == "attempts_user_round_question_unique" {
			return nil, ErrQuestionAlreadyTaken
		}
		return nil, err
	}

	nextIdx := currentIdx + 1
	nextStarted := time.Now()
	if _, err := tx.Exec(ctx,
		`UPDATE users SET current_question_idx = $2, question_started_at = $3 WHERE id = $1`,
		a.UserID, nextIdx, nextStarted); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &RecordAttemptResult{
		Attempt: a, CurrentQuestionIdx: nextIdx, NextQuestionStarted: nextStarted,
	}, nil
}

func (s *Store) GetAttemptByRequest(ctx context.Context, requestID string) (*Attempt, error) {
	return getAttemptByRequest(ctx, s.pool, requestID)
}

type attemptQuerier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func getAttemptByRequest(ctx context.Context, q attemptQuerier, requestID string) (*Attempt, error) {
	a := &Attempt{}
	var sel int
	err := q.QueryRow(ctx,
		`SELECT id, user_id, COALESCE(question_id, 0), COALESCE(selected,-1), correct, score, request_id, round_no, created_at
		 FROM attempts WHERE request_id = $1`, requestID).
		Scan(&a.ID, &a.UserID, &a.QuestionID, &sel, &a.Correct, &a.Score, &a.RequestID, &a.RoundNo, &a.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if sel >= 0 {
		a.Selected = &sel
	}
	return a, nil
}

func (s *Store) UserStats(ctx context.Context, userID int64) (*UserStats, error) {
	st := &UserStats{}
	err := s.pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(CASE WHEN correct THEN 1 ELSE 0 END),0), COALESCE(SUM(score),0), COUNT(*),
		        COALESCE(MIN(created_at), now()), COALESCE(MAX(created_at), now())
		 FROM attempts WHERE user_id = $1 AND counted`, userID).
		Scan(&st.Correct, &st.Score, &st.Count, &st.First, &st.Last)
	if err != nil {
		return nil, err
	}
	return st, nil
}

// AbandonRound 作废当前轮：删除该轮全部作答（身份与其他轮次保留）。
func (s *Store) AbandonRound(ctx context.Context, userID int64, roundNo int) (int64, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx,
		`DELETE FROM attempts WHERE user_id = $1 AND round_no = $2`, userID, roundNo)
	if err != nil {
		return 0, err
	}
	if _, err := tx.Exec(ctx,
		`DELETE FROM round_questions WHERE user_id = $1 AND round_no = $2`, userID, roundNo); err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// ---------- rounds & best score ----------

// NextRound 为用户开启新一轮（难度随轮持久化）并返回轮次号。
func (s *Store) NextRound(ctx context.Context, userID int64, difficulty string) (int, time.Time, error) {
	var n int
	var startedAt time.Time
	err := s.pool.QueryRow(ctx,
		`UPDATE users
		 SET current_round = current_round + 1,
		     current_question_idx = 0,
		     question_started_at = now(),
		     current_difficulty = $2
		 WHERE id = $1
		 RETURNING current_round, question_started_at`,
		userID, difficulty).Scan(&n, &startedAt)
	return n, startedAt, err
}

func (s *Store) SaveRoundQuestions(ctx context.Context, userID int64, roundNo int, questionIDs []int64) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	for i, questionID := range questionIDs {
		if _, err := tx.Exec(ctx,
			`INSERT INTO round_questions (user_id, round_no, position, question_id)
			 VALUES ($1,$2,$3,$4)`,
			userID, roundNo, i, questionID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Store) RoundQuestions(ctx context.Context, userID int64, roundNo int) ([]Question, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT q.id, q.content, q.options, q.answer, q.score, q.sort, q.active, q.difficulty
		 FROM round_questions rq
		 JOIN questions q ON q.id = rq.question_id
		 WHERE rq.user_id = $1 AND rq.round_no = $2
		 ORDER BY rq.position`, userID, roundNo)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Question{}
	for rows.Next() {
		var item Question
		var raw []byte
		if err := rows.Scan(&item.ID, &item.Content, &raw, &item.Answer, &item.Score, &item.Sort, &item.Active, &item.Difficulty); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(raw, &item.Options); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

type CurrentRoundState struct {
	RoundNo            int
	CurrentQuestionIdx int
	QuestionStartedAt  time.Time
}

type SubmissionQuestion struct {
	State              string
	RoundNo            int
	CurrentQuestionIdx int
	QuestionStartedAt  time.Time
	Question           Question
}

// CurrentSubmissionQuestion 一次查询取得答题状态、当前题序和服务端题目内容，
// 避免提交热路径上多次往返数据库。
func (s *Store) CurrentSubmissionQuestion(ctx context.Context, userID int64) (*SubmissionQuestion, error) {
	st := &SubmissionQuestion{}
	var raw []byte
	err := s.pool.QueryRow(ctx,
		`SELECT qs.state, u.current_round, u.current_question_idx, u.question_started_at,
		        COALESCE(q.id, 0), COALESCE(q.content, ''), COALESCE(q.options, '[]'::jsonb),
		        COALESCE(q.answer, 0), COALESCE(q.score, 0), COALESCE(q.sort, 0),
		        COALESCE(q.active, FALSE), COALESCE(q.difficulty, '')
		 FROM users u
		 CROSS JOIN quiz_state qs
		 LEFT JOIN round_questions rq
		   ON rq.user_id = u.id AND rq.round_no = u.current_round AND rq.position = u.current_question_idx
		 LEFT JOIN questions q ON q.id = rq.question_id
		 WHERE u.id = $1 AND qs.id = 1`, userID).
		Scan(
			&st.State, &st.RoundNo, &st.CurrentQuestionIdx, &st.QuestionStartedAt,
			&st.Question.ID, &st.Question.Content, &raw, &st.Question.Answer,
			&st.Question.Score, &st.Question.Sort, &st.Question.Active, &st.Question.Difficulty,
		)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(raw, &st.Question.Options); err != nil {
		return nil, err
	}
	return st, nil
}

func (s *Store) CurrentRoundState(ctx context.Context, userID int64) (*CurrentRoundState, error) {
	st := &CurrentRoundState{}
	err := s.pool.QueryRow(ctx,
		`SELECT current_round, current_question_idx, question_started_at
		 FROM users WHERE id = $1`, userID).
		Scan(&st.RoundNo, &st.CurrentQuestionIdx, &st.QuestionStartedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return st, nil
}

// CurrentDifficulty 返回用户当前轮所选难度。
func (s *Store) CurrentDifficulty(ctx context.Context, userID int64) (string, error) {
	var d string
	err := s.pool.QueryRow(ctx,
		`SELECT current_difficulty FROM users WHERE id = $1`, userID).Scan(&d)
	return d, err
}

// CurrentRoundNo 返回用户当前轮次号（0 表示尚未开始）。
func (s *Store) CurrentRoundNo(ctx context.Context, userID int64) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx,
		`SELECT current_round FROM users WHERE id = $1`, userID).Scan(&n)
	return n, err
}

type RoundStats struct {
	Correct int
	Score   int
	Count   int
	First   time.Time
	Last    time.Time
}

func (s *Store) RoundStats(ctx context.Context, userID int64, roundNo int) (*RoundStats, error) {
	st := &RoundStats{}
	err := s.pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(CASE WHEN correct THEN 1 ELSE 0 END),0), COALESCE(SUM(score),0), COUNT(*),
		        COALESCE(MIN(created_at), now()), COALESCE(MAX(created_at), now())
		 FROM attempts WHERE user_id = $1 AND round_no = $2 AND counted`, userID, roundNo).
		Scan(&st.Correct, &st.Score, &st.Count, &st.First, &st.Last)
	if err != nil {
		return nil, err
	}
	return st, nil
}

// BestRoundStats 取最高成绩的一轮（同分取用时更短）。
func (s *Store) BestRoundStats(ctx context.Context, userID int64) (*RoundStats, error) {
	st := &RoundStats{}
	err := s.pool.QueryRow(ctx,
		`SELECT COALESCE(st.correct,0), COALESCE(st.score,0), COALESCE(st.cnt,0),
		        COALESCE(st.first_ts, now()), COALESCE(st.last_ts, now())
		 FROM (
		     SELECT COUNT(*) FILTER (WHERE correct) AS correct,
		            COALESCE(SUM(score),0) AS score,
		            COUNT(*) AS cnt,
		            MIN(created_at) AS first_ts, MAX(created_at) AS last_ts
		     FROM attempts WHERE user_id = $1 AND counted GROUP BY round_no
		 ) st
		 ORDER BY st.score DESC, (st.last_ts - st.first_ts) ASC
		 LIMIT 1`, userID).
		Scan(&st.Correct, &st.Score, &st.Count, &st.First, &st.Last)
	if err != nil {
		if err.Error() == "no rows in result set" {
			return &RoundStats{}, nil
		}
		return nil, err
	}
	return st, nil
}

// ---------- quiz state ----------

func (s *Store) QuizState(ctx context.Context) (string, error) {
	var state string
	err := s.pool.QueryRow(ctx, `SELECT state FROM quiz_state WHERE id = 1`).Scan(&state)
	if err != nil {
		return "stop", err
	}
	return state, nil
}

func (s *Store) SetQuizState(ctx context.Context, state string) error {
	_, err := s.pool.Exec(ctx, `UPDATE quiz_state SET state = $1 WHERE id = 1`, state)
	return err
}

func (s *Store) QuizDifficulty(ctx context.Context) (string, error) {
	var d string
	err := s.pool.QueryRow(ctx, `SELECT difficulty FROM quiz_state WHERE id = 1`).Scan(&d)
	if err != nil {
		return "全部", err
	}
	return d, nil
}

func (s *Store) SetQuizDifficulty(ctx context.Context, d string) error {
	_, err := s.pool.Exec(ctx, `UPDATE quiz_state SET difficulty = $1 WHERE id = 1`, d)
	return err
}

// ---------- qrcode ----------

// ListQrcodes 返回全部二维码（含停用，后台管理用）。
func (s *Store) ListQrcodes(ctx context.Context) ([]Qrcode, error) {
	return s.listQrcodes(ctx, `SELECT id, title, image_url, active FROM qrcodes ORDER BY id`)
}

// ListActiveQrcodes 返回全部启用中的二维码（前台「加入我们」页完整展示）。
func (s *Store) ListActiveQrcodes(ctx context.Context) ([]Qrcode, error) {
	return s.listQrcodes(ctx, `SELECT id, title, image_url, active FROM qrcodes WHERE active ORDER BY id`)
}

func (s *Store) listQrcodes(ctx context.Context, q string) ([]Qrcode, error) {
	rows, err := s.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Qrcode{}
	for rows.Next() {
		var qr Qrcode
		if err := rows.Scan(&qr.ID, &qr.Title, &qr.ImageURL, &qr.Active); err != nil {
			return nil, err
		}
		out = append(out, qr)
	}
	return out, rows.Err()
}

func (s *Store) GetQrcode(ctx context.Context, id int64) (*Qrcode, error) {
	q := &Qrcode{}
	err := s.pool.QueryRow(ctx,
		`SELECT id, title, image_url, active FROM qrcodes WHERE id = $1`, id).
		Scan(&q.ID, &q.Title, &q.ImageURL, &q.Active)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return q, nil
}

// CreateQrcode 新增启用状态的二维码。
func (s *Store) CreateQrcode(ctx context.Context, title, imageURL string) (*Qrcode, error) {
	q := &Qrcode{Title: title, ImageURL: imageURL, Active: true}
	err := s.pool.QueryRow(ctx,
		`INSERT INTO qrcodes (title, image_url, active) VALUES ($1,$2,TRUE) RETURNING id, active`,
		title, imageURL).Scan(&q.ID, &q.Active)
	if err != nil {
		return nil, err
	}
	return q, nil
}

func (s *Store) UpdateQrcode(ctx context.Context, id int64, title, imageURL string, active bool) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE qrcodes SET title = $2, image_url = $3, active = $4, updated_at = now() WHERE id = $1`,
		id, title, imageURL, active)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteQrcode 删除记录并返回图片路径，供调用方清理磁盘文件。
func (s *Store) DeleteQrcode(ctx context.Context, id int64) (string, error) {
	var imageURL string
	err := s.pool.QueryRow(ctx,
		`DELETE FROM qrcodes WHERE id = $1 RETURNING image_url`, id).Scan(&imageURL)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrNotFound
		}
		return "", err
	}
	return imageURL, nil
}

// ---------- announcements ----------

func (s *Store) InsertAnnouncement(ctx context.Context, content, typ string) (*Announcement, error) {
	a := &Announcement{Content: content, Type: typ}
	err := s.pool.QueryRow(ctx,
		`INSERT INTO announcements (content, type) VALUES ($1,$2) RETURNING id, created_at`,
		content, typ).Scan(&a.ID, &a.CreatedAt)
	if err != nil {
		return nil, err
	}
	return a, nil
}

// ---------- leaderboard ----------

type LBRow struct {
	UserID    int64
	Nickname  string
	Abandoned bool
	Correct   int
	Score     int
	Count     int
	ElapsedMS int64
}

// Leaderboard 全量排名：每人取最佳一轮（总分高者优先，同分用时短者靠前），
// 未答过题的排在最后（按注册先后）；窗口函数一次返回 total。
func (s *Store) Leaderboard(ctx context.Context) ([]LBRow, int64, error) {
	q := `SELECT u.id, u.nickname, u.abandoned,
	             COALESCE(b.correct, 0), COALESCE(b.score, 0), COALESCE(b.cnt, 0), COALESCE(b.elapsed_ms, 0),
	             COUNT(*) OVER() AS total
	      FROM users u
	      LEFT JOIN (
	          SELECT DISTINCT ON (user_id)
	                 user_id,
	                 COUNT(*) FILTER (WHERE correct) AS correct,
	                 COALESCE(SUM(score), 0) AS score,
	                 COUNT(*) AS cnt,
	                 (EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at))) * 1000)::bigint AS elapsed_ms
	          FROM attempts WHERE counted
	          GROUP BY user_id, round_no
	          ORDER BY user_id, score DESC, elapsed_ms ASC
	      ) b ON b.user_id = u.id
	      ORDER BY COALESCE(b.score, 0) DESC, COALESCE(b.elapsed_ms, 0) ASC, u.id ASC`
	rows, err := s.pool.Query(ctx, q)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []LBRow{}
	var total int64
	for rows.Next() {
		var r LBRow
		if err := rows.Scan(&r.UserID, &r.Nickname, &r.Abandoned, &r.Correct, &r.Score, &r.Count, &r.ElapsedMS, &total); err != nil {
			return nil, 0, err
		}
		out = append(out, r)
	}
	return out, total, rows.Err()
}

func (s *Store) CountAllUsers(ctx context.Context) (int64, error) {
	var n int64
	err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}

// ---------- export ----------

func (s *Store) ListAllUsers(ctx context.Context) ([]User, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, nickname, token, device_fp, abandoned, created_at FROM users ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []User{}
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Nickname, &u.Token, &u.DeviceFP, &u.Abandoned, &u.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// RoundCounts 返回 user_id → 答题轮数。
func (s *Store) RoundCounts(ctx context.Context) (map[int64]int, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT user_id, COUNT(DISTINCT round_no) FROM attempts WHERE counted GROUP BY user_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]int{}
	for rows.Next() {
		var uid int64
		var n int
		if err := rows.Scan(&uid, &n); err != nil {
			return nil, err
		}
		out[uid] = n
	}
	return out, rows.Err()
}

// ---------- overview ----------

func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }

func (s *Store) CountUsers(ctx context.Context) (int64, error) {
	var n int64
	err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM users WHERE NOT abandoned`).Scan(&n)
	return n, err
}

func (s *Store) CountQuestions(ctx context.Context) (int64, error) {
	var n int64
	err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM questions WHERE active`).Scan(&n)
	return n, err
}

func (s *Store) CountBackgrounds(ctx context.Context) (int64, error) {
	var n int64
	err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM backgrounds WHERE active`).Scan(&n)
	return n, err
}

// ---------- clear questions ----------

// ClearQuestions 一键清空题库：仅删除题目（question_id ON DELETE SET NULL），
// 答题记录与排行榜完整保留；并标记 skip_seed 防重启重新播种。
func (s *Store) ClearQuestions(ctx context.Context) (questions int64, err error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	qt, err := tx.Exec(ctx, `DELETE FROM questions`)
	if err != nil {
		return 0, err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO app_meta (k, v) VALUES ('skip_seed', '1') ON CONFLICT (k) DO UPDATE SET v = '1'`); err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return qt.RowsAffected(), nil
}

// DeleteAllBackgrounds 删除全部背景图记录并返回文件路径（供调用方清理磁盘）。
func (s *Store) DeleteAllBackgrounds(ctx context.Context) ([]string, error) {
	rows, err := s.pool.Query(ctx, `DELETE FROM backgrounds RETURNING file_path`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var paths []string
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			return nil, err
		}
		paths = append(paths, p)
	}
	return paths, rows.Err()
}

// SeedSkipped 用户是否执行过一键清空（跳过种子播种）。
func (s *Store) SeedSkipped(ctx context.Context) bool {
	var v string
	if err := s.pool.QueryRow(ctx, `SELECT v FROM app_meta WHERE k = 'skip_seed'`).Scan(&v); err != nil {
		return false
	}
	return v == "1"
}

// ---------- stats ----------

func (s *Store) CountAttempts(ctx context.Context) (int64, error) {
	var n int64
	err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM attempts WHERE counted`).Scan(&n)
	return n, err
}

func (s *Store) CountAnsweredUsers(ctx context.Context) (int64, error) {
	var n int64
	err := s.pool.QueryRow(ctx, `SELECT COUNT(DISTINCT user_id) FROM attempts WHERE counted`).Scan(&n)
	return n, err
}

// ---------- footer ----------

type Footer struct {
	Owner      string `json:"owner"`
	License    string `json:"license"`
	ICP        string `json:"icp"`
	ICPIcon    string `json:"icp_icon"`
	Police     string `json:"police"`
	PoliceIcon string `json:"police_icon"`
}

// EnsureFooterDefaults 首次启动时创建空行；内容完全由后台定义并持久化。
func (s *Store) EnsureFooterDefaults(ctx context.Context) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO footer_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`)
	return err
}

func (s *Store) GetFooterSettings(ctx context.Context) (*Footer, error) {
	f := &Footer{}
	err := s.pool.QueryRow(ctx,
		`SELECT owner, license, icp, icp_icon, police, police_icon FROM footer_settings WHERE id = 1`).
		Scan(&f.Owner, &f.License, &f.ICP, &f.ICPIcon, &f.Police, &f.PoliceIcon)
	if err != nil {
		return nil, err
	}
	return f, nil
}

func (s *Store) SaveFooterSettings(ctx context.Context, f *Footer) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE footer_settings SET owner = $1, license = $2, icp = $3, icp_icon = $4, police = $5, police_icon = $6, updated_at = now() WHERE id = 1`,
		f.Owner, f.License, f.ICP, f.ICPIcon, f.Police, f.PoliceIcon)
	return err
}

// ---------- site ----------

// EnsureSiteSettings 首次启动时创建单行站点设置。
func (s *Store) EnsureSiteSettings(ctx context.Context) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO site_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`)
	return err
}

// GetLogoURL 返回站点 Logo 地址；未配置时为空字符串（前台使用内置样式）。
func (s *Store) GetLogoURL(ctx context.Context) (string, error) {
	var url string
	err := s.pool.QueryRow(ctx, `SELECT logo_url FROM site_settings WHERE id = 1`).Scan(&url)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil
		}
		return "", err
	}
	return url, nil
}

// SaveLogoURL 保存站点 Logo 地址（空字符串 = 恢复内置样式）。
func (s *Store) SaveLogoURL(ctx context.Context, url string) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO site_settings (id, logo_url, updated_at) VALUES (1, $1, now())
		ON CONFLICT (id) DO UPDATE SET logo_url = EXCLUDED.logo_url, updated_at = now()`, url)
	return err
}

// ---------- backgrounds ----------

func (s *Store) CreateBackground(ctx context.Context, filePath string) (*Background, error) {
	b := &Background{FilePath: filePath, Active: true}
	err := s.pool.QueryRow(ctx,
		`INSERT INTO backgrounds (file_path) VALUES ($1) RETURNING id, active, created_at`,
		filePath).Scan(&b.ID, &b.Active, &b.CreatedAt)
	if err != nil {
		return nil, err
	}
	return b, nil
}

func (s *Store) ListBackgrounds(ctx context.Context) ([]Background, error) {
	return s.listBackgrounds(ctx, `SELECT id, file_path, active, created_at FROM backgrounds ORDER BY id DESC`)
}

func (s *Store) ListActiveBackgrounds(ctx context.Context) ([]Background, error) {
	return s.listBackgrounds(ctx, `SELECT id, file_path, active, created_at FROM backgrounds WHERE active ORDER BY id DESC`)
}

func (s *Store) listBackgrounds(ctx context.Context, q string) ([]Background, error) {
	rows, err := s.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Background{}
	for rows.Next() {
		var b Background
		if err := rows.Scan(&b.ID, &b.FilePath, &b.Active, &b.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func (s *Store) SetBackgroundActive(ctx context.Context, id int64, active bool) error {
	tag, err := s.pool.Exec(ctx, `UPDATE backgrounds SET active = $2 WHERE id = $1`, id, active)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteBackground 删除记录并返回文件路径，供调用方清理磁盘文件。
func (s *Store) DeleteBackground(ctx context.Context, id int64) (string, error) {
	var filePath string
	err := s.pool.QueryRow(ctx,
		`DELETE FROM backgrounds WHERE id = $1 RETURNING file_path`, id).Scan(&filePath)
	if err != nil {
		if err.Error() == "no rows in result set" {
			return "", ErrNotFound
		}
		return "", err
	}
	return filePath, nil
}

func (s *Store) LatestAnnouncement(ctx context.Context) (*Announcement, error) {
	a := &Announcement{}
	err := s.pool.QueryRow(ctx,
		`SELECT id, content, type, created_at FROM announcements ORDER BY id DESC LIMIT 1`).
		Scan(&a.ID, &a.Content, &a.Type, &a.CreatedAt)
	if err != nil {
		if err.Error() == "no rows in result set" {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return a, nil
}
