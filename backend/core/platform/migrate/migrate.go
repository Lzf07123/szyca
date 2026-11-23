package migrate

import (
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"fmt"
	"io/fs"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"szyca/backend/core/modulecatalog"
)

// The migration files are the single source of database versions. A process
// that opens the database takes a PostgreSQL advisory lock before inspecting or
// applying versions, so two overlapping container starts cannot race.
//
//go:embed migrations/*.sql
var migrationFiles embed.FS

const advisoryLockID int64 = 0x535A5943414D4947

type appliedMigration struct {
	checksum string
}

// Run applies every pending migration in filename order. Each migration and
// its schema_migrations row commit in one transaction. A failed migration
// therefore leaves neither partial DDL nor a false "applied" marker.
func Run(ctx context.Context, pool *pgxpool.Pool) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquire migration connection: %w", err)
	}
	defer conn.Release()

	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, advisoryLockID); err != nil {
		return fmt.Errorf("acquire migration advisory lock: %w", err)
	}
	defer func() {
		_, _ = conn.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, advisoryLockID)
	}()

	if _, err := conn.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version    TEXT PRIMARY KEY,
			checksum   TEXT NOT NULL,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	applied, err := loadApplied(ctx, conn)
	if err != nil {
		return err
	}
	migrations, err := loadMigrations()
	if err != nil {
		return err
	}
	versions := make([]string, 0, len(migrations))
	for version := range migrations {
		versions = append(versions, version)
	}
	sort.Strings(versions)

	for _, version := range versions {
		sqlBytes := migrations[version]
		sum := sha256.Sum256(sqlBytes)
		checksum := hex.EncodeToString(sum[:])
		if previous, ok := applied[version]; ok {
			if previous.checksum != checksum {
				return fmt.Errorf(
					"migration %s checksum changed (applied %s, current %s)",
					version,
					previous.checksum,
					checksum,
				)
			}
			continue
		}

		tx, err := conn.Begin(ctx)
		if err != nil {
			return fmt.Errorf("begin migration %s: %w", version, err)
		}
		if _, err := tx.Exec(ctx, string(sqlBytes)); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("apply migration %s: %w", version, err)
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)`,
			version,
			checksum,
		); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("record migration %s: %w", version, err)
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit migration %s: %w", version, err)
		}
	}
	return nil
}

func loadApplied(ctx context.Context, conn *pgxpool.Conn) (map[string]appliedMigration, error) {
	rows, err := conn.Query(ctx, `SELECT version, checksum FROM schema_migrations`)
	if err != nil {
		return nil, fmt.Errorf("read schema_migrations: %w", err)
	}
	defer rows.Close()

	applied := make(map[string]appliedMigration)
	for rows.Next() {
		var version string
		var migration appliedMigration
		if err := rows.Scan(&version, &migration.checksum); err != nil {
			return nil, fmt.Errorf("scan schema_migrations: %w", err)
		}
		applied[version] = migration
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate schema_migrations: %w", err)
	}
	return applied, nil
}

func loadVersions() ([]string, error) {
	migrations, err := loadMigrations()
	if err != nil {
		return nil, err
	}
	versions := make([]string, 0, len(migrations))
	for version := range migrations {
		versions = append(versions, version)
	}
	sort.Strings(versions)
	return versions, nil
}

func loadMigrations() (map[string][]byte, error) {
	entries, err := fs.ReadDir(migrationFiles, "migrations")
	if err != nil {
		return nil, fmt.Errorf("list core migrations: %w", err)
	}
	migrations := make(map[string][]byte, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		sql, err := migrationFiles.ReadFile("migrations/" + entry.Name())
		if err != nil {
			return nil, fmt.Errorf("read core migration %s: %w", entry.Name(), err)
		}
		migrations[entry.Name()] = sql
	}
	for _, migration := range modulecatalog.Migrations() {
		if _, exists := migrations[migration.Version]; exists {
			return nil, fmt.Errorf("duplicate migration %s", migration.Version)
		}
		migrations[migration.Version] = migration.SQL
	}
	return migrations, nil
}
