package gallery

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"szyca/backend/core/site"
)

const maxGalleryImages = 4

type Service struct {
	pool *pgxpool.Pool
}

var _ site.GalleryProvider = (*Service)(nil)

func New(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

func (s *Service) Images(ctx context.Context, sectionID int64) ([]site.GalleryImage, error) {
	if err := ensureGallerySection(ctx, s.pool, sectionID); err != nil {
		return nil, err
	}
	return listGalleryImages(ctx, s.pool, []int64{sectionID})
}

func (s *Service) ImagesForSections(
	ctx context.Context,
	sectionIDs []int64,
) ([]site.GalleryImage, error) {
	ids := uniquePositiveIDs(sectionIDs)
	if len(ids) == 0 {
		return []site.GalleryImage{}, nil
	}
	return listGalleryImages(ctx, s.pool, ids)
}

func (s *Service) Create(
	ctx context.Context,
	actorID, sectionID int64,
	title, imageURL string,
) (*site.GalleryImage, error) {
	if sectionID <= 0 {
		return nil, errors.New("图集 Section ID 无效")
	}
	title, imageURL, err := validateGalleryFields(title, imageURL)
	if err != nil {
		return nil, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	image := &site.GalleryImage{SectionID: sectionID, Title: title, ImageURL: imageURL}
	var kind string
	err = tx.QueryRow(ctx,
		`SELECT kind FROM home_sections WHERE id = $1 FOR UPDATE`, sectionID,
	).Scan(&kind)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errors.New("图集 Section 不存在")
	}
	if err != nil {
		return nil, fmt.Errorf("read gallery section: %w", err)
	}
	if kind != "gallery" {
		return nil, errors.New("目标 Section 不是活动影像插件")
	}
	var count int
	if err := tx.QueryRow(ctx,
		`SELECT count(*) FROM gallery_images WHERE section_id = $1`, sectionID,
	).Scan(&count); err != nil {
		return nil, fmt.Errorf("count gallery images: %w", err)
	}
	if count >= maxGalleryImages {
		return nil, fmt.Errorf("每个活动影像实例最多 %d 张图片", maxGalleryImages)
	}
	err = tx.QueryRow(ctx, `
		INSERT INTO gallery_images
			(section_id, title, image_url, sort, created_by, updated_at)
		VALUES (
			$1, $2, $3,
			COALESCE((SELECT MAX(sort) + 10 FROM gallery_images WHERE section_id = $1), 10),
			NULLIF($4, 0), now()
		)
		RETURNING id, sort, created_at, updated_at`,
		sectionID, title, imageURL, actorID,
	).Scan(&image.ID, &image.Sort, &image.CreatedAt, &image.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create gallery image: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return image, nil
}

func (s *Service) Update(
	ctx context.Context,
	sectionID, imageID int64,
	title string,
) (*site.GalleryImage, error) {
	title, _, err := validateGalleryFields(title, "/")
	if err != nil {
		return nil, err
	}
	image := &site.GalleryImage{ID: imageID, SectionID: sectionID, Title: title}
	err = s.pool.QueryRow(ctx, `
		UPDATE gallery_images
		SET title = $3, updated_at = now()
		WHERE id = $1 AND section_id = $2
		RETURNING title, image_url, sort, created_at, updated_at`,
		imageID, sectionID, title,
	).Scan(
		&image.Title, &image.ImageURL, &image.Sort, &image.CreatedAt, &image.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errors.New("图集图片不存在")
	}
	if err != nil {
		return nil, fmt.Errorf("update gallery image: %w", err)
	}
	return image, nil
}

func (s *Service) Delete(ctx context.Context, sectionID, imageID int64) (string, error) {
	var imageURL string
	err := s.pool.QueryRow(ctx, `
		DELETE FROM gallery_images
		WHERE id = $1 AND section_id = $2
		RETURNING image_url`,
		imageID, sectionID,
	).Scan(&imageURL)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", errors.New("图集图片不存在")
	}
	if err != nil {
		return "", fmt.Errorf("delete gallery image: %w", err)
	}
	return imageURL, nil
}

func (s *Service) Reorder(ctx context.Context, sectionID int64, imageIDs []int64) error {
	if err := ensureGallerySection(ctx, s.pool, sectionID); err != nil {
		return err
	}
	ids := uniquePositiveIDs(imageIDs)
	if len(ids) != len(imageIDs) {
		return errors.New("图集排序 ID 无效或重复")
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	rows, err := tx.Query(ctx, `
		SELECT id FROM gallery_images
		WHERE section_id = $1
		ORDER BY id
		FOR UPDATE`,
		sectionID,
	)
	if err != nil {
		return fmt.Errorf("lock gallery images: %w", err)
	}
	current := map[int64]bool{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return fmt.Errorf("scan gallery image: %w", err)
		}
		current[id] = true
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("iterate gallery images: %w", err)
	}
	rows.Close()
	if len(ids) != len(current) {
		return errors.New("排序列表必须包含该图集的全部图片")
	}
	for _, id := range ids {
		if !current[id] {
			return errors.New("排序列表包含其他图集的图片")
		}
	}
	for index, id := range ids {
		if _, err := tx.Exec(ctx, `
			UPDATE gallery_images
			SET sort = $3, updated_at = now()
			WHERE id = $1 AND section_id = $2`,
			id, sectionID, (index+1)*10,
		); err != nil {
			return fmt.Errorf("reorder gallery image %d: %w", id, err)
		}
	}
	return tx.Commit(ctx)
}

type querier interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

func listGalleryImages(
	ctx context.Context,
	queryer querier,
	sectionIDs []int64,
) ([]site.GalleryImage, error) {
	rows, err := queryer.Query(ctx, `
		SELECT id, section_id, title, image_url, sort, created_at, updated_at
		FROM gallery_images
		WHERE section_id = ANY($1)
		ORDER BY section_id, sort, id`,
		sectionIDs,
	)
	if err != nil {
		return nil, fmt.Errorf("list gallery images: %w", err)
	}
	defer rows.Close()
	out := []site.GalleryImage{}
	for rows.Next() {
		var image site.GalleryImage
		if err := rows.Scan(
			&image.ID, &image.SectionID, &image.Title, &image.ImageURL,
			&image.Sort, &image.CreatedAt, &image.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan gallery image: %w", err)
		}
		out = append(out, image)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate gallery images: %w", err)
	}
	return out, nil
}

type galleryQuerier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func ensureGallerySection(ctx context.Context, queryer galleryQuerier, sectionID int64) error {
	if sectionID <= 0 {
		return errors.New("图集 Section ID 无效")
	}
	var kind string
	err := queryer.QueryRow(ctx, `SELECT kind FROM home_sections WHERE id = $1`, sectionID).Scan(&kind)
	if errors.Is(err, pgx.ErrNoRows) {
		return errors.New("图集 Section 不存在")
	}
	if err != nil {
		return fmt.Errorf("read gallery section: %w", err)
	}
	if kind != "gallery" {
		return errors.New("目标 Section 不是活动影像插件")
	}
	return nil
}

func validateGalleryFields(title, imageURL string) (string, string, error) {
	title = strings.TrimSpace(title)
	imageURL = strings.TrimSpace(imageURL)
	if len([]rune(title)) > 120 {
		return "", "", errors.New("图片说明最多 120 个字符")
	}
	if containsHTML(title) {
		return "", "", errors.New("图片说明不允许 HTML")
	}
	if imageURL == "" {
		return "", "", errors.New("图片路径不能为空")
	}
	if len([]rune(imageURL)) > 1000 {
		return "", "", errors.New("图片路径过长")
	}
	if containsHTML(imageURL) {
		return "", "", errors.New("图片路径不允许 HTML")
	}
	if strings.HasPrefix(imageURL, "/") {
		if strings.HasPrefix(imageURL, "//") || strings.Contains(imageURL, ":") {
			return "", "", errors.New("图片必须使用站内路径")
		}
		return title, imageURL, nil
	}
	parsed, err := url.Parse(imageURL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", "", errors.New("图片必须是站内路径或 HTTP(S) URL")
	}
	return title, imageURL, nil
}

func containsHTML(value string) bool {
	lower := strings.ToLower(value)
	return strings.ContainsAny(value, "<>") || strings.Contains(lower, "javascript:")
}

func uniquePositiveIDs(ids []int64) []int64 {
	seen := make(map[int64]bool, len(ids))
	out := make([]int64, 0, len(ids))
	for _, id := range ids {
		if id <= 0 || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}
