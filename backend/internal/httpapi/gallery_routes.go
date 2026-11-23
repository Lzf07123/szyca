package httpapi

import (
	"fmt"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"szyca/internal/site"
)

func (s *Server) registerGalleryRoutes(mux *http.ServeMux) {
	mux.HandleFunc(
		"GET /api/admin/gallery/{sectionID}/images",
		s.withPermission("site.read", s.handleAdminGalleryImages),
	)
	mux.HandleFunc(
		"POST /api/admin/gallery/{sectionID}/images",
		s.withPermission("site.write", s.handleAdminUploadGalleryImage),
	)
	mux.HandleFunc(
		"POST /api/admin/gallery/{sectionID}/images/{imageID}",
		s.withPermission("site.write", s.handleAdminUpdateGalleryImage),
	)
	mux.HandleFunc(
		"DELETE /api/admin/gallery/{sectionID}/images/{imageID}",
		s.withPermission("site.write", s.handleAdminDeleteGalleryImage),
	)
	mux.HandleFunc(
		"PUT /api/admin/gallery/{sectionID}/images/order",
		s.withPermission("site.write", s.handleAdminReorderGalleryImages),
	)
}

func (s *Server) handleAdminGalleryImages(w http.ResponseWriter, r *http.Request) {
	sectionID, err := site.ParseID(r.PathValue("sectionID"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	images, err := s.site.GalleryImages(r.Context(), sectionID)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"images": images})
}

func (s *Server) handleAdminUploadGalleryImage(w http.ResponseWriter, r *http.Request) {
	sectionID, err := site.ParseID(r.PathValue("sectionID"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := s.site.GalleryImages(r.Context(), sectionID); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	imageURL, ok := s.saveUploadedImage(w, r)
	if !ok {
		return
	}
	title := r.FormValue("title")
	principal := principalFromRequest(r)
	image, err := s.site.CreateGalleryImage(
		r.Context(), principal.ID, sectionID, title, imageURL,
	)
	if err != nil {
		s.removeUploadFile(imageURL)
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.attachGalleryImageMedia(r, principal.ID, image); err != nil {
		_, _ = s.site.DeleteGalleryImage(r.Context(), sectionID, image.ID)
		s.removeUploadFile(imageURL)
		writeErr(w, http.StatusInternalServerError, "登记图片引用失败")
		return
	}
	writeJSON(w, http.StatusOK, image)
}

func (s *Server) handleAdminUpdateGalleryImage(w http.ResponseWriter, r *http.Request) {
	sectionID, imageID, ok := galleryPathIDs(w, r)
	if !ok {
		return
	}
	var request struct {
		Title string `json:"title"`
	}
	if err := readJSON(r, &request); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体格式错误")
		return
	}
	image, err := s.site.UpdateGalleryImage(r.Context(), sectionID, imageID, request.Title)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, image)
}

func (s *Server) handleAdminDeleteGalleryImage(w http.ResponseWriter, r *http.Request) {
	sectionID, imageID, ok := galleryPathIDs(w, r)
	if !ok {
		return
	}
	imageURL, err := s.site.DeleteGalleryImage(r.Context(), sectionID, imageID)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.releaseAndCleanup(
		r, imageURL, "gallery", "image", strconv.FormatInt(imageID, 10),
	)
	writeJSON(w, http.StatusOK, map[string]any{"id": imageID, "ok": "true"})
}

func (s *Server) handleAdminReorderGalleryImages(w http.ResponseWriter, r *http.Request) {
	sectionID, err := site.ParseID(r.PathValue("sectionID"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	var request struct {
		IDs []int64 `json:"ids"`
	}
	if err := readJSON(r, &request); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体格式错误")
		return
	}
	if err := s.site.ReorderGalleryImages(r.Context(), sectionID, request.IDs); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	images, err := s.site.GalleryImages(r.Context(), sectionID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"images": images})
}

func (s *Server) attachGalleryImageMedia(
	r *http.Request,
	actorID int64,
	image *site.GalleryImage,
) error {
	if image == nil || len(image.ImageURL) == 0 {
		return nil
	}
	if !strings.HasPrefix(image.ImageURL, "/uploads/") {
		return nil
	}
	checksum, mime := fileMetadata(filepath.Join(s.cfg.UploadDir, filepath.Base(image.ImageURL)))
	_, err := s.media.Attach(
		r.Context(),
		actorID,
		image.ImageURL,
		mime,
		checksum,
		"gallery",
		"image",
		strconv.FormatInt(image.ID, 10),
	)
	if err != nil {
		return fmt.Errorf("attach gallery media: %w", err)
	}
	return nil
}

func galleryPathIDs(w http.ResponseWriter, r *http.Request) (int64, int64, bool) {
	sectionID, err := site.ParseID(r.PathValue("sectionID"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return 0, 0, false
	}
	imageID, err := site.ParseID(r.PathValue("imageID"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return 0, 0, false
	}
	return sectionID, imageID, true
}
