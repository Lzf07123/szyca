package join

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"szyca/backend/contract"
	"szyca/backend/core/site"
)

var ErrNotFound = errors.New("二维码不存在")

type Qrcode struct {
	ID       int64  `json:"id"`
	Title    string `json:"title"`
	ImageURL string `json:"image_url"`
	Active   bool   `json:"active"`
}

type Service struct {
	pool *pgxpool.Pool
}

var _ site.QrcodeProvider = (*Service)(nil)

func New(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

func (s *Service) Qrcodes(ctx context.Context) ([]contract.Qrcode, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, title, image_url FROM qrcodes WHERE active ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []contract.Qrcode{}
	for rows.Next() {
		var qrcode contract.Qrcode
		if err := rows.Scan(&qrcode.ID, &qrcode.Title, &qrcode.ImageURL); err != nil {
			return nil, err
		}
		out = append(out, qrcode)
	}
	return out, rows.Err()
}

func (s *Service) AllQrcodes(ctx context.Context) ([]Qrcode, error) {
	return s.listQrcodes(ctx, `SELECT id, title, image_url, active FROM qrcodes ORDER BY id`)
}

func (s *Service) AddQrcode(ctx context.Context, title, imageURL string) (*Qrcode, error) {
	title = strings.TrimSpace(title)
	if strings.TrimSpace(imageURL) == "" || len([]rune(title)) > 30 {
		return nil, errors.New("二维码标题或图片无效")
	}
	qrcode := &Qrcode{Title: title, ImageURL: imageURL, Active: true}
	err := s.pool.QueryRow(ctx,
		`INSERT INTO qrcodes (title, image_url, active) VALUES ($1,$2,TRUE) RETURNING id`,
		title, imageURL,
	).Scan(&qrcode.ID)
	if err != nil {
		return nil, err
	}
	return qrcode, nil
}

func (s *Service) UpdateQrcode(
	ctx context.Context,
	id int64,
	title, imageURL *string,
	active *bool,
) (string, error) {
	qrcode, err := s.getQrcode(ctx, id)
	if err != nil {
		return "", err
	}
	nextTitle, nextImage, nextActive := qrcode.Title, qrcode.ImageURL, qrcode.Active
	if title != nil {
		nextTitle = strings.TrimSpace(*title)
		if len([]rune(nextTitle)) > 30 {
			return "", errors.New("二维码标题最多 30 个字符")
		}
	}
	if imageURL != nil {
		nextImage = strings.TrimSpace(*imageURL)
		if nextImage == "" {
			return "", errors.New("二维码图片不能为空")
		}
	}
	if active != nil {
		nextActive = *active
	}
	tag, err := s.pool.Exec(ctx,
		`UPDATE qrcodes SET title = $2, image_url = $3, active = $4, updated_at = now() WHERE id = $1`,
		id, nextTitle, nextImage, nextActive,
	)
	if err != nil {
		return "", err
	}
	if tag.RowsAffected() == 0 {
		return "", ErrNotFound
	}
	if nextImage != qrcode.ImageURL {
		return qrcode.ImageURL, nil
	}
	return "", nil
}

func (s *Service) DeleteQrcode(ctx context.Context, id int64) (string, error) {
	var imageURL string
	err := s.pool.QueryRow(ctx,
		`DELETE FROM qrcodes WHERE id = $1 RETURNING image_url`, id,
	).Scan(&imageURL)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return imageURL, err
}

func (s *Service) getQrcode(ctx context.Context, id int64) (*Qrcode, error) {
	qrcode := &Qrcode{}
	err := s.pool.QueryRow(ctx,
		`SELECT id, title, image_url, active FROM qrcodes WHERE id = $1`, id,
	).Scan(&qrcode.ID, &qrcode.Title, &qrcode.ImageURL, &qrcode.Active)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return qrcode, nil
}

func (s *Service) listQrcodes(ctx context.Context, query string) ([]Qrcode, error) {
	rows, err := s.pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Qrcode{}
	for rows.Next() {
		var qrcode Qrcode
		if err := rows.Scan(&qrcode.ID, &qrcode.Title, &qrcode.ImageURL, &qrcode.Active); err != nil {
			return nil, err
		}
		out = append(out, qrcode)
	}
	return out, rows.Err()
}
