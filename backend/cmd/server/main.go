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

	"szyca/backend/contract"
	"szyca/backend/core/access"
	"szyca/backend/core/audit"
	"szyca/backend/core/config"
	"szyca/backend/core/httpapi"
	"szyca/backend/core/media"
	"szyca/backend/core/moduleregistry"
	"szyca/backend/core/publish"
	"szyca/backend/core/rank"
	"szyca/backend/core/site"
	"szyca/backend/core/store"
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

	mediaSvc := media.New(st.Pool())
	runtime, err := moduleregistry.Build(ctx, map[string]any{
		"config":  cfg,
		"store":   st,
		"rank":    rk,
		"publish": pub,
	})
	if err != nil {
		log.Fatalf("modules: %v", err)
	}
	if err := runtime.Start(ctx); err != nil {
		log.Fatalf("start modules: %v", err)
	}
	quizValue, ok := runtime.Service("quiz")
	if !ok {
		log.Fatal("quiz module service missing")
	}
	quizSvc, ok := quizValue.(contract.IdentityValidator)
	if !ok {
		log.Fatal("quiz module does not implement contract.IdentityValidator")
	}
	realtimeValue, ok := runtime.Service("realtime")
	if !ok {
		log.Fatal("realtime module service missing")
	}
	realtimeSvc, ok := realtimeValue.(contract.RealtimeRuntime)
	if !ok {
		log.Fatal("realtime module does not implement contract.RealtimeRuntime")
	}
	hub := realtimeSvc.Counter()
	var siteSvc *site.Service
	var qrcodeProvider site.QrcodeProvider
	if joinValue, ok := runtime.Service("join"); ok {
		qrcodeProvider, _ = joinValue.(site.QrcodeProvider)
	}
	var galleryProvider site.GalleryProvider
	if galleryValue, ok := runtime.Service("gallery"); ok {
		provider, ok := galleryValue.(site.GalleryProvider)
		if !ok {
			log.Fatal("gallery module does not implement site.GalleryProvider")
		}
		galleryProvider = provider
	}
	lotteryValue, ok := runtime.Service("lottery")
	if !ok {
		log.Fatal("lottery module service missing")
	}
	sectionAvailability, ok := lotteryValue.(site.SectionAvailabilityProvider)
	if !ok {
		log.Fatal("lottery module does not implement site.SectionAvailabilityProvider")
	}
	siteSvc = site.NewWithProviders(
		st.Pool(),
		cfg.Title,
		galleryProvider,
		qrcodeProvider,
		sectionAvailability,
	)

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           httpapi.New(cfg, quizSvc, runtime, siteSvc, mediaSvc, accessSvc, auditSvc, hub).Handler(runtime.List()...),
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
	_ = runtime.Stop(shutdownCtx)
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
