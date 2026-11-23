package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"szyca/backend/core/access"
	"szyca/backend/core/media"
)

func (s *Server) handleAdminMedia(w http.ResponseWriter, r *http.Request) {
	assets, err := s.media.List(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"assets": assets})
}

func (s *Server) handleAdminDeleteMedia(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeErr(w, http.StatusBadRequest, "媒体 ID 无效")
		return
	}
	path, err := s.media.DeleteAsset(r.Context(), id)
	if errors.Is(err, media.ErrInUse) {
		writeErrCode(w, http.StatusConflict, err.Error(), "media_in_use")
		return
	}
	if errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, http.StatusNotFound, "媒体不存在")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.removeUploadFile(path)
	writeJSON(w, http.StatusOK, map[string]string{"ok": "true"})
}

func (s *Server) attachUploadedMedia(
	r *http.Request,
	principal access.Principal,
	urlPath, module, resourceType, resourceID string,
) {
	if !strings.HasPrefix(urlPath, "/uploads/") {
		return
	}
	checksum, mime := fileMetadata(filepath.Join(s.cfg.UploadDir, filepath.Base(urlPath)))
	if _, err := s.media.Attach(
		r.Context(), principal.ID, urlPath, mime, checksum,
		module, resourceType, resourceID,
	); err != nil {
		log.Printf("attach media %s: %v", urlPath, err)
	}
}

func (s *Server) releaseUploadedMedia(
	r *http.Request,
	urlPath, module, resourceType, resourceID string,
) {
	if !strings.HasPrefix(urlPath, "/uploads/") {
		return
	}
	if err := s.media.Release(
		r.Context(), urlPath, module, resourceType, resourceID,
	); err != nil {
		log.Printf("release media %s: %v", urlPath, err)
	}
}

func (s *Server) releaseAndCleanup(
	r *http.Request,
	urlPath, module, resourceType, resourceID string,
) {
	if !strings.HasPrefix(urlPath, "/uploads/") {
		return
	}
	s.releaseUploadedMedia(r, urlPath, module, resourceType, resourceID)
	referenced, err := s.media.HasReferences(r.Context(), urlPath)
	if err != nil {
		log.Printf("check media references %s: %v", urlPath, err)
		return
	}
	if !referenced {
		s.removeUploadFile(urlPath)
	}
}

func (s *Server) assertMediaUnreferenced(
	r *http.Request,
	urlPath, module, resourceType, resourceID string,
) error {
	if !strings.HasPrefix(urlPath, "/uploads/") {
		return nil
	}
	return s.media.AssertUnreferenced(
		r.Context(), urlPath, module, resourceType, resourceID,
	)
}

func fileMetadata(path string) (checksum, mime string) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", "application/octet-stream"
	}
	sum := sha256.Sum256(raw)
	head := raw
	if len(head) > 512 {
		head = head[:512]
	}
	return hex.EncodeToString(sum[:]), http.DetectContentType(head)
}
