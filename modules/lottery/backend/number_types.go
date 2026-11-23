package lottery

import (
	"errors"
	"time"
)

var (
	ErrNumberInvalid        = errors.New("号码抽奖配置无效")
	ErrNumberEventNotFound  = errors.New("号码抽奖场次不存在")
	ErrNumberEventNotDraft  = errors.New("只有草稿场次可以编辑")
	ErrNumberEventNotLive   = errors.New("号码抽奖场次尚未上线")
	ErrNumberLiveExists     = errors.New("已有上线中的号码抽奖场次")
	ErrNumberDrawComplete   = errors.New("当前场次所有等级均已开奖")
	ErrNumberDrawOutOfOrder = errors.New(
		"只能按顺序开奖下一个待开等级",
	)
	ErrNumberLevelDrawn  = errors.New("该等级已经开奖")
	ErrNumberDrawRequest = errors.New("开奖请求冲突")
)

const (
	maxNumberRange        int64 = 9_000_000_000_000_000
	maxNumberWinners            = 100
	maxNumberLevels             = 20
	maxNumberLevelNameLen       = 40
	maxNumberEventNameLen       = 80
)

type NumberModeSettings struct {
	ScreenEnabled   bool      `json:"screen_enabled"`
	PersonalEnabled bool      `json:"personal_enabled"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type NumberLevelInput struct {
	Name        string `json:"name"`
	WinnerCount int    `json:"winner_count"`
}

type NumberEventInput struct {
	ID          int64              `json:"id"`
	Name        string             `json:"name"`
	RangeStart  string             `json:"range_start"`
	RangeEnd    string             `json:"range_end"`
	NumberWidth int                `json:"number_width"`
	Levels      []NumberLevelInput `json:"levels"`
}

type NumberEventView struct {
	ID          int64      `json:"id"`
	Name        string     `json:"name"`
	Status      string     `json:"status"`
	RangeStart  string     `json:"range_start"`
	RangeEnd    string     `json:"range_end"`
	NumberWidth int        `json:"number_width"`
	Revision    int64      `json:"revision"`
	Completed   bool       `json:"completed"`
	PublishedAt *time.Time `json:"published_at,omitempty"`
	ArchivedAt  *time.Time `json:"archived_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

type NumberLevelView struct {
	ID          int64      `json:"id"`
	Name        string     `json:"name"`
	WinnerCount int        `json:"winner_count"`
	Sort        int        `json:"sort"`
	State       string     `json:"state"`
	DrawnAt     *time.Time `json:"drawn_at,omitempty"`
	Operator    string     `json:"operator,omitempty"`
	Winners     []string   `json:"winners"`
}

type NumberBoard struct {
	Enabled bool              `json:"enabled"`
	Event   *NumberEventView  `json:"event"`
	Levels  []NumberLevelView `json:"levels"`
}

type NumberEventDetail struct {
	Event  NumberEventView   `json:"event"`
	Levels []NumberLevelView `json:"levels"`
}

type NumberEventSummary struct {
	NumberEventView
	LevelCount     int `json:"level_count"`
	PlannedWinners int `json:"planned_winners"`
	DrawnLevels    int `json:"drawn_levels"`
	DrawnWinners   int `json:"drawn_winners"`
}

type NumberDrawInput struct {
	LevelID   int64  `json:"level_id"`
	RequestID string `json:"request_id"`
}

type NumberDrawResult struct {
	EventID   int64     `json:"event_id"`
	LevelID   int64     `json:"level_id"`
	LevelName string    `json:"level_name"`
	Winners   []string  `json:"winners"`
	DrawnAt   time.Time `json:"drawn_at"`
	Duplicate bool      `json:"duplicate,omitempty"`
}

type NumberExportRow struct {
	Event    string
	Level    string
	Number   string
	DrawnAt  time.Time
	Operator string
}

type normalizedNumberEvent struct {
	name        string
	rangeStart  int64
	rangeEnd    int64
	numberWidth int
	levels      []NumberLevelInput
}
