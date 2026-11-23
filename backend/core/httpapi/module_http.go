package httpapi

import (
	"net/http"
	"strings"

	"szyca/backend/contract"
	"szyca/backend/core/access"
)

func (s *Server) Feature(feature string, next http.HandlerFunc) http.HandlerFunc {
	return s.withFeature(feature, next)
}

func (s *Server) AnyFeature(features []string, next http.HandlerFunc) http.HandlerFunc {
	return s.withAnyFeature(features, next)
}

func (s *Server) User(next func(http.ResponseWriter, *http.Request, contract.User)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := requestToken(r)
		if token == "" {
			writeErr(w, http.StatusUnauthorized, "缺少 token")
			return
		}
		user, err := s.identity.ValidateToken(r.Context(), token)
		if err != nil {
			writeErr(w, http.StatusUnauthorized, err.Error())
			return
		}
		next(w, r, user)
	}
}

func (s *Server) OptionalUser(r *http.Request) (*contract.User, error) {
	token := requestToken(r)
	if token == "" {
		return nil, nil
	}
	user, err := s.identity.ValidateToken(r.Context(), token)
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (s *Server) Authenticated(
	next func(http.ResponseWriter, *http.Request, contract.Principal),
) http.HandlerFunc {
	return s.withAuthenticated(func(w http.ResponseWriter, r *http.Request, principal access.Principal) {
		next(w, r, contractPrincipal(principal))
	})
}

func (s *Server) Permission(
	permission string,
	next func(http.ResponseWriter, *http.Request, contract.Principal),
) http.HandlerFunc {
	return s.withAuthenticated(func(w http.ResponseWriter, r *http.Request, principal access.Principal) {
		if !access.Can(principal, permission) {
			writeErrCode(w, http.StatusForbidden, "当前角色无权执行该操作", "forbidden")
			return
		}
		s.auditWrite(principal, func(w http.ResponseWriter, r *http.Request) {
			next(w, r, contractPrincipal(principal))
		}).ServeHTTP(w, r)
	})
}

func (s *Server) Audit(principal contract.Principal, next http.HandlerFunc) http.HandlerFunc {
	return s.auditWrite(accessPrincipal(principal), next)
}

func (s *Server) ValidateToken(token string) bool {
	return s.validateToken(token)
}

func (s *Server) WSAllowedOrigins() []string {
	return append([]string(nil), s.cfg.WSAllowedOrigins...)
}

func (s *Server) OnlineCount() int64 {
	_, online := s.hub.ClientCounts()
	return int64(online)
}

func (s *Server) SaveImage(w http.ResponseWriter, r *http.Request) (string, bool) {
	return s.saveUploadedImage(w, r)
}

func (s *Server) RemoveFile(path string) {
	s.removeUploadFile(path)
}

func (s *Server) AttachMedia(
	r *http.Request,
	principal contract.Principal,
	urlPath, module, resourceType, resourceID string,
) {
	s.attachUploadedMedia(r, accessPrincipal(principal), urlPath, module, resourceType, resourceID)
}

func (s *Server) ReleaseAndCleanup(
	r *http.Request,
	urlPath, module, resourceType, resourceID string,
) {
	s.releaseAndCleanup(r, urlPath, module, resourceType, resourceID)
}

func (s *Server) AssertMediaUnreferenced(
	r *http.Request,
	urlPath, module, resourceType, resourceID string,
) error {
	return s.assertMediaUnreferenced(r, urlPath, module, resourceType, resourceID)
}

func contractPrincipal(principal access.Principal) contract.Principal {
	return contract.Principal{
		ID: principal.ID, Username: principal.Username, Role: principal.Role,
		Capabilities: append([]string(nil), principal.Capabilities...),
		Legacy:       principal.Legacy,
	}
}

func accessPrincipal(principal contract.Principal) access.Principal {
	return access.Principal{
		ID: principal.ID, Username: principal.Username, Role: principal.Role,
		Capabilities: append([]string(nil), principal.Capabilities...),
		Legacy:       principal.Legacy,
	}
}

func requestToken(r *http.Request) string {
	if token := r.URL.Query().Get("token"); token != "" {
		return token
	}
	if header := r.Header.Get("Authorization"); strings.HasPrefix(header, "Bearer ") {
		return strings.TrimPrefix(header, "Bearer ")
	}
	return ""
}
