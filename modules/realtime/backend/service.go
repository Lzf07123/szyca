package ws

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"szyca/backend/contract"
	"szyca/backend/core/publish"
)

type Service struct {
	hub     *Hub
	publish *publish.Pub
	pool    *pgxpool.Pool
}

func New(pool *pgxpool.Pool, hub *Hub, publisher *publish.Pub) *Service {
	return &Service{hub: hub, publish: publisher, pool: pool}
}

func (s *Service) Hub() *Hub { return s.hub }

func (s *Service) Counter() contract.ClientCounter { return s.hub }

func (s *Service) Announce(ctx context.Context, content, kind string) error {
	content = strings.TrimSpace(content)
	if content == "" || len([]rune(content)) > 200 {
		return errors.New("公告内容无效")
	}
	if kind == "" {
		kind = "info"
	}
	if _, err := s.pool.Exec(ctx,
		`INSERT INTO announcements (content, type) VALUES ($1,$2)`,
		content, kind,
	); err != nil {
		return err
	}
	return s.publishJSON(ctx, "announcement", map[string]any{"content": content, "type": kind})
}

func (s *Service) LatestAnnouncement(ctx context.Context) (string, error) {
	var content string
	err := s.pool.QueryRow(ctx, `
		SELECT content FROM announcements
		ORDER BY created_at DESC, id DESC
		LIMIT 1`,
	).Scan(&content)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return content, err
}

func (s *Service) Effect(ctx context.Context, kind string) error {
	if kind == "" {
		kind = "confetti"
	}
	return s.publishJSON(ctx, "effect", map[string]any{"kind": kind})
}

func (s *Service) publishJSON(ctx context.Context, typ string, data any) error {
	message, err := json.Marshal(map[string]any{"type": typ, "data": data})
	if err != nil {
		return err
	}
	return s.publish.Publish(ctx, string(message))
}
