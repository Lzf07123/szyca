package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"szyca/backend/contract"
	"szyca/backend/core/access"
	"szyca/backend/core/audit"
	"szyca/backend/core/config"
	"szyca/backend/core/media"
	"szyca/backend/core/site"
)

type Server struct {
	cfg       config.Config
	identity  contract.IdentityValidator
	readiness contract.Readiness
	site      *site.Service
	media     *media.Service
	access    *access.Service
	audit     *audit.Service
	hub       contract.ClientCounter
	modules   []contract.Module
	startedAt time.Time
	adminMu   sync.Mutex
	adminFail map[string]adminFailure
}

func New(
	cfg config.Config,
	identity contract.IdentityValidator,
	readiness contract.Readiness,
	siteSvc *site.Service,
	mediaSvc *media.Service,
	accessSvc *access.Service,
	auditSvc *audit.Service,
	hub contract.ClientCounter,
) *Server {
	return &Server{
		cfg: cfg, identity: identity, readiness: readiness, site: siteSvc, media: mediaSvc,
		access: accessSvc, audit: auditSvc,
		hub: hub, startedAt: time.Now(),
		adminFail: make(map[string]adminFailure),
	}
}

func (s *Server) Handler(extra ...contract.Module) http.Handler {
	mux := http.NewServeMux()
	s.modules = append([]contract.Module(nil), extra...)

	s.registerCoreRoutes(mux)
	for _, module := range extra {
		if module, ok := module.(contract.HTTPModule); ok {
			if err := module.RegisterHTTP(mux, s); err != nil {
				panic(err)
			}
		}
	}

	return s.withCORS(mux)
}

func (s *Server) validateToken(token string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, err := s.identity.ValidateToken(ctx, token)
	return err == nil
}

func (s *Server) withFeature(key string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		enabled, err := s.site.FeatureEnabled(r.Context(), key)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "读取模块开关失败")
			return
		}
		if !enabled {
			writeErrCode(w, http.StatusNotFound, "功能未开放", "feature_disabled")
			return
		}
		next(w, r)
	}
}

func (s *Server) withAnyFeature(keys []string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		for _, key := range keys {
			enabled, err := s.site.FeatureEnabled(r.Context(), key)
			if err != nil {
				writeErr(w, http.StatusInternalServerError, "读取模块开关失败")
				return
			}
			if enabled {
				next(w, r)
				return
			}
		}
		writeErrCode(w, http.StatusNotFound, "功能未开放", "feature_disabled")
	}
}

// ---------- middleware ----------

func (s *Server) withAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)
		if !s.adminAllowed(ip) {
			w.Header().Set("Retry-After", "300")
			writeErr(w, http.StatusTooManyRequests, "后台口令尝试过多，请 5 分钟后重试")
			return
		}
		got := r.Header.Get("X-Admin-Token")
		want := s.cfg.AdminPassword
		if got == "" || subtle.ConstantTimeCompare([]byte(got), []byte(want)) != 1 {
			s.recordAdminFailure(ip)
			writeErr(w, http.StatusUnauthorized, "后台口令错误")
			return
		}
		s.clearAdminFailures(ip)
		next(w, r)
	}
}

type adminFailure struct {
	Count int
	Since time.Time
}

const (
	adminWindow      = 5 * time.Minute
	adminMaxFailures = 8
)

func (s *Server) adminAllowed(ip string) bool {
	s.adminMu.Lock()
	defer s.adminMu.Unlock()
	entry, ok := s.adminFail[ip]
	if !ok || time.Since(entry.Since) >= adminWindow {
		delete(s.adminFail, ip)
		return true
	}
	return entry.Count < adminMaxFailures
}

func (s *Server) recordAdminFailure(ip string) {
	s.adminMu.Lock()
	defer s.adminMu.Unlock()
	now := time.Now()
	for key, entry := range s.adminFail {
		if now.Sub(entry.Since) >= adminWindow {
			delete(s.adminFail, key)
		}
	}
	entry := s.adminFail[ip]
	if entry.Since.IsZero() || now.Sub(entry.Since) >= adminWindow {
		entry = adminFailure{Since: now}
	}
	entry.Count++
	s.adminFail[ip] = entry
}

func (s *Server) clearAdminFailures(ip string) {
	s.adminMu.Lock()
	delete(s.adminFail, ip)
	s.adminMu.Unlock()
}

func clientIP(r *http.Request) string {
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		if ip := strings.TrimSpace(strings.Split(forwarded, ",")[0]); ip != "" {
			return ip
		}
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Token")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ---------- helpers ----------

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func writeErrCode(w http.ResponseWriter, code int, msg, errorCode string) {
	writeJSON(w, code, map[string]string{"error": msg, "code": errorCode})
}

func readJSON(r *http.Request, v any) error {
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	return dec.Decode(v)
}

// ---------- handlers ----------

func (s *Server) handlePublicRuntime(w http.ResponseWriter, r *http.Request) {
	uptime := int64(time.Since(s.startedAt).Seconds())
	if uptime < 0 {
		uptime = 0
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{
		"uptime_seconds": uptime,
		"started_at":     s.startedAt.UTC().Format(time.RFC3339),
	})
}

func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	footer, err := s.site.Footer(r.Context())
	if err != nil {
		footer = &site.Footer{}
	}
	logoURL, err := s.site.Logo(r.Context())
	if err != nil {
		logoURL = ""
	}
	flags := map[string]bool{}
	if features, err := s.site.Features(r.Context()); err == nil {
		for _, feature := range features {
			flags[feature.Key] = feature.Enabled
		}
	}
	config := map[string]any{
		"footer": footer, "logo_url": logoURL, "features": flags,
	}
	for _, module := range s.modules {
		contributor, ok := module.(contract.ConfigContributor)
		if !ok {
			continue
		}
		data, err := contributor.Config(r.Context())
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		for key, value := range data {
			config[key] = value
		}
	}
	writeJSON(w, http.StatusOK, config)
}

// ---------- admin handlers ----------

// ---------- admin: overview（资源与访问情况） ----------

func (s *Server) handleAdminOverview(w http.ResponseWriter, r *http.Request) {
	_, online := s.hub.ClientCounts()
	backgrounds, err := s.site.AllBackgrounds(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	overview := map[string]any{
		"online": online, "backgrounds": len(backgrounds),
	}
	for _, module := range s.modules {
		contributor, ok := module.(contract.OverviewContributor)
		if !ok {
			continue
		}
		data, err := contributor.Overview(r.Context())
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		for key, value := range data {
			overview[key] = value
		}
	}
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	writeJSON(w, http.StatusOK, map[string]any{
		"overview":    overview,
		"uptime":      time.Since(s.startedAt).Round(time.Second).String(),
		"goroutines":  runtime.NumGoroutine(),
		"mem_mb":      int(m.Alloc / 1024 / 1024),
		"app_version": "1.0",
	})
}

// ---------- admin: clear questions ----------

func (s *Server) handleAdminClearBackgrounds(w http.ResponseWriter, r *http.Request) {
	backgrounds, err := s.site.AllBackgrounds(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	for _, background := range backgrounds {
		if err := s.media.AssertNoExternalRefs(
			r.Context(), background.FilePath, "site", "background",
		); err != nil {
			writeErrCode(w, http.StatusConflict, "背景图仍被其他资源引用，不能直接删除", "media_in_use")
			return
		}
	}
	paths, err := s.site.ClearBackgrounds(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	backgroundIDs := make(map[string]int64, len(backgrounds))
	for _, background := range backgrounds {
		backgroundIDs[background.FilePath] = background.ID
	}
	for _, p := range paths {
		if id, ok := backgroundIDs[p]; ok {
			s.releaseAndCleanup(
				r, p, "site", "background",
				strconv.FormatInt(id, 10),
			)
		} else {
			s.removeUploadFile(p)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":                  "true",
		"backgrounds_deleted": len(paths),
	})
}

// ---------- admin: backgrounds ----------

func (s *Server) handleBackgrounds(w http.ResponseWriter, r *http.Request) {
	bgs, err := s.site.Backgrounds(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	urls := make([]string, 0, len(bgs))
	for _, b := range bgs {
		urls = append(urls, b.Path)
	}
	writeJSON(w, http.StatusOK, map[string]any{"backgrounds": urls})
}

// saveUploadedImage 保存 multipart 里的图片文件，返回 /uploads/xxx 路径；失败时已写响应。
func (s *Server) saveUploadedImage(w http.ResponseWriter, r *http.Request) (string, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		writeErr(w, http.StatusBadRequest, "文件过大或格式错误（上限 10MB）")
		return "", false
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "缺少 file 字段")
		return "", false
	}
	defer file.Close()

	head := make([]byte, 512)
	n, _ := file.Read(head)
	ct := http.DetectContentType(head[:n])
	ext := ""
	switch ct {
	case "image/jpeg":
		ext = ".jpg"
	case "image/png":
		ext = ".png"
	case "image/webp":
		ext = ".webp"
	case "image/gif":
		ext = ".gif"
	default:
		writeErr(w, http.StatusBadRequest, "仅支持 JPG/PNG/WebP/GIF 图片")
		return "", false
	}
	if _, err := file.Seek(0, 0); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return "", false
	}
	if err := os.MkdirAll(s.cfg.UploadDir, 0o755); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return "", false
	}
	name := fmt.Sprintf("up-%d-%s%s", time.Now().UnixNano(), randHex(4), ext)
	out, err := os.Create(filepath.Join(s.cfg.UploadDir, name))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return "", false
	}
	if _, err := io.Copy(out, file); err != nil {
		out.Close()
		writeErr(w, http.StatusInternalServerError, err.Error())
		return "", false
	}
	out.Close()
	return "/uploads/" + name, true
}

// removeUploadFile 清理 /uploads/ 下的旧文件（切换后防止残留）。
func (s *Server) removeUploadFile(p string) {
	if p == "" || !strings.HasPrefix(p, "/uploads/") {
		return
	}
	_ = os.Remove(filepath.Join(s.cfg.UploadDir, filepath.Base(p)))
}

// 通用上传：返回文件路径，供二维码/备案图标等使用
func (s *Server) handleAdminUpload(w http.ResponseWriter, r *http.Request) {
	url, ok := s.saveUploadedImage(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"url": url})
}

func (s *Server) handleAdminUploadBackground(w http.ResponseWriter, r *http.Request) {
	url, ok := s.saveUploadedImage(w, r)
	if !ok {
		return
	}
	bg, err := s.site.AddBackground(r.Context(), url)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.attachUploadedMedia(
		r, principalFromRequest(r), url, "site", "background",
		strconv.FormatInt(bg.ID, 10),
	)
	writeJSON(w, http.StatusOK, bg)
}

func (s *Server) handleAdminListBackgrounds(w http.ResponseWriter, r *http.Request) {
	bgs, err := s.site.AllBackgrounds(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"backgrounds": bgs})
}

func (s *Server) handleAdminSetBgActive(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "id 无效")
		return
	}
	var req struct {
		Active bool `json:"active"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体格式错误")
		return
	}
	if err := s.site.SetBackgroundActive(r.Context(), id, req.Active); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "active": req.Active})
}

func (s *Server) handleAdminDeleteBackground(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "id 无效")
		return
	}
	backgrounds, err := s.site.AllBackgrounds(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	var filePath string
	for _, background := range backgrounds {
		if background.ID == id {
			filePath = background.FilePath
			break
		}
	}
	if filePath == "" {
		writeErr(w, http.StatusNotFound, "背景图不存在")
		return
	}
	if err := s.assertMediaUnreferenced(
		r, filePath, "site", "background", strconv.FormatInt(id, 10),
	); err != nil {
		writeErrCode(w, http.StatusConflict, err.Error(), "media_in_use")
		return
	}
	filePath, err = s.site.DeleteBackground(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.releaseAndCleanup(
		r, filePath, "site", "background", strconv.FormatInt(id, 10),
	)
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "ok": "true"})
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// ---------- admin: footer ----------

func (s *Server) handleAdminGetFooter(w http.ResponseWriter, r *http.Request) {
	f, err := s.site.Footer(r.Context())
	if err != nil {
		f = &site.Footer{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"footer": f})
}

func (s *Server) handleAdminSaveFooter(w http.ResponseWriter, r *http.Request) {
	var req site.Footer
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体格式错误")
		return
	}
	old, _ := s.site.Footer(r.Context())
	if err := s.site.SaveFooter(r.Context(), &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	// 图标被替换/清空后清理旧文件
	if old != nil {
		if old.ICPIcon != req.ICPIcon {
			s.releaseAndCleanup(r, old.ICPIcon, "site", "footer_icon", "icp")
		}
		if old.PoliceIcon != req.PoliceIcon {
			s.releaseAndCleanup(r, old.PoliceIcon, "site", "footer_icon", "police")
		}
	}
	s.attachUploadedMedia(
		r, principalFromRequest(r), req.ICPIcon, "site", "footer_icon", "icp",
	)
	s.attachUploadedMedia(
		r, principalFromRequest(r), req.PoliceIcon, "site", "footer_icon", "police",
	)
	writeJSON(w, http.StatusOK, map[string]string{"ok": "true"})
}

// ---------- admin: logo ----------

func (s *Server) handleAdminGetLogo(w http.ResponseWriter, r *http.Request) {
	url, err := s.site.Logo(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"logo_url": url})
}

func (s *Server) handleAdminSaveLogo(w http.ResponseWriter, r *http.Request) {
	var req struct {
		LogoURL string `json:"logo_url"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体格式错误")
		return
	}
	url := strings.TrimSpace(req.LogoURL)
	old, _ := s.site.Logo(r.Context())
	if err := s.site.SaveLogo(r.Context(), url); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if old != "" && old != url {
		s.releaseAndCleanup(r, old, "site", "logo", "1")
	}
	s.attachUploadedMedia(
		r, principalFromRequest(r), url, "site", "logo", "1",
	)
	writeJSON(w, http.StatusOK, map[string]any{"ok": "true", "logo_url": url})
}
