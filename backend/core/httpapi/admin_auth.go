package httpapi

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"szyca/backend/core/access"
)

type principalContextKey struct{}

type principalHandler func(http.ResponseWriter, *http.Request, access.Principal)

func (s *Server) withAuthenticated(next principalHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ip := s.clientIP(r)
		var principal access.Principal
		viaCookie := false

		if legacy := r.Header.Get("X-Admin-Token"); legacy != "" && s.cfg.LegacyAdminToken {
			if !s.adminAllowed(ip) {
				w.Header().Set("Retry-After", "300")
				writeErrCode(w, http.StatusTooManyRequests, "后台口令尝试过多，请 5 分钟后重试", "rate_limited")
				return
			}
			expected := []byte(s.cfg.AdminPassword)
			got := []byte(legacy)
			if len(expected) == 0 || subtle.ConstantTimeCompare(got, expected) != 1 {
				s.recordAdminFailure(ip)
				writeErrCode(w, http.StatusUnauthorized, "后台口令错误", "invalid_credentials")
				return
			}
			s.clearAdminFailures(ip)
			principal = access.Principal{
				Username:     "legacy-owner",
				Role:         access.RoleOwner,
				Capabilities: []string{"*"},
				Legacy:       true,
			}
		} else {
			cookie, err := r.Cookie(s.cfg.AdminCookieName)
			if err != nil || cookie.Value == "" {
				writeErrCode(w, http.StatusUnauthorized, "请先登录后台", "unauthorized")
				return
			}
			loaded, err := s.access.Authenticate(r.Context(), cookie.Value)
			if err != nil {
				clearAdminCookie(w, s.cfg.AdminCookieName, s.cfg.AdminCookieSecure)
				writeErrCode(w, http.StatusUnauthorized, err.Error(), "unauthorized")
				return
			}
			principal = *loaded
			viaCookie = true
		}

		if viaCookie && isUnsafeMethod(r.Method) {
			if !s.sameOrigin(r) {
				writeErrCode(w, http.StatusForbidden, "请求 Origin 校验失败", "origin_rejected")
				return
			}
			cookie, _ := r.Cookie(s.cfg.AdminCookieName)
			if cookie == nil || !s.access.VerifyCSRF(
				r.Context(), cookie.Value, r.Header.Get("X-CSRF-Token"),
			) {
				writeErrCode(w, http.StatusForbidden, "CSRF 校验失败", "csrf_rejected")
				return
			}
		}
		ctx := context.WithValue(r.Context(), principalContextKey{}, principal)
		next(w, r.WithContext(ctx), principal)
	}
}

func (s *Server) withPermission(permission string, next http.HandlerFunc) http.HandlerFunc {
	return s.withAuthenticated(func(w http.ResponseWriter, r *http.Request, principal access.Principal) {
		if !access.Can(principal, permission) {
			writeErrCode(w, http.StatusForbidden, "当前角色无权执行该操作", "forbidden")
			return
		}
		s.auditWrite(principal, next).ServeHTTP(w, r)
	})
}

func (s *Server) auditWrite(principal access.Principal, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tracker := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(tracker, r)
		if !isUnsafeMethod(r.Method) {
			return
		}
		requestID := strings.TrimSpace(r.Header.Get("X-Request-ID"))
		if requestID == "" {
			requestID = randHex(12)
		}
		tracker.Header().Set("X-Request-ID", requestID)
		resourceType, resourceID := auditResource(r.URL.Path)
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		err := s.audit.Record(
			ctx,
			principal.ID,
			principal.Username,
			"admin."+strings.ToLower(r.Method),
			resourceType,
			resourceID,
			map[string]any{},
			map[string]any{
				"method": r.Method,
				"path":   r.URL.Path,
				"status": tracker.status,
			},
			requestID,
			s.clientIP(r),
		)
		if err != nil {
			log.Printf("audit write failed: %v", err)
		}
	}
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (s *Server) handleAdminLogin(w http.ResponseWriter, r *http.Request) {
	if !s.sameOrigin(r) {
		writeErrCode(w, http.StatusForbidden, "登录请求 Origin 校验失败", "origin_rejected")
		return
	}
	ip := s.clientIP(r)
	var request struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := readJSON(r, &request); err != nil {
		writeErrCode(w, http.StatusBadRequest, "请求体格式错误", "invalid_request")
		return
	}
	rateKey := "login:" + strings.ToLower(strings.TrimSpace(request.Username)) + "|" + ip
	if !s.adminAllowed(rateKey) {
		w.Header().Set("Retry-After", "300")
		writeErrCode(w, http.StatusTooManyRequests, "登录失败次数过多，请 5 分钟后重试", "rate_limited")
		return
	}
	session, err := s.access.Login(
		r.Context(),
		request.Username,
		request.Password,
		ip,
		r.UserAgent(),
	)
	if err != nil {
		s.recordAdminFailure(rateKey)
		status := http.StatusUnauthorized
		code := "invalid_credentials"
		message := "用户名或密码错误"
		if errors.Is(err, access.ErrAccountDisabled) {
			status = http.StatusForbidden
			code = "account_disabled"
			message = err.Error()
		}
		writeErrCode(w, status, message, code)
		return
	}
	s.clearAdminFailures(rateKey)
	http.SetCookie(w, &http.Cookie{
		Name:     s.cfg.AdminCookieName,
		Value:    session.Token,
		Path:     "/",
		HttpOnly: true,
		Secure:   s.cfg.AdminCookieSecure,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   s.cfg.AdminSessionHours * 3600,
	})
	_ = s.audit.Record(
		r.Context(),
		session.Principal.ID,
		session.Principal.Username,
		"admin.login",
		"admin_session",
		strconv.FormatInt(session.Principal.ID, 10),
		map[string]any{},
		map[string]any{"role": session.Principal.Role},
		randHex(12),
		ip,
	)
	writeJSON(w, http.StatusOK, map[string]any{
		"account":    session.Principal,
		"csrf_token": session.CSRF,
	})
}

func (s *Server) handleAdminMe(w http.ResponseWriter, r *http.Request, principal access.Principal) {
	csrfToken := ""
	if !principal.Legacy {
		if cookie, err := r.Cookie(s.cfg.AdminCookieName); err == nil {
			csrfToken, _ = s.access.RotateCSRF(r.Context(), cookie.Value)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"account":    principal,
		"csrf_token": csrfToken,
	})
}

func (s *Server) handleAdminAuthStatus(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(s.cfg.AdminCookieName)
	if err != nil || cookie.Value == "" {
		writeJSON(w, http.StatusOK, map[string]any{"account": nil, "csrf_token": ""})
		return
	}
	principal, err := s.access.Authenticate(r.Context(), cookie.Value)
	if err != nil {
		clearAdminCookie(w, s.cfg.AdminCookieName, s.cfg.AdminCookieSecure)
		writeJSON(w, http.StatusOK, map[string]any{"account": nil, "csrf_token": ""})
		return
	}
	csrfToken, err := s.access.RotateCSRF(r.Context(), cookie.Value)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"account": nil, "csrf_token": ""})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"account":    principal,
		"csrf_token": csrfToken,
	})
}

func (s *Server) handleAdminLogout(w http.ResponseWriter, r *http.Request, principal access.Principal) {
	if cookie, err := r.Cookie(s.cfg.AdminCookieName); err == nil {
		_ = s.access.Logout(r.Context(), cookie.Value)
	}
	_ = s.audit.Record(
		r.Context(),
		principal.ID,
		principal.Username,
		"admin.logout",
		"admin_session",
		strconv.FormatInt(principal.ID, 10),
		map[string]any{},
		map[string]any{},
		randHex(12),
		s.clientIP(r),
	)
	clearAdminCookie(w, s.cfg.AdminCookieName, s.cfg.AdminCookieSecure)
	writeJSON(w, http.StatusOK, map[string]string{"ok": "true"})
}

func (s *Server) handleAdminListAccounts(w http.ResponseWriter, r *http.Request) {
	accounts, err := s.access.ListAccounts(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"accounts": accounts})
}

func (s *Server) handleAdminCreateAccount(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Role     string `json:"role"`
	}
	if err := readJSON(r, &request); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体格式错误")
		return
	}
	account, err := s.access.CreateAccount(
		r.Context(), request.Username, request.Password, request.Role,
	)
	if errors.Is(err, access.ErrDuplicateAccount) {
		writeErrCode(w, http.StatusConflict, err.Error(), "duplicate_account")
		return
	}
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"account": account})
}

func (s *Server) handleAdminDisableAccount(w http.ResponseWriter, r *http.Request) {
	principal := principalFromRequest(r)
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeErr(w, http.StatusBadRequest, "管理员 ID 无效")
		return
	}
	var request struct {
		Disabled bool `json:"disabled"`
	}
	if err := readJSON(r, &request); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体格式错误")
		return
	}
	if err := s.access.SetAccountDisabled(r.Context(), principal, id, request.Disabled); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"ok": "true"})
}

func (s *Server) handleAdminAudit(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	entries, err := s.audit.List(r.Context(), limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries})
}

func (s *Server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		if origin != "" {
			w.Header().Add("Vary", "Origin")
			if !s.originMatches(r) {
				if r.Method == http.MethodOptions {
					writeErrCode(w, http.StatusForbidden, "CORS Origin 不被允许", "origin_rejected")
					return
				}
			} else {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
				w.Header().Set(
					"Access-Control-Allow-Headers",
					"Content-Type, Authorization, X-Admin-Token, X-CSRF-Token, X-Request-ID",
				)
			}
		}
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Max-Age", "600")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) sameOrigin(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return r.Method == http.MethodGet || r.Method == http.MethodHead
	}
	return s.originMatches(r)
}

func (s *Server) originMatches(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return false
	}
	host := r.Host
	if forwarded := strings.TrimSpace(r.Header.Get("X-Forwarded-Host")); forwarded != "" &&
		s.trustedRemote(r.RemoteAddr) {
		host = strings.TrimSpace(strings.Split(forwarded, ",")[0])
	}
	return strings.EqualFold(parsed.Host, host)
}

func (s *Server) clientIP(r *http.Request) string {
	remote := requestHost(r.RemoteAddr)
	if !s.trustedRemote(r.RemoteAddr) {
		return remote
	}
	forwarded := strings.TrimSpace(r.Header.Get("X-Forwarded-For"))
	if forwarded == "" {
		return remote
	}
	parts := strings.Split(forwarded, ",")
	for index := len(parts) - 1; index >= 0; index-- {
		candidate := strings.TrimSpace(parts[index])
		if net.ParseIP(candidate) != nil {
			return candidate
		}
	}
	return remote
}

func (s *Server) trustedRemote(remoteAddr string) bool {
	host := requestHost(remoteAddr)
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	for _, raw := range s.cfg.TrustedProxyCIDRs {
		_, network, err := net.ParseCIDR(raw)
		if err == nil && network.Contains(ip) {
			return true
		}
	}
	return false
}

func requestHost(remoteAddr string) string {
	if host, _, err := net.SplitHostPort(remoteAddr); err == nil {
		return host
	}
	return strings.Trim(remoteAddr, "[]")
}

func principalFromRequest(r *http.Request) access.Principal {
	principal, _ := r.Context().Value(principalContextKey{}).(access.Principal)
	return principal
}

func isUnsafeMethod(method string) bool {
	return method != http.MethodGet && method != http.MethodHead && method != http.MethodOptions
}

func clearAdminCookie(w http.ResponseWriter, name string, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   -1,
		Expires:  time.Unix(1, 0),
	})
}

func auditResource(path string) (string, string) {
	value := strings.TrimPrefix(path, "/api/admin/")
	if value == "" {
		return "admin", ""
	}
	parts := strings.FieldsFunc(value, func(r rune) bool { return r == '/' })
	if len(parts) == 0 {
		return "admin", ""
	}
	resourceID := ""
	for index := len(parts) - 1; index >= 0; index-- {
		if _, err := strconv.ParseInt(parts[index], 10, 64); err == nil {
			resourceID = parts[index]
			break
		}
	}
	return strings.Join(parts, "/"), resourceID
}

func jsonObject(raw []byte) map[string]any {
	var value map[string]any
	_ = json.Unmarshal(raw, &value)
	if value == nil {
		value = map[string]any{}
	}
	return value
}
