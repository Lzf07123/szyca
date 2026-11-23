package media

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrInUse = errors.New("媒体仍被其他资源引用，不能删除")

type Service struct {
	pool *pgxpool.Pool
}

type Ref struct {
	Module       string    `json:"module"`
	ResourceType string    `json:"resource_type"`
	ResourceID   string    `json:"resource_id"`
	CreatedAt    time.Time `json:"created_at"`
}

type Asset struct {
	ID        int64     `json:"id"`
	Path      string    `json:"path"`
	MIME      string    `json:"mime"`
	Width     *int      `json:"width,omitempty"`
	Height    *int      `json:"height,omitempty"`
	Checksum  string    `json:"checksum"`
	CreatedBy *int64    `json:"created_by,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	Refs      []Ref     `json:"refs"`
}

func New(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

func (s *Service) Register(
	ctx context.Context,
	actorID int64,
	path, mime, checksum string,
	width, height *int,
) (*Asset, error) {
	if path == "" {
		return nil, errors.New("媒体路径不能为空")
	}
	if mime == "" {
		mime = "application/octet-stream"
	}
	var assetID int64
	err := s.pool.QueryRow(ctx, `
		INSERT INTO media_assets (path, mime, width, height, checksum, created_by)
		VALUES ($1, $2, $3, $4, $5, NULLIF($6, 0))
		ON CONFLICT (path) DO UPDATE
		SET mime = EXCLUDED.mime,
		    width = COALESCE(EXCLUDED.width, media_assets.width),
		    height = COALESCE(EXCLUDED.height, media_assets.height),
		    checksum = CASE WHEN EXCLUDED.checksum <> '' THEN EXCLUDED.checksum ELSE media_assets.checksum END
		RETURNING id`,
		path, mime, width, height, checksum, actorID,
	).Scan(&assetID)
	if err != nil {
		return nil, fmt.Errorf("register media: %w", err)
	}
	return s.get(ctx, assetID)
}

func (s *Service) Attach(
	ctx context.Context,
	actorID int64,
	path, mime, checksum, module, resourceType, resourceID string,
) (*Asset, error) {
	asset, err := s.Register(ctx, actorID, path, mime, checksum, nil, nil)
	if err != nil {
		return nil, err
	}
	if _, err := s.pool.Exec(ctx, `
		INSERT INTO media_refs (media_id, module, resource_type, resource_id)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT DO NOTHING`,
		asset.ID, module, resourceType, resourceID,
	); err != nil {
		return nil, fmt.Errorf("attach media reference: %w", err)
	}
	return s.get(ctx, asset.ID)
}

func (s *Service) Release(
	ctx context.Context,
	path, module, resourceType, resourceID string,
) error {
	_, err := s.pool.Exec(ctx, `
		DELETE FROM media_refs r
		USING media_assets a
		WHERE r.media_id = a.id
		  AND a.path = $1
		  AND r.module = $2
		  AND r.resource_type = $3
		  AND r.resource_id = $4`,
		path, module, resourceType, resourceID,
	)
	return err
}

// AssertUnreferenced checks all references except the resource currently being
// removed. A logo or QR code sharing the same file therefore blocks deletion.
func (s *Service) AssertUnreferenced(
	ctx context.Context,
	path, module, resourceType, resourceID string,
) error {
	var count int
	err := s.pool.QueryRow(ctx, `
		SELECT count(*)
		FROM media_refs r
		JOIN media_assets a ON a.id = r.media_id
		WHERE a.path = $1
		  AND NOT (r.module = $2 AND r.resource_type = $3 AND r.resource_id = $4)`,
		path, module, resourceType, resourceID,
	).Scan(&count)
	if err != nil {
		return err
	}
	if count > 0 {
		return ErrInUse
	}
	return nil
}

func (s *Service) AssertNoExternalRefs(
	ctx context.Context,
	path, module, resourceType string,
) error {
	var count int
	err := s.pool.QueryRow(ctx, `
		SELECT count(*)
		FROM media_refs r
		JOIN media_assets a ON a.id = r.media_id
		WHERE a.path = $1
		  AND NOT (r.module = $2 AND r.resource_type = $3)`,
		path, module, resourceType,
	).Scan(&count)
	if err != nil {
		return err
	}
	if count > 0 {
		return ErrInUse
	}
	return nil
}

func (s *Service) HasReferences(ctx context.Context, path string) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM media_refs r
			JOIN media_assets a ON a.id = r.media_id
			WHERE a.path = $1
		)`,
		path,
	).Scan(&exists)
	return exists, err
}

func (s *Service) List(ctx context.Context) ([]Asset, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT a.id, a.path, a.mime, a.width, a.height, a.checksum,
		       a.created_by, a.created_at,
		       COALESCE(
		         json_agg(json_build_object(
		           'module', r.module,
		           'resource_type', r.resource_type,
		           'resource_id', r.resource_id,
		           'created_at', r.created_at
		         ) ORDER BY r.created_at, r.module, r.resource_type, r.resource_id)
		         FILTER (WHERE r.media_id IS NOT NULL),
		         '[]'::json
		       ) AS refs
		FROM media_assets a
		LEFT JOIN media_refs r ON r.media_id = a.id
		GROUP BY a.id
		ORDER BY a.created_at DESC, a.id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Asset{}
	for rows.Next() {
		asset, err := scanAsset(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, asset)
	}
	return out, rows.Err()
}

func (s *Service) Get(ctx context.Context, id int64) (*Asset, error) {
	return s.get(ctx, id)
}

func (s *Service) DeleteAsset(ctx context.Context, id int64) (string, error) {
	asset, err := s.get(ctx, id)
	if err != nil {
		return "", err
	}
	if len(asset.Refs) > 0 {
		return "", ErrInUse
	}
	tag, err := s.pool.Exec(ctx, `DELETE FROM media_assets WHERE id = $1`, id)
	if err != nil {
		return "", err
	}
	if tag.RowsAffected() == 0 {
		return "", pgx.ErrNoRows
	}
	return asset.Path, nil
}

func (s *Service) get(ctx context.Context, id int64) (*Asset, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT a.id, a.path, a.mime, a.width, a.height, a.checksum,
		       a.created_by, a.created_at,
		       COALESCE(
		         json_agg(json_build_object(
		           'module', r.module,
		           'resource_type', r.resource_type,
		           'resource_id', r.resource_id,
		           'created_at', r.created_at
		         ) ORDER BY r.created_at, r.module, r.resource_type, r.resource_id)
		         FILTER (WHERE r.media_id IS NOT NULL),
		         '[]'::json
		       ) AS refs
		FROM media_assets a
		LEFT JOIN media_refs r ON r.media_id = a.id
		WHERE a.id = $1
		GROUP BY a.id`,
		id,
	)
	asset, err := scanAsset(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, pgx.ErrNoRows
	}
	if err != nil {
		return nil, err
	}
	return &asset, nil
}

type scanner interface {
	Scan(...any) error
}

func scanAsset(row scanner) (Asset, error) {
	var asset Asset
	var refsJSON []byte
	err := row.Scan(
		&asset.ID, &asset.Path, &asset.MIME, &asset.Width, &asset.Height,
		&asset.Checksum, &asset.CreatedBy, &asset.CreatedAt, &refsJSON,
	)
	if err != nil {
		return Asset{}, err
	}
	if err := json.Unmarshal(refsJSON, &asset.Refs); err != nil {
		return Asset{}, err
	}
	if asset.Refs == nil {
		asset.Refs = []Ref{}
	}
	return asset, nil
}
