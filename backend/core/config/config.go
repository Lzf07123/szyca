package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port               string
	DatabaseURL        string
	RedisAddr          string
	AdminPassword      string
	AdminUsername      string
	AdminCookieName    string
	AdminCookieSecure  bool
	AdminSessionHours  int
	LegacyAdminToken   bool
	QuestionSeconds    int
	AnswerGraceSeconds int
	QuizCount          int
	UploadDir          string
	Title              string
	PGPoolMax          int
	WSAllowedOrigins   []string
	TrustedProxyCIDRs  []string
}

func Load() Config {
	allowedOrigins := []string{}
	for _, origin := range strings.Split(getenv("WS_ALLOWED_ORIGINS", ""), ",") {
		if origin = strings.TrimSpace(origin); origin != "" {
			allowedOrigins = append(allowedOrigins, strings.TrimRight(origin, "/"))
		}
	}
	trustedProxyCIDRs := []string{}
	for _, cidr := range strings.Split(getenv("TRUSTED_PROXY_CIDRS", "127.0.0.1/32,::1/128"), ",") {
		if cidr = strings.TrimSpace(cidr); cidr != "" {
			trustedProxyCIDRs = append(trustedProxyCIDRs, cidr)
		}
	}
	return Config{
		Port:               getenv("APP_PORT", "8080"),
		DatabaseURL:        getenv("DATABASE_URL", "postgres://quiz:quiz@localhost:5432/quiz?sslmode=disable"),
		RedisAddr:          getenv("REDIS_ADDR", "localhost:6379"),
		AdminPassword:      getenv("ADMIN_PASSWORD", "admin123"),
		AdminUsername:      getenv("ADMIN_USERNAME", "owner"),
		AdminCookieName:    getenv("ADMIN_COOKIE_NAME", "szyca_admin"),
		AdminCookieSecure:  getenvBool("ADMIN_COOKIE_SECURE", false),
		AdminSessionHours:  getenvInt("ADMIN_SESSION_HOURS", 8),
		LegacyAdminToken:   getenvBool("LEGACY_ADMIN_TOKEN_ENABLED", false),
		QuestionSeconds:    getenvInt("QUESTION_SECONDS", 20),
		AnswerGraceSeconds: getenvNonNegativeInt("ANSWER_GRACE_SECONDS", 20),
		QuizCount:          getenvInt("QUESTION_COUNT", 10),
		UploadDir:          getenv("UPLOAD_DIR", "uploads"),
		Title:              getenv("APP_TITLE", "计算机协会 · 招新答题"),
		PGPoolMax:          getenvInt("PG_POOL_MAX", 20),
		WSAllowedOrigins:   allowedOrigins,
		TrustedProxyCIDRs:  trustedProxyCIDRs,
	}
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func getenvInt(k string, def int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return def
}

func getenvNonNegativeInt(k string, def int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			return n
		}
	}
	return def
}

func getenvBool(k string, def bool) bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv(k)))
	switch v {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return def
	}
}
