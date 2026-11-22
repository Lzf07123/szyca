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
	QuestionSeconds    int
	AnswerGraceSeconds int
	QuizCount          int
	UploadDir          string
	Title              string
	PGPoolMax          int
	WSAllowedOrigins   []string
}

func Load() Config {
	allowedOrigins := []string{}
	for _, origin := range strings.Split(getenv("WS_ALLOWED_ORIGINS", ""), ",") {
		if origin = strings.TrimSpace(origin); origin != "" {
			allowedOrigins = append(allowedOrigins, strings.TrimRight(origin, "/"))
		}
	}
	return Config{
		Port:               getenv("APP_PORT", "8080"),
		DatabaseURL:        getenv("DATABASE_URL", "postgres://quiz:quiz@localhost:5432/quiz?sslmode=disable"),
		RedisAddr:          getenv("REDIS_ADDR", "localhost:6379"),
		AdminPassword:      getenv("ADMIN_PASSWORD", "admin123"),
		QuestionSeconds:    getenvInt("QUESTION_SECONDS", 20),
		AnswerGraceSeconds: getenvNonNegativeInt("ANSWER_GRACE_SECONDS", 20),
		QuizCount:          getenvInt("QUESTION_COUNT", 10),
		UploadDir:          getenv("UPLOAD_DIR", "uploads"),
		Title:              getenv("APP_TITLE", "计算机协会 · 招新答题"),
		PGPoolMax:          getenvInt("PG_POOL_MAX", 20),
		WSAllowedOrigins:   allowedOrigins,
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
