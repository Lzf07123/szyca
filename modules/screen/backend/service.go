package screen

import (
	"context"

	"szyca/backend/core/rank"
)

type RankingReader interface {
	Leaderboard(ctx context.Context, limit int) ([]rank.Entry, int64, error)
}

type Service struct {
	ranking RankingReader
}

func New(ranking RankingReader) *Service {
	return &Service{ranking: ranking}
}

func (s *Service) Leaderboard(ctx context.Context, limit int) ([]rank.Entry, int64, error) {
	return s.ranking.Leaderboard(ctx, limit)
}
