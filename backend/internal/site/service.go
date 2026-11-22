package site

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	FeatureQuiz    = "quiz"
	FeatureLottery = "lottery"
	FeatureJoin    = "join"
	FeatureScreen  = "screen"
)

var allowedFeatures = map[string]bool{
	FeatureQuiz: true, FeatureLottery: true, FeatureJoin: true, FeatureScreen: true,
}

var allowedKinds = map[string]bool{
	"hero": true, "about": true, "activities": true, "quiz": true,
	"lottery": true, "join": true, "gallery": true,
}

type Service struct {
	pool         *pgxpool.Pool
	defaultTitle string
}

type Brand struct {
	Name        string `json:"name"`
	ShortName   string `json:"short_name"`
	Description string `json:"description"`
	Title       string `json:"title"`
	LogoURL     string `json:"logo_url"`
}

type NavItem struct {
	Label string `json:"label"`
	To    string `json:"to"`
}

type FooterLink struct {
	Label string `json:"label"`
	Href  string `json:"href"`
}

type Footer struct {
	Owner      string       `json:"owner"`
	License    string       `json:"license"`
	ICP        string       `json:"icp"`
	ICPIcon    string       `json:"icp_icon"`
	Police     string       `json:"police"`
	PoliceIcon string       `json:"police_icon"`
	Links      []FooterLink `json:"links"`
}

type Feature struct {
	Key     string          `json:"key"`
	Enabled bool            `json:"enabled"`
	Config  json.RawMessage `json:"config"`
}

type Section struct {
	ID        int64           `json:"id"`
	Kind      string          `json:"kind"`
	Enabled   bool            `json:"enabled"`
	Sort      int             `json:"sort"`
	StartsAt  *time.Time      `json:"starts_at,omitempty"`
	EndsAt    *time.Time      `json:"ends_at,omitempty"`
	Config    json.RawMessage `json:"config"`
	Status    string          `json:"status"`
	UpdatedAt time.Time       `json:"updated_at"`
}

type Background struct {
	ID   int64  `json:"id"`
	Path string `json:"path"`
}

type Qrcode struct {
	ID       int64  `json:"id"`
	Title    string `json:"title"`
	ImageURL string `json:"image_url"`
}

type Page struct {
	Slug        string          `json:"slug"`
	Title       string          `json:"title"`
	Summary     string          `json:"summary"`
	Body        string          `json:"body"`
	SEO         json.RawMessage `json:"seo"`
	PublishedAt *time.Time      `json:"published_at,omitempty"`
}

type Public struct {
	Brand       Brand        `json:"brand"`
	Nav         []NavItem    `json:"nav"`
	Footer      Footer       `json:"footer"`
	Features    []Feature    `json:"features"`
	Sections    []Section    `json:"sections"`
	Backgrounds []Background `json:"backgrounds"`
	Qrcodes     []Qrcode     `json:"qrcodes"`
}

type FeatureUpdate struct {
	Key     string          `json:"key"`
	Enabled bool            `json:"enabled"`
	Config  json.RawMessage `json:"config"`
}

type SectionUpdate struct {
	ID       int64           `json:"id"`
	Kind     string          `json:"kind"`
	Enabled  bool            `json:"enabled"`
	Sort     int             `json:"sort"`
	StartsAt *time.Time      `json:"starts_at"`
	EndsAt   *time.Time      `json:"ends_at"`
	Config   json.RawMessage `json:"config"`
	Status   string          `json:"status"`
}

func New(pool *pgxpool.Pool, defaultTitle string) *Service {
	return &Service{pool: pool, defaultTitle: defaultTitle}
}

func (s *Service) Public(ctx context.Context) (*Public, error) {
	features, err := s.Features(ctx)
	if err != nil {
		return nil, err
	}
	enabled := make(map[string]bool, len(features))
	for _, feature := range features {
		enabled[feature.Key] = feature.Enabled
	}

	sections, err := s.publicSections(ctx)
	if err != nil {
		return nil, err
	}
	backgrounds, err := s.Backgrounds(ctx)
	if err != nil {
		return nil, err
	}
	qrcodes, err := s.Qrcodes(ctx)
	if err != nil {
		return nil, err
	}

	logo, footer, err := s.branding(ctx)
	if err != nil {
		return nil, err
	}
	footer.Links = publicFooterLinks(enabled)
	title := s.defaultTitle
	if title == "" {
		title = "计算机协会 · 官网"
	}

	return &Public{
		Brand: Brand{
			Name:        "计算机协会",
			ShortName:   "szyca",
			Description: "汕头职业技术学院计算机协会：学习、协作与创造。",
			Title:       title,
			LogoURL:     logo,
		},
		Nav:         publicNav(enabled),
		Footer:      footer,
		Features:    features,
		Sections:    sections,
		Backgrounds: backgrounds,
		Qrcodes:     qrcodes,
	}, nil
}

func (s *Service) Features(ctx context.Context) ([]Feature, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT key, enabled, config FROM feature_flags ORDER BY key`)
	if err != nil {
		return nil, fmt.Errorf("list feature flags: %w", err)
	}
	defer rows.Close()
	out := make([]Feature, 0, 4)
	for rows.Next() {
		var feature Feature
		if err := rows.Scan(&feature.Key, &feature.Enabled, &feature.Config); err != nil {
			return nil, fmt.Errorf("scan feature flag: %w", err)
		}
		out = append(out, feature)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate feature flags: %w", err)
	}
	return out, nil
}

func (s *Service) FeatureEnabled(ctx context.Context, key string) (bool, error) {
	var enabled bool
	err := s.pool.QueryRow(ctx,
		`SELECT enabled FROM feature_flags WHERE key = $1`, key).Scan(&enabled)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("read feature flag %s: %w", key, err)
	}
	return enabled, nil
}

func (s *Service) UpdateFeatures(ctx context.Context, actorID int64, updates []FeatureUpdate) error {
	if len(updates) == 0 {
		return errors.New("至少需要一个功能开关")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	for _, update := range updates {
		if !allowedFeatures[update.Key] {
			return fmt.Errorf("不支持的模块开关：%s", update.Key)
		}
		config, err := validateJSONObject(update.Config, 8<<10)
		if err != nil {
			return fmt.Errorf("%s 配置无效：%w", update.Key, err)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO feature_flags (key, enabled, config, updated_by, updated_at)
			VALUES ($1, $2, $3, NULLIF($4, 0), now())
			ON CONFLICT (key) DO UPDATE
			SET enabled = EXCLUDED.enabled,
			    config = EXCLUDED.config,
			    updated_by = EXCLUDED.updated_by,
			    updated_at = now()`,
			update.Key, update.Enabled, config, actorID,
		); err != nil {
			return fmt.Errorf("update feature %s: %w", update.Key, err)
		}
	}
	return tx.Commit(ctx)
}

func (s *Service) AdminSections(ctx context.Context) ([]Section, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, kind, enabled, sort, starts_at, ends_at, config, status, updated_at
		FROM home_sections
		ORDER BY sort, id`)
	if err != nil {
		return nil, fmt.Errorf("list home sections: %w", err)
	}
	defer rows.Close()

	out := []Section{}
	for rows.Next() {
		section, err := scanSection(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, section)
	}
	return out, rows.Err()
}

func (s *Service) UpdateSections(ctx context.Context, actorID int64, updates []SectionUpdate) error {
	if len(updates) == 0 {
		return errors.New("至少需要一个首页 Section")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	for _, update := range updates {
		if !allowedKinds[update.Kind] {
			return fmt.Errorf("不支持的 Section 类型：%s", update.Kind)
		}
		if update.Status != "draft" && update.Status != "published" && update.Status != "archived" {
			return fmt.Errorf("Section 状态无效：%s", update.Status)
		}
		if update.StartsAt != nil && update.EndsAt != nil && !update.EndsAt.After(*update.StartsAt) {
			return errors.New("Section 结束时间必须晚于开始时间")
		}
		config, err := validateSectionConfig(update.Config)
		if err != nil {
			return fmt.Errorf("%s Section 配置无效：%w", update.Kind, err)
		}

		if update.ID == 0 {
			if _, err := tx.Exec(ctx, `
				INSERT INTO home_sections
					(kind, enabled, sort, starts_at, ends_at, config, status, updated_by, updated_at)
				VALUES ($1, $2, $3, $4, $5, $6, $7, NULLIF($8, 0), now())`,
				update.Kind, update.Enabled, update.Sort, update.StartsAt, update.EndsAt,
				config, update.Status, actorID,
			); err != nil {
				return fmt.Errorf("create section %s: %w", update.Kind, err)
			}
			continue
		}
		tag, err := tx.Exec(ctx, `
			UPDATE home_sections
			SET kind = $2, enabled = $3, sort = $4, starts_at = $5, ends_at = $6,
			    config = $7, status = $8, updated_by = NULLIF($9, 0), updated_at = now()
			WHERE id = $1`,
			update.ID, update.Kind, update.Enabled, update.Sort, update.StartsAt, update.EndsAt,
			config, update.Status, actorID,
		)
		if err != nil {
			return fmt.Errorf("update section %d: %w", update.ID, err)
		}
		if tag.RowsAffected() == 0 {
			return fmt.Errorf("section %d 不存在", update.ID)
		}
	}
	return tx.Commit(ctx)
}

func (s *Service) Backgrounds(ctx context.Context) ([]Background, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, file_path FROM backgrounds WHERE active ORDER BY created_at DESC, id DESC`)
	if err != nil {
		return nil, fmt.Errorf("list backgrounds: %w", err)
	}
	defer rows.Close()
	out := []Background{}
	for rows.Next() {
		var background Background
		if err := rows.Scan(&background.ID, &background.Path); err != nil {
			return nil, fmt.Errorf("scan background: %w", err)
		}
		out = append(out, background)
	}
	return out, rows.Err()
}

func (s *Service) Qrcodes(ctx context.Context) ([]Qrcode, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, title, image_url FROM qrcodes WHERE active ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("list qrcodes: %w", err)
	}
	defer rows.Close()
	out := []Qrcode{}
	for rows.Next() {
		var qrcode Qrcode
		if err := rows.Scan(&qrcode.ID, &qrcode.Title, &qrcode.ImageURL); err != nil {
			return nil, fmt.Errorf("scan qrcode: %w", err)
		}
		out = append(out, qrcode)
	}
	return out, rows.Err()
}

func (s *Service) Page(ctx context.Context, slug string) (*Page, error) {
	var page Page
	err := s.pool.QueryRow(ctx, `
		SELECT slug, title, summary, body, seo, published_at
		FROM site_pages
		WHERE slug = $1 AND status = 'published'
		  AND (published_at IS NULL OR published_at <= now())`,
		slug,
	).Scan(
		&page.Slug, &page.Title, &page.Summary, &page.Body, &page.SEO, &page.PublishedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &page, nil
}

func (s *Service) publicSections(ctx context.Context) ([]Section, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, kind, enabled, sort, starts_at, ends_at, config, status, updated_at
		FROM home_sections
		WHERE status = 'published'
		  AND enabled
		  AND (starts_at IS NULL OR starts_at <= now())
		  AND (ends_at IS NULL OR ends_at > now())
		ORDER BY sort, id`)
	if err != nil {
		return nil, fmt.Errorf("list public home sections: %w", err)
	}
	defer rows.Close()

	out := []Section{}
	for rows.Next() {
		section, err := scanSection(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, section)
	}
	return out, rows.Err()
}

type sectionScanner interface {
	Scan(...any) error
}

func scanSection(row sectionScanner) (Section, error) {
	var section Section
	if err := row.Scan(
		&section.ID,
		&section.Kind,
		&section.Enabled,
		&section.Sort,
		&section.StartsAt,
		&section.EndsAt,
		&section.Config,
		&section.Status,
		&section.UpdatedAt,
	); err != nil {
		return Section{}, fmt.Errorf("scan home section: %w", err)
	}
	return section, nil
}

func (s *Service) branding(ctx context.Context) (string, Footer, error) {
	var logo string
	var footer Footer
	err := s.pool.QueryRow(ctx, `
		SELECT
			COALESCE((SELECT logo_url FROM site_settings WHERE id = 1), ''),
			COALESCE((SELECT owner FROM footer_settings WHERE id = 1), ''),
			COALESCE((SELECT license FROM footer_settings WHERE id = 1), ''),
			COALESCE((SELECT icp FROM footer_settings WHERE id = 1), ''),
			COALESCE((SELECT icp_icon FROM footer_settings WHERE id = 1), ''),
			COALESCE((SELECT police FROM footer_settings WHERE id = 1), ''),
			COALESCE((SELECT police_icon FROM footer_settings WHERE id = 1), '')
	`).Scan(
		&logo,
		&footer.Owner,
		&footer.License,
		&footer.ICP,
		&footer.ICPIcon,
		&footer.Police,
		&footer.PoliceIcon,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", footer, nil
	}
	if err != nil {
		return "", footer, fmt.Errorf("read branding: %w", err)
	}
	if footer.Owner == "" {
		footer.Owner = "计算机协会 · 汕头职业技术学院"
	}
	return logo, footer, nil
}

func publicNav(enabled map[string]bool) []NavItem {
	items := []NavItem{{Label: "首页", To: "/"}}
	if enabled[FeatureJoin] {
		items = append(items, NavItem{Label: "加入我们", To: "/join"})
	}
	if enabled[FeatureQuiz] {
		items = append(items, NavItem{Label: "答题", To: "/quiz"})
	}
	if enabled[FeatureLottery] {
		items = append(items, NavItem{Label: "抽奖", To: "/lottery"})
	}
	if enabled[FeatureScreen] {
		items = append(items, NavItem{Label: "排行榜", To: "/screen"})
	}
	return items
}

func publicFooterLinks(enabled map[string]bool) []FooterLink {
	links := []FooterLink{{Label: "关于协会", Href: "/#about"}}
	if enabled[FeatureJoin] {
		links = append(links, FooterLink{Label: "加入我们", Href: "/join"})
	}
	if enabled[FeatureQuiz] {
		links = append(links, FooterLink{Label: "答题", Href: "/quiz"})
	}
	if enabled[FeatureScreen] {
		links = append(links, FooterLink{Label: "排行榜", Href: "/screen"})
	}
	return links
}

func validateJSONObject(raw json.RawMessage, maxBytes int) (json.RawMessage, error) {
	if len(raw) == 0 {
		return json.RawMessage(`{}`), nil
	}
	if len(raw) > maxBytes {
		return nil, errors.New("配置过大")
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, errors.New("必须是 JSON 对象")
	}
	if containsHTML(value) {
		return nil, errors.New("配置只接受纯文本，不允许 HTML")
	}
	return raw, nil
}

func validateSectionConfig(raw json.RawMessage) (json.RawMessage, error) {
	normalized, err := validateJSONObject(raw, 16<<10)
	if err != nil {
		return nil, err
	}
	var config map[string]any
	if err := json.Unmarshal(normalized, &config); err != nil {
		return nil, err
	}
	allowed := map[string]bool{
		"eyebrow": true, "title": true, "subtitle": true, "body": true,
		"primary_label": true, "primary_to": true,
		"secondary_label": true, "secondary_to": true,
		"action_label": true, "action_to": true, "items": true,
	}
	for key, value := range config {
		if !allowed[key] {
			return nil, fmt.Errorf("未知字段 %s", key)
		}
		switch key {
		case "items":
			items, ok := value.([]any)
			if !ok || len(items) > 8 {
				return nil, errors.New("items 必须是最多 8 项的数组")
			}
			for _, item := range items {
				object, ok := item.(map[string]any)
				if !ok {
					return nil, errors.New("items 每项必须是对象")
				}
				for itemKey, itemValue := range object {
					if itemKey != "title" && itemKey != "body" && itemKey != "image_url" {
						return nil, fmt.Errorf("items 包含未知字段 %s", itemKey)
					}
					text, ok := itemValue.(string)
					if !ok || len([]rune(text)) > 500 {
						return nil, errors.New("items 文本字段无效")
					}
				}
			}
		default:
			text, ok := value.(string)
			if !ok || len([]rune(text)) > 1000 {
				return nil, fmt.Errorf("%s 必须是文本", key)
			}
			if strings.HasSuffix(key, "_to") && text != "" &&
				(!strings.HasPrefix(text, "/") || strings.Contains(text, ":")) {
				return nil, fmt.Errorf("%s 必须是站内路径", key)
			}
		}
	}
	return normalized, nil
}

func containsHTML(value any) bool {
	switch typed := value.(type) {
	case string:
		lower := strings.ToLower(typed)
		return strings.ContainsAny(typed, "<>") || strings.Contains(lower, "javascript:")
	case []any:
		for _, item := range typed {
			if containsHTML(item) {
				return true
			}
		}
	case map[string]any:
		for _, item := range typed {
			if containsHTML(item) {
				return true
			}
		}
	}
	return false
}

func SectionPath(section Section) string {
	var config map[string]any
	_ = json.Unmarshal(section.Config, &config)
	if value, ok := config["action_to"].(string); ok {
		return value
	}
	return ""
}

func ParseID(value string) (int64, error) {
	id, err := strconv.ParseInt(value, 10, 64)
	if err != nil || id <= 0 {
		return 0, errors.New("资源 ID 无效")
	}
	return id, nil
}
