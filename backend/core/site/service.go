package site

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"szyca/backend/contract"
	"szyca/backend/core/modulecatalog"
)

const (
	FeatureQuiz    = "quiz"
	FeatureLottery = "lottery"
	FeatureJoin    = "join"
	FeatureScreen  = "screen"
)

var allowedFeatures = func() map[string]bool {
	out := make(map[string]bool)
	for _, key := range modulecatalog.FeatureKeys() {
		out[key] = true
	}
	return out
}()

type Service struct {
	pool           *pgxpool.Pool
	defaultTitle   string
	sectionPlugins *sectionPluginRegistry
	gallery        GalleryProvider
	qrcodes        QrcodeProvider
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
	ID            int64           `json:"id"`
	Kind          string          `json:"kind"`
	PluginVersion int             `json:"plugin_version"`
	Enabled       bool            `json:"enabled"`
	Sort          int             `json:"sort"`
	StartsAt      *time.Time      `json:"starts_at,omitempty"`
	EndsAt        *time.Time      `json:"ends_at,omitempty"`
	Config        json.RawMessage `json:"config"`
	Gallery       []GalleryImage  `json:"gallery,omitempty"`
	Status        string          `json:"status"`
	UpdatedAt     time.Time       `json:"updated_at"`
}

type Background struct {
	ID   int64  `json:"id"`
	Path string `json:"path"`
}

type Qrcode = contract.Qrcode

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
	ID            int64           `json:"id"`
	Kind          string          `json:"kind"`
	PluginVersion int             `json:"plugin_version"`
	Enabled       bool            `json:"enabled"`
	Sort          int             `json:"sort"`
	StartsAt      *time.Time      `json:"starts_at"`
	EndsAt        *time.Time      `json:"ends_at"`
	Config        json.RawMessage `json:"config"`
	Status        string          `json:"status"`
}

func New(pool *pgxpool.Pool, defaultTitle string) *Service {
	service, err := NewWithSectionPlugins(pool, defaultTitle, builtinSectionPlugins())
	if err != nil {
		panic(fmt.Sprintf("register built-in section plugins: %v", err))
	}
	return service
}

func NewWithGallery(pool *pgxpool.Pool, defaultTitle string, gallery GalleryProvider) *Service {
	return NewWithProviders(pool, defaultTitle, gallery, nil)
}

func NewWithProviders(
	pool *pgxpool.Pool,
	defaultTitle string,
	gallery GalleryProvider,
	qrcodes QrcodeProvider,
) *Service {
	service := New(pool, defaultTitle)
	service.gallery = gallery
	service.qrcodes = qrcodes
	return service
}

// NewWithSectionPlugins is the composition point for compile-time plugins.
// Runtime plugins should stay out of this process and use a sandboxed adapter.
func NewWithSectionPlugins(
	pool *pgxpool.Pool,
	defaultTitle string,
	plugins []SectionPluginManifest,
) (*Service, error) {
	registry, err := newSectionPluginRegistry(plugins...)
	if err != nil {
		return nil, err
	}
	return &Service{
		pool:           pool,
		defaultTitle:   defaultTitle,
		sectionPlugins: registry,
	}, nil
}

func (s *Service) SectionPlugins() []SectionPluginManifest {
	return s.sectionPlugins.List()
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
	sections = s.filterPublicSections(sections, enabled)
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

func (s *Service) filterPublicSections(sections []Section, enabled map[string]bool) []Section {
	filteredSections := sections[:0]
	for _, section := range sections {
		plugin, ok := s.sectionPlugins.Get(section.Kind)
		if !ok || plugin.Version != section.PluginVersion {
			continue
		}
		if plugin.Feature != "" && !enabled[plugin.Feature] {
			continue
		}
		filteredSections = append(filteredSections, section)
	}
	return filteredSections
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
		if !modulecatalog.FeatureAllowed(feature.Key) {
			continue
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
	sections, err := listSections(ctx, s.pool)
	if err != nil {
		return nil, err
	}
	if err := attachGalleryImages(ctx, s.gallery, sections); err != nil {
		return nil, err
	}
	return sections, nil
}

func (s *Service) UpdateSections(
	ctx context.Context,
	actorID int64,
	updates []SectionUpdate,
	deletedIDs []int64,
) ([]Section, error) {
	normalizedDeletes, err := normalizeSectionDeletes(deletedIDs)
	if err != nil {
		return nil, err
	}
	if len(updates) == 0 && len(normalizedDeletes) == 0 {
		return nil, errors.New("至少需要一个首页 Section 修改")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `LOCK TABLE home_sections IN SHARE ROW EXCLUSIVE MODE`); err != nil {
		return nil, fmt.Errorf("lock home sections: %w", err)
	}
	existingKinds, err := listSectionKinds(ctx, tx)
	if err != nil {
		return nil, err
	}
	normalizedUpdates := append([]SectionUpdate(nil), updates...)
	for index := range normalizedUpdates {
		if err := normalizeSectionUpdate(&normalizedUpdates[index], s.sectionPlugins); err != nil {
			return nil, err
		}
	}
	if err := validateSectionMutations(
		normalizedUpdates, normalizedDeletes, existingKinds, s.sectionPlugins,
	); err != nil {
		return nil, err
	}

	if len(normalizedDeletes) > 0 {
		tag, err := tx.Exec(ctx, `DELETE FROM home_sections WHERE id = ANY($1::bigint[])`, normalizedDeletes)
		if err != nil {
			return nil, fmt.Errorf("delete home sections: %w", err)
		}
		if tag.RowsAffected() != int64(len(normalizedDeletes)) {
			return nil, errors.New("待删除的 Section 已发生变化，请刷新后重试")
		}
	}

	for _, update := range normalizedUpdates {
		if update.ID == 0 {
			if _, err := tx.Exec(ctx, `
				INSERT INTO home_sections
					(kind, plugin_version, enabled, sort, starts_at, ends_at, config, status, updated_by, updated_at)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULLIF($9, 0), now())`,
				update.Kind, update.PluginVersion, update.Enabled, update.Sort,
				update.StartsAt, update.EndsAt, update.Config, update.Status, actorID,
			); err != nil {
				return nil, fmt.Errorf("create section %s: %w", update.Kind, err)
			}
			continue
		}
		tag, err := tx.Exec(ctx, `
			UPDATE home_sections
			SET kind = $2, plugin_version = $3, enabled = $4, sort = $5,
			    starts_at = $6, ends_at = $7, config = $8, status = $9,
			    updated_by = NULLIF($10, 0), updated_at = now()
			WHERE id = $1`,
			update.ID, update.Kind, update.PluginVersion, update.Enabled, update.Sort,
			update.StartsAt, update.EndsAt, update.Config, update.Status, actorID,
		)
		if err != nil {
			return nil, fmt.Errorf("update section %d: %w", update.ID, err)
		}
		if tag.RowsAffected() == 0 {
			return nil, fmt.Errorf("section %d 不存在", update.ID)
		}
	}
	sections, err := listSections(ctx, tx)
	if err != nil {
		return nil, err
	}
	if err := attachGalleryImages(ctx, s.gallery, sections); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return sections, nil
}

func normalizeSectionUpdate(update *SectionUpdate, registry *sectionPluginRegistry) error {
	plugin, ok := registry.Get(update.Kind)
	if !ok {
		return fmt.Errorf("不支持的 Section 插件：%s", update.Kind)
	}
	if update.PluginVersion == 0 {
		update.PluginVersion = plugin.Version
	}
	if update.PluginVersion != plugin.Version {
		return fmt.Errorf(
			"Section 插件 %s 版本 %d 不受支持，当前版本 %d",
			update.Kind, update.PluginVersion, plugin.Version,
		)
	}
	if update.Status != "draft" && update.Status != "published" && update.Status != "archived" {
		return fmt.Errorf("Section 状态无效：%s", update.Status)
	}
	if update.StartsAt != nil && update.EndsAt != nil && !update.EndsAt.After(*update.StartsAt) {
		return errors.New("Section 结束时间必须晚于开始时间")
	}
	config, err := registry.NormalizeConfig(update.Kind, update.Config)
	if err != nil {
		return fmt.Errorf("%s Section 配置无效：%w", update.Kind, err)
	}
	update.Config = config
	return nil
}

func normalizeSectionDeletes(ids []int64) ([]int64, error) {
	seen := make(map[int64]bool, len(ids))
	out := make([]int64, 0, len(ids))
	for _, id := range ids {
		if id <= 0 {
			return nil, errors.New("待删除的 Section ID 无效")
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out, nil
}

func validateSectionMutations(
	updates []SectionUpdate,
	deletedIDs []int64,
	existingKinds map[int64]string,
	registry *sectionPluginRegistry,
) error {
	deleted := make(map[int64]bool, len(deletedIDs))
	for _, id := range deletedIDs {
		if _, ok := existingKinds[id]; !ok {
			return fmt.Errorf("section %d 不存在，请刷新后重试", id)
		}
		deleted[id] = true
	}

	finalKindsByID := make(map[int64]string, len(existingKinds)+len(updates))
	for id, kind := range existingKinds {
		if deleted[id] {
			continue
		}
		finalKindsByID[id] = kind
	}

	updated := make(map[int64]bool, len(updates))
	for index, update := range updates {
		if update.ID < 0 {
			return errors.New("Section ID 无效")
		}
		if update.ID > 0 {
			if deleted[update.ID] {
				return fmt.Errorf("section %d 不能同时更新和删除", update.ID)
			}
			if updated[update.ID] {
				return fmt.Errorf("section %d 重复提交", update.ID)
			}
			if _, ok := existingKinds[update.ID]; !ok {
				return fmt.Errorf("section %d 不存在，请刷新后重试", update.ID)
			}
			if existingKinds[update.ID] != update.Kind {
				return fmt.Errorf("section %d 的插件类型不可修改，请删除后新增", update.ID)
			}
			updated[update.ID] = true
			finalKindsByID[update.ID] = update.Kind
		} else {
			finalKindsByID[-int64(index+1)] = update.Kind
		}
	}

	instanceCounts := make(map[string]int, len(finalKindsByID))
	for _, kind := range finalKindsByID {
		instanceCounts[kind]++
	}
	for kind, count := range instanceCounts {
		plugin, ok := registry.Get(kind)
		if !ok {
			// Preserve data from a plugin that is not installed in this build.
			// It remains readable in the database but cannot be edited until
			// its plugin is registered again.
			continue
		}
		if !plugin.Repeatable && count > 1 {
			return fmt.Errorf("Section 插件 %s 不允许重复实例", kind)
		}
		if plugin.MaxInstances > 0 && count > plugin.MaxInstances {
			return fmt.Errorf(
				"Section 插件 %s 最多允许 %d 个实例",
				kind, plugin.MaxInstances,
			)
		}
	}
	return nil
}

func listSectionKinds(ctx context.Context, tx pgx.Tx) (map[int64]string, error) {
	rows, err := tx.Query(ctx, `SELECT id, kind FROM home_sections ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("list home section kinds: %w", err)
	}
	defer rows.Close()

	out := make(map[int64]string)
	for rows.Next() {
		var id int64
		var kind string
		if err := rows.Scan(&id, &kind); err != nil {
			return nil, fmt.Errorf("scan home section kind: %w", err)
		}
		out[id] = kind
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate home section kinds: %w", err)
	}
	return out, nil
}

type sectionQuerier interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

func listSections(ctx context.Context, queryer sectionQuerier) ([]Section, error) {
	rows, err := queryer.Query(ctx, `
		SELECT id, kind, plugin_version, enabled, sort, starts_at, ends_at, config, status, updated_at
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
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, fmt.Errorf("iterate home sections: %w", err)
	}
	return out, nil
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
	if s.qrcodes == nil {
		return []Qrcode{}, nil
	}
	return s.qrcodes.Qrcodes(ctx)
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
		SELECT id, kind, plugin_version, enabled, sort, starts_at, ends_at, config, status, updated_at
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
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	if err := attachGalleryImages(ctx, s.gallery, out); err != nil {
		return nil, err
	}
	return out, nil
}

type sectionScanner interface {
	Scan(...any) error
}

func scanSection(row sectionScanner) (Section, error) {
	var section Section
	if err := row.Scan(
		&section.ID,
		&section.Kind,
		&section.PluginVersion,
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
	manifests := modulecatalog.All()
	sort.SliceStable(manifests, func(i, j int) bool {
		return manifests[i].NavOrder < manifests[j].NavOrder
	})
	for _, manifest := range manifests {
		if manifest.NavLabel == "" || !enabled[manifest.Feature] {
			continue
		}
		items = append(items, NavItem{Label: manifest.NavLabel, To: manifest.Path})
	}
	return items
}

func publicFooterLinks(enabled map[string]bool) []FooterLink {
	links := []FooterLink{{Label: "关于协会", Href: "/#about"}}
	manifests := modulecatalog.All()
	sort.SliceStable(manifests, func(i, j int) bool {
		return manifests[i].NavOrder < manifests[j].NavOrder
	})
	for _, manifest := range manifests {
		if manifest.FooterLabel == "" || !enabled[manifest.Feature] {
			continue
		}
		links = append(links, FooterLink{Label: manifest.FooterLabel, Href: manifest.Path})
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
