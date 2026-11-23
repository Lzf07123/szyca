package httpapi

import (
	"net/http"

	"szyca/internal/site"
)

func (s *Server) registerQuizRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/stats", s.withFeature(site.FeatureQuiz, s.handleStats))
	mux.HandleFunc("POST /api/identity/abandon", s.withFeature(site.FeatureQuiz, s.handleAbandonIdentity))
	mux.HandleFunc("GET /api/identity/current", s.withFeature(site.FeatureQuiz, s.handleCurrentIdentity))
	mux.HandleFunc("GET /api/identity/status", s.withFeature(site.FeatureQuiz, s.handleIdentityStatus))
	mux.HandleFunc("POST /api/session", s.withFeature(site.FeatureQuiz, s.handleSession))
	mux.HandleFunc("GET /api/rank", s.withFeature(site.FeatureQuiz, s.handleRank))

	mux.HandleFunc("POST /api/quiz/round", s.withFeature(site.FeatureQuiz, s.withUser(s.handleStartRound)))
	mux.HandleFunc("POST /api/quiz/round/abandon", s.withFeature(site.FeatureQuiz, s.withUser(s.handleAbandonRound)))
	mux.HandleFunc("GET /api/quiz/current", s.withFeature(site.FeatureQuiz, s.withUser(s.handleCurrentRound)))
	mux.HandleFunc("POST /api/answer", s.withFeature(site.FeatureQuiz, s.withUser(s.handleAnswer)))
	mux.HandleFunc("GET /api/me", s.withFeature(site.FeatureQuiz, s.withUser(s.handleMe)))

	mux.HandleFunc("POST /api/admin/quiz-state", s.withPermission("quiz.operate", s.handleAdminState))
	mux.HandleFunc("GET /api/admin/export/scores", s.withPermission("scores.read", s.handleAdminExportScores))
	mux.HandleFunc("POST /api/admin/questions/import", s.withPermission("quiz.write", s.handleAdminImportQuestions))
	mux.HandleFunc("GET /api/admin/questions/template", s.withPermission("quiz.read", s.handleAdminQuestionsTemplate))
	mux.HandleFunc("GET /api/admin/questions", s.withPermission("quiz.read", s.handleAdminListQuestions))
	mux.HandleFunc("POST /api/admin/questions", s.withPermission("quiz.write", s.handleAdminCreateQuestion))
	mux.HandleFunc("DELETE /api/admin/questions", s.withPermission("quiz.write", s.handleAdminClearQuestions))
	mux.HandleFunc("POST /api/admin/questions/{id}/active", s.withPermission("quiz.write", s.handleAdminSetActive))
}
