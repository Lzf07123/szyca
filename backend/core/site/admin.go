package site

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

type AdminBackground struct {
	ID        int64     `json:"id"`
	FilePath  string    `json:"file_path"`
	Active    bool      `json:"active"`
	CreatedAt time.Time `json:"created_at"`
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
