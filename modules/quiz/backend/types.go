package quiz

import (
	"errors"
	"time"
)

var (
	ErrNotFound             = errors.New("not found")
	ErrNicknameTaken        = errors.New("nickname already exists")
	ErrDeviceTaken          = errors.New("device already bound")
	ErrQuestionAlreadyTaken = errors.New("question already answered")
	ErrRequestConflict      = errors.New("request id belongs to another user")
	ErrQuizStopped          = errors.New("quiz not started")
)

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
