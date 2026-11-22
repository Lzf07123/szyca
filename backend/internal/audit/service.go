package audit

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool *pgxpool.Pool
}

type Entry struct {
	ID           int64     `json:"id"`
	ActorID      *int64    `json:"actor_id,omitempty"`
	ActorName    string    `json:"actor_name"`
	Action       string    `json:"action"`
	ResourceType string    `json:"resource_type"`
	ResourceID   string    `json:"resource_id"`
	Before       any       `json:"before"`
	After        any       `json:"after"`
	RequestID    string    `json:"request_id"`
	IP           string    `json:"ip"`
	CreatedAt    time.Time `json:"created_at"`
}

func New(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

func (s *Service) Record(
	ctx context.Context,
	actorID int64,
	actorName, action, resourceType, resourceID string,
	before, after any,
	requestID, ip string,
) error {
	beforeJSON, err := sanitizeJSON(before)
	if err != nil {
		return err
	}
	afterJSON, err := sanitizeJSON(after)
	if err != nil {
		return err
	}
	var nullableActor any
	if actorID > 0 {
		nullableActor = actorID
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO admin_audit_logs
			(actor_id, actor_name, action, resource_type, resource_id,
			 before, after, request_id, ip)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		nullableActor, actorName, action, resourceType, resourceID,
		beforeJSON, afterJSON, requestID, ip,
	)
	if err != nil {
		return fmt.Errorf("record audit: %w", err)
	}
	return nil
}

func (s *Service) List(ctx context.Context, limit int) ([]Entry, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, actor_id, actor_name, action, resource_type, resource_id,
		       before, after, request_id, ip, created_at
		FROM admin_audit_logs
		ORDER BY created_at DESC, id DESC
		LIMIT $1`,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Entry{}
	for rows.Next() {
		var entry Entry
		var beforeJSON, afterJSON []byte
		if err := rows.Scan(
			&entry.ID, &entry.ActorID, &entry.ActorName, &entry.Action,
			&entry.ResourceType, &entry.ResourceID, &beforeJSON, &afterJSON,
			&entry.RequestID, &entry.IP, &entry.CreatedAt,
		); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(beforeJSON, &entry.Before)
		_ = json.Unmarshal(afterJSON, &entry.After)
		out = append(out, entry)
	}
	return out, rows.Err()
}

func sanitizeJSON(value any) ([]byte, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("marshal audit payload: %w", err)
	}
	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return nil, err
	}
	decoded = redact(decoded)
	raw, err = json.Marshal(decoded)
	if err != nil {
		return nil, err
	}
	if len(raw) > 64<<10 {
		return nil, fmt.Errorf("audit payload too large: %d bytes", len(raw))
	}
	return raw, nil
}

func redact(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		for key, item := range typed {
			lower := lowerASCII(key)
			if containsAny(lower,
				"password", "passwd", "token", "cookie", "secret", "csrf",
				"authorization", "session",
			) {
				typed[key] = "[REDACTED]"
				continue
			}
			typed[key] = redact(item)
		}
	case []any:
		for index, item := range typed {
			typed[index] = redact(item)
		}
	}
	return value
}

func lowerASCII(value string) string {
	out := []byte(value)
	for index, char := range out {
		if char >= 'A' && char <= 'Z' {
			out[index] = char + ('a' - 'A')
		}
	}
	return string(out)
}

func containsAny(value string, parts ...string) bool {
	for _, part := range parts {
		if contains(value, part) {
			return true
		}
	}
	return false
}

func contains(value, part string) bool {
	if len(part) == 0 {
		return true
	}
	for index := 0; index+len(part) <= len(value); index++ {
		if value[index:index+len(part)] == part {
			return true
		}
	}
	return false
}
