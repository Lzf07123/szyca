package site

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type AdminBackground struct {
	ID        int64     `json:"id"`
	FilePath  string    `json:"file_path"`
	Active    bool      `json:"active"`
	CreatedAt time.Time `json:"created_at"`
}

type AdminPage struct {
	Slug        string     `json:"slug"`
	Title       string     `json:"title"`
	Summary     string     `json:"summary"`
	Body        string     `json:"body"`
	Status      string     `json:"status"`
	PublishedAt *time.Time `json:"published_at,omitempty"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

type PageUpdate struct {
	Title   string `json:"title"`
	Summary string `json:"summary"`
	Body    string `json:"body"`
	Status  string `json:"status"`
}

func (s *Service) Footer(ctx context.Context) (*Footer, error) {
	footer := &Footer{}
	err := s.pool.QueryRow(ctx, `
		SELECT
			COALESCE((SELECT owner FROM footer_settings WHERE id = 1), ''),
			COALESCE((SELECT license FROM footer_settings WHERE id = 1), ''),
			COALESCE((SELECT icp FROM footer_settings WHERE id = 1), ''),
			COALESCE((SELECT icp_icon FROM footer_settings WHERE id = 1), ''),
			COALESCE((SELECT police FROM footer_settings WHERE id = 1), ''),
			COALESCE((SELECT police_icon FROM footer_settings WHERE id = 1), '')
	`).Scan(
		&footer.Owner, &footer.License, &footer.ICP,
		&footer.ICPIcon, &footer.Police, &footer.PoliceIcon,
	)
	if err != nil {
		return nil, fmt.Errorf("read footer: %w", err)
	}
	return footer, nil
}

func (s *Service) SaveFooter(ctx context.Context, footer *Footer) error {
	footer.Owner = strings.TrimSpace(footer.Owner)
	footer.License = strings.TrimSpace(footer.License)
	footer.ICP = strings.TrimSpace(footer.ICP)
	footer.Police = strings.TrimSpace(footer.Police)
	if len([]rune(footer.Owner)) > 100 || len([]rune(footer.License)) > 100 ||
		len([]rune(footer.ICP)) > 60 || len([]rune(footer.Police)) > 60 ||
		len([]rune(footer.ICPIcon)) > 200 || len([]rune(footer.PoliceIcon)) > 200 {
		return errors.New("页脚字段过长")
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO footer_settings
			(id, owner, license, icp, icp_icon, police, police_icon)
		VALUES (1, $1, $2, $3, $4, $5, $6)
		ON CONFLICT (id) DO UPDATE SET
			owner = EXCLUDED.owner,
			license = EXCLUDED.license,
			icp = EXCLUDED.icp,
			icp_icon = EXCLUDED.icp_icon,
			police = EXCLUDED.police,
			police_icon = EXCLUDED.police_icon`,
		footer.Owner, footer.License, footer.ICP,
		footer.ICPIcon, footer.Police, footer.PoliceIcon,
	)
	return err
}

func (s *Service) AdminPage(ctx context.Context, slug string) (*AdminPage, error) {
	page := &AdminPage{}
	err := s.pool.QueryRow(ctx, `
		SELECT slug, title, summary, body, status, published_at, updated_at
		FROM site_pages
		WHERE slug = $1`,
		slug,
	).Scan(
		&page.Slug,
		&page.Title,
		&page.Summary,
		&page.Body,
		&page.Status,
		&page.PublishedAt,
		&page.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read content page: %w", err)
	}
	return page, nil
}

func (s *Service) SavePage(
	ctx context.Context,
	slug string,
	updatedBy int64,
	update *PageUpdate,
) (*AdminPage, error) {
	if err := normalizePageUpdate(update); err != nil {
		return nil, err
	}
	page := &AdminPage{}
	err := s.pool.QueryRow(ctx, `
		UPDATE site_pages
		SET title = $2,
			summary = $3,
			body = $4,
			status = $5,
			published_at = CASE
				WHEN $5 = 'published' THEN COALESCE(published_at, now())
				ELSE published_at
			END,
			updated_by = $6,
			updated_at = now()
		WHERE slug = $1
		RETURNING slug, title, summary, body, status, published_at, updated_at`,
		slug,
		update.Title,
		update.Summary,
		update.Body,
		update.Status,
		updatedBy,
	).Scan(
		&page.Slug,
		&page.Title,
		&page.Summary,
		&page.Body,
		&page.Status,
		&page.PublishedAt,
		&page.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errors.New("内容页面不存在")
	}
	if err != nil {
		return nil, fmt.Errorf("save content page: %w", err)
	}
	return page, nil
}

func normalizePageUpdate(update *PageUpdate) error {
	update.Title = strings.TrimSpace(update.Title)
	update.Summary = strings.TrimSpace(update.Summary)
	update.Body = strings.TrimSpace(update.Body)
	update.Status = strings.TrimSpace(update.Status)
	if update.Title == "" {
		return errors.New("页面标题不能为空")
	}
	switch update.Status {
	case "draft", "published", "archived":
	default:
		return errors.New("页面发布状态无效")
	}
	if len([]rune(update.Title)) > 120 ||
		len([]rune(update.Summary)) > 300 ||
		len([]rune(update.Body)) > 20000 {
		return errors.New("页面内容过长")
	}
	return nil
}

func (s *Service) Logo(ctx context.Context) (string, error) {
	var logo string
	err := s.pool.QueryRow(ctx,
		`SELECT COALESCE((SELECT logo_url FROM site_settings WHERE id = 1), '')`,
	).Scan(&logo)
	return logo, err
}

func (s *Service) SaveLogo(ctx context.Context, url string) error {
	url = strings.TrimSpace(url)
	if len([]rune(url)) > 200 {
		return errors.New("Logo 地址过长")
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO site_settings (id, logo_url) VALUES (1, $1)
		ON CONFLICT (id) DO UPDATE SET logo_url = EXCLUDED.logo_url`,
		url,
	)
	return err
}

func (s *Service) AllBackgrounds(ctx context.Context) ([]AdminBackground, error) {
	return s.adminBackgrounds(ctx,
		`SELECT id, file_path, active, created_at FROM backgrounds ORDER BY created_at DESC, id DESC`)
}

func (s *Service) AddBackground(ctx context.Context, filePath string) (*AdminBackground, error) {
	background := &AdminBackground{FilePath: filePath, Active: true}
	err := s.pool.QueryRow(ctx,
		`INSERT INTO backgrounds (file_path, active) VALUES ($1, TRUE) RETURNING id, created_at`,
		filePath,
	).Scan(&background.ID, &background.CreatedAt)
	if err != nil {
		return nil, err
	}
	return background, nil
}

func (s *Service) SetBackgroundActive(ctx context.Context, id int64, active bool) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE backgrounds SET active = $2 WHERE id = $1`, id, active,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("背景图不存在")
	}
	return nil
}

func (s *Service) DeleteBackground(ctx context.Context, id int64) (string, error) {
	var filePath string
	err := s.pool.QueryRow(ctx,
		`DELETE FROM backgrounds WHERE id = $1 RETURNING file_path`, id,
	).Scan(&filePath)
	if err != nil {
		return "", err
	}
	return filePath, nil
}

func (s *Service) ClearBackgrounds(ctx context.Context) ([]string, error) {
	rows, err := s.pool.Query(ctx, `DELETE FROM backgrounds RETURNING file_path`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	paths := []string{}
	for rows.Next() {
		var path string
		if err := rows.Scan(&path); err != nil {
			return nil, err
		}
		paths = append(paths, path)
	}
	return paths, rows.Err()
}

func (s *Service) adminBackgrounds(ctx context.Context, query string) ([]AdminBackground, error) {
	rows, err := s.pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AdminBackground{}
	for rows.Next() {
		var background AdminBackground
		if err := rows.Scan(&background.ID, &background.FilePath, &background.Active, &background.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, background)
	}
	return out, rows.Err()
}
