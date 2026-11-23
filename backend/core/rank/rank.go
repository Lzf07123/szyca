package rank

import (
	"context"

	"github.com/redis/go-redis/v9"
)

// Rank 只负责 Redis 连接与健康检查；排行榜权威数据在 PostgreSQL。
type Rank struct{ rdb *redis.Client }

func New(addr string) *Rank {
	return &Rank{rdb: redis.NewClient(&redis.Options{Addr: addr})}
}

func (r *Rank) Ping(ctx context.Context) error { return r.rdb.Ping(ctx).Err() }

type Entry struct {
	UserID    string `json:"user_id"`
	Nickname  string `json:"nickname"`
	Correct   int    `json:"correct,omitempty"`
	ElapsedMS int64  `json:"elapsed_ms"`
	Score     int    `json:"score"`
}
