package site

import (
	"context"
	"time"
)

type GalleryImage struct {
	ID        int64     `json:"id"`
	SectionID int64     `json:"section_id"`
	Title     string    `json:"title"`
	ImageURL  string    `json:"image_url"`
	Sort      int       `json:"sort"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type GalleryProvider interface {
	ImagesForSections(context.Context, []int64) ([]GalleryImage, error)
}

func (s *Service) GalleryImagesForSections(ctx context.Context, ids []int64) ([]GalleryImage, error) {
	if s.gallery == nil {
		return []GalleryImage{}, nil
	}
	return s.gallery.ImagesForSections(ctx, ids)
}

func attachGalleryImages(
	ctx context.Context,
	provider GalleryProvider,
	sections []Section,
) error {
	if provider == nil {
		return nil
	}
	ids := make([]int64, 0, len(sections))
	indexes := make(map[int64]int, len(sections))
	for index := range sections {
		if sections[index].Kind != "gallery" {
			continue
		}
		sections[index].Gallery = []GalleryImage{}
		ids = append(ids, sections[index].ID)
		indexes[sections[index].ID] = index
	}
	if len(ids) == 0 {
		return nil
	}
	images, err := provider.ImagesForSections(ctx, ids)
	if err != nil {
		return err
	}
	for _, image := range images {
		index, ok := indexes[image.SectionID]
		if !ok {
			continue
		}
		sections[index].Gallery = append(sections[index].Gallery, image)
	}
	return nil
}
