package store

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"szyca/backend/core/platform/migrate"
)

type Store struct{ pool *pgxpool.Pool }

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
	return &Store{pool: pool}, nil
}

func (s *Store) Close() { s.pool.Close() }

// Pool exposes the shared connection pool to domain services. Store remains the
// owner of lifecycle and migrations; business modules own their own tables.
func (s *Store) Pool() *pgxpool.Pool { return s.pool }

// ---------- health ----------

func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }

// ---------- footer ----------

// EnsureFooterDefaults 首次启动时创建空行；内容完全由后台定义并持久化。
func (s *Store) EnsureFooterDefaults(ctx context.Context) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO footer_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`)
	return err
}

// ---------- site ----------

// EnsureSiteSettings 首次启动时创建单行站点设置。
func (s *Store) EnsureSiteSettings(ctx context.Context) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO site_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`)
	return err
}
