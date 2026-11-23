package access

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/argon2"

	"szyca/backend/core/modulecatalog"
)

const (
	RoleOwner         = "owner"
	RoleContentEditor = "content_editor"
	RoleEventOperator = "event_operator"
	RoleDataViewer    = "data_viewer"
)

var (
	ErrInvalidCredentials = errors.New("用户名或密码错误")
	ErrUnauthorized       = errors.New("管理员会话无效或已过期")
	ErrForbidden          = errors.New("没有执行该操作的权限")
	ErrAccountDisabled    = errors.New("管理员账号已停用")
	ErrDuplicateAccount   = errors.New("管理员用户名已存在")
)

var rolePermissions = map[string]map[string]bool{
	RoleOwner: {
		"*": true,
	},
	RoleContentEditor: {
		"site.read": true, "site.write": true,
		"media.read": true, "media.write": true,
	},
	RoleEventOperator: {
		"site.read": true, "media.read": true,
	},
	RoleDataViewer: {
		"site.read": true, "audit.read": true,
	},
}

func init() {
	for role, permissions := range rolePermissions {
		if role == RoleOwner {
			continue
		}
		for _, capability := range modulecatalog.CapabilityGrants(role) {
			permissions[capability] = true
		}
	}
}

var usernamePattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}$`)

type Service struct {
	pool       *pgxpool.Pool
	sessionTTL time.Duration
}

type Principal struct {
	ID           int64    `json:"id"`
	Username     string   `json:"username"`
	Role         string   `json:"role"`
	Capabilities []string `json:"capabilities"`
	Legacy       bool     `json:"legacy"`
}

type Account struct {
	ID        int64     `json:"id"`
	Username  string    `json:"username"`
	Role      string    `json:"role"`
	Disabled  bool      `json:"disabled"`
	CreatedAt time.Time `json:"created_at"`
}

type Session struct {
	Token     string
	CSRF      string
	Principal Principal
}

func New(pool *pgxpool.Pool, sessionTTL time.Duration) *Service {
	if sessionTTL <= 0 {
		sessionTTL = 8 * time.Hour
	}
	return &Service{pool: pool, sessionTTL: sessionTTL}
}

// EnsureBootstrapOwner creates the first owner account after a fresh database
// migration. Existing accounts are never overwritten by an environment restart.
func (s *Service) EnsureBootstrapOwner(ctx context.Context, username, password string) (bool, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		username = "owner"
	}
	if len(password) < 8 {
		return false, errors.New("ADMIN_PASSWORD 至少需要 8 个字符")
	}
	var exists bool
	if err := s.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM admin_accounts)`,
	).Scan(&exists); err != nil {
		return false, err
	}
	if exists {
		return false, nil
	}
	hash, err := HashPassword(password)
	if err != nil {
		return false, err
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO admin_accounts (username, password_hash, role)
		VALUES ($1, $2, $3)
		ON CONFLICT (username) DO NOTHING`,
		username, hash, RoleOwner,
	)
	if err != nil {
		return false, err
	}
	return true, nil
}

func (s *Service) Login(
	ctx context.Context,
	username, password, ip, userAgent string,
) (*Session, error) {
	username = strings.TrimSpace(username)
	if username == "" || password == "" {
		return nil, ErrInvalidCredentials
	}
	var accountID int64
	var loadedUsername, passwordHash, role string
	var disabled bool
	err := s.pool.QueryRow(ctx, `
		SELECT id, username, password_hash, role, disabled
		FROM admin_accounts WHERE username = $1`,
		username,
	).Scan(&accountID, &loadedUsername, &passwordHash, &role, &disabled)
	if errors.Is(err, pgx.ErrNoRows) {
		// Keep the verification path similar for unknown and known usernames.
		_, _ = VerifyPassword(password, dummyPasswordHash)
		return nil, ErrInvalidCredentials
	}
	if err != nil {
		return nil, err
	}
	if disabled {
		return nil, ErrAccountDisabled
	}
	ok, err := VerifyPassword(password, passwordHash)
	if err != nil || !ok {
		return nil, ErrInvalidCredentials
	}

	token, err := randomToken()
	if err != nil {
		return nil, err
	}
	csrf, err := randomToken()
	if err != nil {
		return nil, err
	}
	expiresAt := time.Now().Add(s.sessionTTL)
	_, err = s.pool.Exec(ctx, `
		INSERT INTO admin_sessions
			(account_id, token_hash, csrf_hash, expires_at, ip, user_agent)
		VALUES ($1, $2, $3, $4, $5, $6)`,
		accountID, hashToken(token), hashToken(csrf), expiresAt, ip, truncate(userAgent, 500),
	)
	if err != nil {
		return nil, err
	}
	return &Session{
		Token: token,
		CSRF:  csrf,
		Principal: Principal{
			ID:           accountID,
			Username:     loadedUsername,
			Role:         role,
			Capabilities: capabilities(role),
		},
	}, nil
}

func (s *Service) Authenticate(ctx context.Context, token string) (*Principal, error) {
	if token == "" {
		return nil, ErrUnauthorized
	}
	var principal Principal
	var disabled bool
	var expiresAt, lastSeen time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT a.id, a.username, a.role, a.disabled,
		       s.expires_at, s.last_seen_at
		FROM admin_sessions s
		JOIN admin_accounts a ON a.id = s.account_id
		WHERE s.token_hash = $1`,
		hashToken(token),
	).Scan(
		&principal.ID,
		&principal.Username,
		&principal.Role,
		&disabled,
		&expiresAt,
		&lastSeen,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUnauthorized
	}
	if err != nil {
		return nil, err
	}
	if disabled {
		return nil, ErrAccountDisabled
	}
	if !expiresAt.After(time.Now()) {
		return nil, ErrUnauthorized
	}
	if time.Since(lastSeen) > time.Minute {
		_, _ = s.pool.Exec(ctx, `
			UPDATE admin_sessions SET last_seen_at = now()
			WHERE token_hash = $1`, hashToken(token))
	}
	principal.Capabilities = capabilities(principal.Role)
	return &principal, nil
}

func (s *Service) VerifyCSRF(ctx context.Context, token, csrf string) bool {
	if token == "" || csrf == "" {
		return false
	}
	var stored string
	err := s.pool.QueryRow(ctx, `
		SELECT csrf_hash FROM admin_sessions
		WHERE token_hash = $1 AND expires_at > now()`,
		hashToken(token),
	).Scan(&stored)
	if err != nil {
		return false
	}
	sum := sha256.Sum256([]byte(csrf))
	want, err := hex.DecodeString(stored)
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare(sum[:], want) == 1
}

func (s *Service) RotateCSRF(ctx context.Context, token string) (string, error) {
	if token == "" {
		return "", ErrUnauthorized
	}
	csrf, err := randomToken()
	if err != nil {
		return "", err
	}
	tag, err := s.pool.Exec(ctx, `
		UPDATE admin_sessions
		SET csrf_hash = $2, last_seen_at = now()
		WHERE token_hash = $1 AND expires_at > now()`,
		hashToken(token), hashToken(csrf),
	)
	if err != nil {
		return "", err
	}
	if tag.RowsAffected() == 0 {
		return "", ErrUnauthorized
	}
	return csrf, nil
}

func (s *Service) Logout(ctx context.Context, token string) error {
	if token == "" {
		return nil
	}
	_, err := s.pool.Exec(ctx,
		`DELETE FROM admin_sessions WHERE token_hash = $1`, hashToken(token))
	return err
}

func (s *Service) ListAccounts(ctx context.Context) ([]Account, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, username, role, disabled, created_at
		FROM admin_accounts ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Account{}
	for rows.Next() {
		var account Account
		if err := rows.Scan(
			&account.ID, &account.Username, &account.Role, &account.Disabled, &account.CreatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, account)
	}
	return out, rows.Err()
}

func (s *Service) CreateAccount(
	ctx context.Context,
	username, password, role string,
) (*Account, error) {
	username = strings.TrimSpace(username)
	if !usernamePattern.MatchString(username) {
		return nil, errors.New("用户名需为 3-32 位字母、数字、点、横线或下划线")
	}
	if len(password) < 8 {
		return nil, errors.New("密码至少需要 8 个字符")
	}
	if !validRole(role) {
		return nil, errors.New("管理员角色无效")
	}
	hash, err := HashPassword(password)
	if err != nil {
		return nil, err
	}
	account := &Account{Username: username, Role: role}
	err = s.pool.QueryRow(ctx, `
		INSERT INTO admin_accounts (username, password_hash, role)
		VALUES ($1, $2, $3)
		RETURNING id, created_at`,
		username, hash, role,
	).Scan(&account.ID, &account.CreatedAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, ErrDuplicateAccount
		}
		return nil, err
	}
	return account, nil
}

func (s *Service) SetAccountDisabled(
	ctx context.Context,
	actor Principal,
	accountID int64,
	disabled bool,
) error {
	if accountID <= 0 {
		return errors.New("管理员 ID 无效")
	}
	if actor.ID == accountID && disabled {
		return errors.New("不能停用当前登录账号")
	}
	if disabled {
		var targetRole string
		if err := s.pool.QueryRow(ctx,
			`SELECT role FROM admin_accounts WHERE id = $1`, accountID,
		).Scan(&targetRole); err != nil {
			return err
		}
		if targetRole == RoleOwner {
			var remaining int
			if err := s.pool.QueryRow(ctx, `
				SELECT count(*) FROM admin_accounts
				WHERE role = 'owner' AND NOT disabled AND id <> $1`,
				accountID,
			).Scan(&remaining); err != nil {
				return err
			}
			if remaining == 0 {
				return errors.New("至少需要保留一个启用中的 owner")
			}
		}
	}
	tag, err := s.pool.Exec(ctx, `
		UPDATE admin_accounts
		SET disabled = $2, updated_at = now()
		WHERE id = $1`,
		accountID, disabled,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	if disabled {
		_, _ = s.pool.Exec(ctx,
			`DELETE FROM admin_sessions WHERE account_id = $1`, accountID)
	}
	return nil
}

func Can(principal Principal, permission string) bool {
	if principal.Role == RoleOwner {
		return true
	}
	return rolePermissions[principal.Role][permission]
}

func capabilities(role string) []string {
	if role == RoleOwner {
		return []string{"*"}
	}
	permissions := rolePermissions[role]
	out := make([]string, 0, len(permissions))
	// Keep core JSON stable, then append module capabilities in catalog order.
	order := []string{
		"site.read", "site.write", "media.read", "media.write",
		"audit.read",
	}
	for _, permission := range order {
		if permissions[permission] {
			out = append(out, permission)
		}
	}
	seen := make(map[string]bool, len(out))
	for _, permission := range out {
		seen[permission] = true
	}
	for _, manifest := range modulecatalog.All() {
		for _, capability := range manifest.Capabilities {
			if permissions[capability.Key] && !seen[capability.Key] {
				out = append(out, capability.Key)
				seen[capability.Key] = true
			}
		}
	}
	return out
}

func HashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	hash := argon2.IDKey([]byte(password), salt, 3, 64*1024, 2, 32)
	return fmt.Sprintf(
		"$argon2id$v=19$m=65536,t=3,p=2$%s$%s",
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(hash),
	), nil
}

func VerifyPassword(password, encoded string) (bool, error) {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" || parts[2] != "v=19" {
		return false, errors.New("不支持的密码哈希格式")
	}
	var memory uint32
	var iterations uint32
	var parallelism uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &iterations, &parallelism); err != nil {
		return false, err
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false, err
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false, err
	}
	got := argon2.IDKey([]byte(password), salt, iterations, memory, parallelism, uint32(len(expected)))
	return subtle.ConstantTimeCompare(got, expected) == 1, nil
}

func randomToken() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func validRole(role string) bool {
	_, ok := rolePermissions[role]
	return ok
}

func truncate(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

// A fixed hash makes unknown-username logins perform one Argon2 verification.
const dummyPasswordHash = "$argon2id$v=19$m=65536,t=3,p=2$MDAwMDAwMDAwMDAwMDAwMA$V1v8T7n7O8Ew5xlHtPyl80mYh6HNRM3JQ7GKwvJZ7nA"
