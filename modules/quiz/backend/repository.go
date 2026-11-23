package quiz

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

func (r *Repository) CreateUser(ctx context.Context, nickname, token, deviceFP string) (*User, error) {
	user := &User{Nickname: nickname, Token: token, DeviceFP: deviceFP}
	err := r.pool.QueryRow(ctx,
		`INSERT INTO users (nickname, token, device_fp) VALUES ($1,$2,$3) RETURNING id, created_at`,
		nickname, token, deviceFP).Scan(&user.ID, &user.CreatedAt)
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
	return user, nil
}

func (r *Repository) GetUserByNickname(ctx context.Context, nickname string) (*User, error) {
	return r.getUser(ctx,
		`SELECT id, nickname, token, device_fp, abandoned, created_at FROM users WHERE nickname = $1 ORDER BY id LIMIT 1`,
		nickname)
}

func (r *Repository) GetUserByDeviceFP(ctx context.Context, deviceFP string) (*User, error) {
	return r.getUser(ctx,
		`SELECT id, nickname, token, device_fp, abandoned, created_at FROM users WHERE device_fp = $1 AND NOT abandoned ORDER BY id LIMIT 1`,
		deviceFP)
}

func (r *Repository) GetUserByToken(ctx context.Context, token string) (*User, error) {
	return r.getUser(ctx,
		`SELECT id, nickname, token, device_fp, abandoned, created_at FROM users WHERE token = $1`,
		token)
}

func (r *Repository) GetUser(ctx context.Context, id int64) (*User, error) {
	return r.getUser(ctx,
		`SELECT id, nickname, token, device_fp, abandoned, created_at FROM users WHERE id = $1`,
		id)
}

func (r *Repository) AbandonUser(ctx context.Context, userID int64) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE users SET abandoned = TRUE, device_fp = '' WHERE id = $1`, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repository) getUser(ctx context.Context, query string, arg any) (*User, error) {
	user := &User{}
	err := r.pool.QueryRow(ctx, query, arg).Scan(
		&user.ID, &user.Nickname, &user.Token, &user.DeviceFP, &user.Abandoned, &user.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return user, nil
}

func (r *Repository) ListActiveQuestions(ctx context.Context, difficulty string) ([]Question, error) {
	return r.listQuestions(ctx,
		`SELECT id, content, options, answer, score, sort, active, difficulty
		 FROM questions WHERE active AND ($1 = '全部' OR difficulty = $1) ORDER BY sort, id`,
		difficulty)
}

func (r *Repository) AllQuestions(ctx context.Context) ([]Question, error) {
	return r.listQuestions(ctx,
		`SELECT id, content, options, answer, score, sort, active, difficulty FROM questions ORDER BY sort, id`)
}

func (r *Repository) listQuestions(ctx context.Context, query string, args ...any) ([]Question, error) {
	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Question{}
	for rows.Next() {
		var item Question
		var raw []byte
		if err := rows.Scan(
			&item.ID, &item.Content, &raw, &item.Answer, &item.Score,
			&item.Sort, &item.Active, &item.Difficulty,
		); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(raw, &item.Options); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (r *Repository) GetQuestion(ctx context.Context, id int64) (*Question, error) {
	item := &Question{}
	var raw []byte
	err := r.pool.QueryRow(ctx,
		`SELECT id, content, options, answer, score, sort, active, difficulty FROM questions WHERE id = $1`,
		id,
	).Scan(&item.ID, &item.Content, &raw, &item.Answer, &item.Score, &item.Sort, &item.Active, &item.Difficulty)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(raw, &item.Options); err != nil {
		return nil, err
	}
	return item, nil
}

func (r *Repository) CreateQuestion(
	ctx context.Context,
	content string,
	options []string,
	answer, score, sort int,
	difficulty string,
) (*Question, error) {
	raw, _ := json.Marshal(options)
	item := &Question{
		Content: content, Options: options, Answer: answer,
		Score: score, Sort: sort, Difficulty: difficulty,
	}
	err := r.pool.QueryRow(ctx,
		`INSERT INTO questions (content, options, answer, score, sort, difficulty)
		 VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
		content, raw, answer, score, sort, difficulty,
	).Scan(&item.ID)
	if err != nil {
		return nil, err
	}
	return item, nil
}

func (r *Repository) SetQuestionActive(ctx context.Context, id int64, active bool) error {
	tag, err := r.pool.Exec(ctx, `UPDATE questions SET active = $2 WHERE id = $1`, id, active)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

type RecordAttemptResult struct {
	Attempt             *Attempt
	Duplicate           bool
	CurrentQuestionIdx  int
	NextQuestionStarted time.Time
}

func (r *Repository) RecordAttempt(
	ctx context.Context,
	attempt *Attempt,
	questionSeconds, graceSeconds int,
) (*RecordAttemptResult, error) {
	tx, err := r.pool.Begin(ctx)
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
		 FOR UPDATE OF u`, attempt.UserID).
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

	if existing, err := getAttemptByRequest(ctx, tx, attempt.RequestID); err == nil {
		if existing.UserID != attempt.UserID {
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
		attempt.UserID, roundNo, currentIdx,
	).Scan(&expectedQuestionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if expectedQuestionID != attempt.QuestionID {
		return nil, ErrQuestionOrder
	}
	deadline := startedAt.Add(time.Duration(questionSeconds+graceSeconds) * time.Second)
	if time.Now().After(deadline) {
		return nil, ErrQuestionExpired
	}

	attempt.RoundNo = roundNo
	err = tx.QueryRow(ctx,
		`INSERT INTO attempts (user_id, question_id, selected, correct, score, request_id, round_no)
		 VALUES ($1,$2,$3,$4,$5,$6,$7)
		 ON CONFLICT (request_id) DO NOTHING
		 RETURNING id, created_at`,
		attempt.UserID, attempt.QuestionID, attempt.Selected, attempt.Correct,
		attempt.Score, attempt.RequestID, attempt.RoundNo,
	).Scan(&attempt.ID, &attempt.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			existing, lookupErr := getAttemptByRequest(ctx, tx, attempt.RequestID)
			if lookupErr != nil {
				return nil, lookupErr
			}
			if existing.UserID != attempt.UserID {
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
		attempt.UserID, nextIdx, nextStarted,
	); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &RecordAttemptResult{
		Attempt: attempt, CurrentQuestionIdx: nextIdx, NextQuestionStarted: nextStarted,
	}, nil
}

func (r *Repository) GetAttemptByRequest(ctx context.Context, requestID string) (*Attempt, error) {
	return getAttemptByRequest(ctx, r.pool, requestID)
}

type attemptQuerier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func getAttemptByRequest(ctx context.Context, queryer attemptQuerier, requestID string) (*Attempt, error) {
	attempt := &Attempt{}
	var selected int
	err := queryer.QueryRow(ctx,
		`SELECT id, user_id, COALESCE(question_id, 0), COALESCE(selected,-1), correct, score, request_id, round_no, created_at
		 FROM attempts WHERE request_id = $1`, requestID,
	).Scan(
		&attempt.ID, &attempt.UserID, &attempt.QuestionID, &selected,
		&attempt.Correct, &attempt.Score, &attempt.RequestID,
		&attempt.RoundNo, &attempt.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if selected >= 0 {
		attempt.Selected = &selected
	}
	return attempt, nil
}

func (r *Repository) AbandonRound(ctx context.Context, userID int64, roundNo int) (int64, error) {
	tx, err := r.pool.Begin(ctx)
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
		`DELETE FROM round_questions WHERE user_id = $1 AND round_no = $2`, userID, roundNo,
	); err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

func (r *Repository) NextRound(ctx context.Context, userID int64, difficulty string) (int, time.Time, error) {
	var roundNo int
	var startedAt time.Time
	err := r.pool.QueryRow(ctx,
		`UPDATE users
		 SET current_round = current_round + 1,
		     current_question_idx = 0,
		     question_started_at = now(),
		     current_difficulty = $2
		 WHERE id = $1
		 RETURNING current_round, question_started_at`,
		userID, difficulty,
	).Scan(&roundNo, &startedAt)
	return roundNo, startedAt, err
}

func (r *Repository) SaveRoundQuestions(
	ctx context.Context,
	userID int64,
	roundNo int,
	questionIDs []int64,
) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	for index, questionID := range questionIDs {
		if _, err := tx.Exec(ctx,
			`INSERT INTO round_questions (user_id, round_no, position, question_id)
			 VALUES ($1,$2,$3,$4)`,
			userID, roundNo, index, questionID,
		); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (r *Repository) RoundQuestions(
	ctx context.Context,
	userID int64,
	roundNo int,
) ([]Question, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT q.id, q.content, q.options, q.answer, q.score, q.sort, q.active, q.difficulty
		 FROM round_questions rq
		 JOIN questions q ON q.id = rq.question_id
		 WHERE rq.user_id = $1 AND rq.round_no = $2
		 ORDER BY rq.position`, userID, roundNo,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Question{}
	for rows.Next() {
		var item Question
		var raw []byte
		if err := rows.Scan(
			&item.ID, &item.Content, &raw, &item.Answer,
			&item.Score, &item.Sort, &item.Active, &item.Difficulty,
		); err != nil {
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

func (r *Repository) CurrentSubmissionQuestion(ctx context.Context, userID int64) (*SubmissionQuestion, error) {
	state := &SubmissionQuestion{}
	var raw []byte
	err := r.pool.QueryRow(ctx,
		`SELECT qs.state, u.current_round, u.current_question_idx, u.question_started_at,
		        COALESCE(q.id, 0), COALESCE(q.content, ''), COALESCE(q.options, '[]'::jsonb),
		        COALESCE(q.answer, 0), COALESCE(q.score, 0), COALESCE(q.sort, 0),
		        COALESCE(q.active, FALSE), COALESCE(q.difficulty, '')
		 FROM users u
		 CROSS JOIN quiz_state qs
		 LEFT JOIN round_questions rq
		   ON rq.user_id = u.id AND rq.round_no = u.current_round AND rq.position = u.current_question_idx
		 LEFT JOIN questions q ON q.id = rq.question_id
		 WHERE u.id = $1 AND qs.id = 1`, userID,
	).Scan(
		&state.State, &state.RoundNo, &state.CurrentQuestionIdx, &state.QuestionStartedAt,
		&state.Question.ID, &state.Question.Content, &raw, &state.Question.Answer,
		&state.Question.Score, &state.Question.Sort, &state.Question.Active, &state.Question.Difficulty,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(raw, &state.Question.Options); err != nil {
		return nil, err
	}
	return state, nil
}

func (r *Repository) CurrentRoundState(ctx context.Context, userID int64) (*CurrentRoundState, error) {
	state := &CurrentRoundState{}
	err := r.pool.QueryRow(ctx,
		`SELECT current_round, current_question_idx, question_started_at
		 FROM users WHERE id = $1`, userID,
	).Scan(&state.RoundNo, &state.CurrentQuestionIdx, &state.QuestionStartedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return state, nil
}

func (r *Repository) CurrentRoundNo(ctx context.Context, userID int64) (int, error) {
	var roundNo int
	err := r.pool.QueryRow(ctx,
		`SELECT current_round FROM users WHERE id = $1`, userID).Scan(&roundNo)
	return roundNo, err
}

type RoundStats struct {
	Correct int
	Score   int
	Count   int
	First   time.Time
	Last    time.Time
}

func (r *Repository) BestRoundStats(ctx context.Context, userID int64) (*RoundStats, error) {
	stats := &RoundStats{}
	err := r.pool.QueryRow(ctx,
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
		 LIMIT 1`, userID,
	).Scan(&stats.Correct, &stats.Score, &stats.Count, &stats.First, &stats.Last)
	if errors.Is(err, pgx.ErrNoRows) {
		return &RoundStats{}, nil
	}
	if err != nil {
		return nil, err
	}
	return stats, nil
}

func (r *Repository) HasCompletedRound(
	ctx context.Context,
	userID int64,
	minimumQuestions int,
) (bool, error) {
	if minimumQuestions <= 0 {
		minimumQuestions = 1
	}
	var completed bool
	err := r.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM attempts
			WHERE user_id = $1 AND counted
			GROUP BY round_no
			HAVING count(DISTINCT question_id) >= $2
		)`,
		userID, minimumQuestions,
	).Scan(&completed)
	return completed, err
}

func (r *Repository) QuizState(ctx context.Context) (string, error) {
	var state string
	err := r.pool.QueryRow(ctx, `SELECT state FROM quiz_state WHERE id = 1`).Scan(&state)
	if err != nil {
		return "stop", err
	}
	return state, nil
}

func (r *Repository) SetQuizState(ctx context.Context, state string) error {
	_, err := r.pool.Exec(ctx, `UPDATE quiz_state SET state = $1 WHERE id = 1`, state)
	return err
}

func (r *Repository) QuizDifficulty(ctx context.Context) (string, error) {
	var difficulty string
	err := r.pool.QueryRow(ctx, `SELECT difficulty FROM quiz_state WHERE id = 1`).Scan(&difficulty)
	if err != nil {
		return "全部", err
	}
	return difficulty, nil
}

func (r *Repository) SetQuizDifficulty(ctx context.Context, difficulty string) error {
	_, err := r.pool.Exec(ctx, `UPDATE quiz_state SET difficulty = $1 WHERE id = 1`, difficulty)
	return err
}

type LBRow struct {
	UserID    int64
	Nickname  string
	Abandoned bool
	Correct   int
	Score     int
	Count     int
	ElapsedMS int64
}

func (r *Repository) Leaderboard(ctx context.Context) ([]LBRow, int64, error) {
	query := `SELECT u.id, u.nickname, u.abandoned,
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
	rows, err := r.pool.Query(ctx, query)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []LBRow{}
	var total int64
	for rows.Next() {
		var row LBRow
		if err := rows.Scan(
			&row.UserID, &row.Nickname, &row.Abandoned, &row.Correct,
			&row.Score, &row.Count, &row.ElapsedMS, &total,
		); err != nil {
			return nil, 0, err
		}
		out = append(out, row)
	}
	return out, total, rows.Err()
}

func (r *Repository) ListAllUsers(ctx context.Context) ([]User, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, nickname, token, device_fp, abandoned, created_at FROM users ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []User{}
	for rows.Next() {
		var user User
		if err := rows.Scan(
			&user.ID, &user.Nickname, &user.Token, &user.DeviceFP,
			&user.Abandoned, &user.CreatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, user)
	}
	return out, rows.Err()
}

func (r *Repository) RoundCounts(ctx context.Context) (map[int64]int, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT user_id, COUNT(DISTINCT round_no) FROM attempts WHERE counted GROUP BY user_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]int{}
	for rows.Next() {
		var userID int64
		var count int
		if err := rows.Scan(&userID, &count); err != nil {
			return nil, err
		}
		out[userID] = count
	}
	return out, rows.Err()
}

func (r *Repository) CountUsers(ctx context.Context) (int64, error) {
	var count int64
	err := r.pool.QueryRow(ctx, `SELECT COUNT(*) FROM users WHERE NOT abandoned`).Scan(&count)
	return count, err
}

func (r *Repository) CountQuestions(ctx context.Context) (int64, error) {
	var count int64
	err := r.pool.QueryRow(ctx, `SELECT COUNT(*) FROM questions WHERE active`).Scan(&count)
	return count, err
}

func (r *Repository) ClearQuestions(ctx context.Context) (int64, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `DELETE FROM questions`)
	if err != nil {
		return 0, err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO app_meta (k, v) VALUES ('skip_seed', '1')
		 ON CONFLICT (k) DO UPDATE SET v = '1'`); err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

func (r *Repository) SeedSkipped(ctx context.Context) bool {
	var value string
	if err := r.pool.QueryRow(ctx,
		`SELECT v FROM app_meta WHERE k = 'skip_seed'`,
	).Scan(&value); err != nil {
		return false
	}
	return value == "1"
}

func (r *Repository) CountAttempts(ctx context.Context) (int64, error) {
	var count int64
	err := r.pool.QueryRow(ctx, `SELECT COUNT(*) FROM attempts WHERE counted`).Scan(&count)
	return count, err
}

func (r *Repository) CountAnsweredUsers(ctx context.Context) (int64, error) {
	var count int64
	err := r.pool.QueryRow(ctx,
		`SELECT COUNT(DISTINCT user_id) FROM attempts WHERE counted`,
	).Scan(&count)
	return count, err
}
