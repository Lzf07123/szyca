package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"szyca/internal/access"
	"szyca/internal/audit"
	"szyca/internal/config"
	"szyca/internal/httpapi"
	"szyca/internal/lottery"
	"szyca/internal/media"
	"szyca/internal/publish"
	"szyca/internal/quiz"
	"szyca/internal/rank"
	"szyca/internal/site"
	"szyca/internal/store"
	"szyca/internal/ws"
)

func main() {
	cfg := config.Load()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	st, err := openStoreWithRetry(ctx, cfg.DatabaseURL, cfg.PGPoolMax)
	if err != nil {
		log.Fatalf("store: %v", err)
	}
	defer st.Close()

	auditSvc := audit.New(st.Pool())
	accessSvc := access.New(st.Pool(), time.Duration(cfg.AdminSessionHours)*time.Hour)
	createdOwner, err := accessSvc.EnsureBootstrapOwner(ctx, cfg.AdminUsername, cfg.AdminPassword)
	if err != nil {
		log.Fatalf("bootstrap administrator: %v", err)
	}
	if createdOwner {
		log.Printf("created initial owner account %q", cfg.AdminUsername)
	}

	rk := rank.New(cfg.RedisAddr)
	if err := rk.Ping(ctx); err != nil {
		log.Fatalf("redis: %v", err)
	}
	pub := publish.New(cfg.RedisAddr)

	if err := st.EnsureFooterDefaults(ctx); err != nil {
		log.Fatalf("footer defaults: %v", err)
	}

	if err := st.EnsureSiteSettings(ctx); err != nil {
		log.Fatalf("site defaults: %v", err)
	}

	svc := quiz.New(st, rk, pub, cfg.Title, cfg.QuestionSeconds, cfg.AnswerGraceSeconds)
	svc.StartLeaderboardRefresh(ctx)
	siteSvc := site.New(st.Pool(), cfg.Title)
	mediaSvc := media.New(st.Pool())
	lotterySvc := lottery.New(st.Pool(), svc, cfg.QuizCount)
	hub := ws.NewHub(svc, pub.Subscribe(ctx)) // 排行榜改走 DB 全量排名
	go hub.Run(ctx)

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           httpapi.New(cfg, svc, siteSvc, mediaSvc, lotterySvc, accessSvc, auditSvc, hub).Handler(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		log.Printf("quiz server listening on :%s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("http: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("shutting down...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
}

// openStoreWithRetry 等待 compose 里 postgres 就绪（最多 30s）。
func openStoreWithRetry(ctx context.Context, dsn string, maxConns int) (*store.Store, error) {
	var lastErr error
	for i := 0; i < 30; i++ {
		st, err := store.Open(ctx, dsn, maxConns)
		if err == nil {
			return st, nil
		}
		lastErr = err
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(time.Second):
		}
	}
	return nil, lastErr
}
