package quiz

import (
	"bytes"
	"encoding/csv"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"szyca/backend/contract"
	"szyca/backend/core/httpx"
)

func (m *module) RegisterHTTP(mux *http.ServeMux, api contract.HTTP) error {
	mux.HandleFunc("GET /api/stats", api.Feature("quiz", func(w http.ResponseWriter, r *http.Request) {
		m.handleStats(w, r, api)
	}))
	mux.HandleFunc("POST /api/identity/abandon", api.Feature("quiz", m.handleAbandonIdentity))
	mux.HandleFunc("GET /api/identity/current", api.Feature("quiz", m.handleCurrentIdentity))
	mux.HandleFunc("GET /api/identity/status", api.Feature("quiz", m.handleIdentityStatus))
	mux.HandleFunc("POST /api/session", api.Feature("quiz", m.handleSession))

	mux.HandleFunc("POST /api/quiz/round", api.Feature("quiz", api.User(m.handleStartRound)))
	mux.HandleFunc("POST /api/quiz/round/abandon", api.Feature("quiz", api.User(m.handleAbandonRound)))
	mux.HandleFunc("GET /api/quiz/current", api.Feature("quiz", api.User(m.handleCurrentRound)))
	mux.HandleFunc("POST /api/answer", api.Feature("quiz", api.User(m.handleAnswer)))
	mux.HandleFunc("GET /api/me", api.Feature("quiz", api.User(m.handleMe)))

	mux.HandleFunc("POST /api/admin/quiz-state", api.Permission("quiz.operate", func(
		w http.ResponseWriter,
		r *http.Request,
		_ contract.Principal,
	) {
		m.handleAdminState(w, r)
	}))
	mux.HandleFunc("GET /api/admin/export/scores", api.Permission("scores.read", func(
		w http.ResponseWriter,
		r *http.Request,
		_ contract.Principal,
	) {
		m.handleAdminExportScores(w, r)
	}))
	mux.HandleFunc("POST /api/admin/questions/import", api.Permission("quiz.write", func(
		w http.ResponseWriter,
		r *http.Request,
		_ contract.Principal,
	) {
		m.handleAdminImportQuestions(w, r)
	}))
	mux.HandleFunc("GET /api/admin/questions/template", api.Permission("quiz.read", func(
		w http.ResponseWriter,
		r *http.Request,
		_ contract.Principal,
	) {
		m.handleAdminQuestionsTemplate(w, r)
	}))
	mux.HandleFunc("GET /api/admin/questions", api.Permission("quiz.read", func(
		w http.ResponseWriter,
		r *http.Request,
		_ contract.Principal,
	) {
		m.handleAdminListQuestions(w, r)
	}))
	mux.HandleFunc("POST /api/admin/questions", api.Permission("quiz.write", func(
		w http.ResponseWriter,
		r *http.Request,
		_ contract.Principal,
	) {
		m.handleAdminCreateQuestion(w, r)
	}))
	mux.HandleFunc("DELETE /api/admin/questions", api.Permission("quiz.write", func(
		w http.ResponseWriter,
		r *http.Request,
		_ contract.Principal,
	) {
		m.handleAdminClearQuestions(w, r)
	}))
	mux.HandleFunc("POST /api/admin/questions/{id}/active", api.Permission("quiz.write", func(
		w http.ResponseWriter,
		r *http.Request,
		_ contract.Principal,
	) {
		m.handleAdminSetActive(w, r)
	}))
	return nil
}

func (m *module) handleCurrentIdentity(w http.ResponseWriter, r *http.Request) {
	deviceFP := r.URL.Query().Get("device_fp")
	if deviceFP == "" {
		httpx.WriteError(w, http.StatusBadRequest, "缺少 device_fp")
		return
	}
	user, err := m.service.BoundIdentity(r.Context(), deviceFP)
	if errors.Is(err, ErrNotFound) || user == nil {
		httpx.WriteJSON(w, http.StatusNotFound, map[string]string{"error": "未绑定身份"})
		return
	}
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"nickname": user.Nickname, "user_id": user.ID})
}

func (m *module) handleIdentityStatus(w http.ResponseWriter, r *http.Request) {
	deviceFP := r.URL.Query().Get("device_fp")
	if deviceFP == "" {
		httpx.WriteJSON(w, http.StatusOK, map[string]bool{"bound": false})
		return
	}
	user, err := m.service.BoundIdentity(r.Context(), deviceFP)
	if errors.Is(err, ErrNotFound) || user == nil {
		httpx.WriteJSON(w, http.StatusOK, map[string]bool{"bound": false})
		return
	}
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"bound": true, "nickname": user.Nickname, "user_id": user.ID,
	})
}

func (m *module) handleAbandonIdentity(w http.ResponseWriter, r *http.Request) {
	var request struct {
		DeviceFP string `json:"device_fp"`
	}
	_ = httpx.ReadJSON(r, &request)
	token := requestToken(r)
	if token != "" {
		user, err := m.service.ValidateToken(r.Context(), token)
		if err != nil {
			httpx.WriteError(w, http.StatusUnauthorized, "token 无效")
			return
		}
		if err := m.service.Abandon(r.Context(), user.ID, request.DeviceFP); err != nil {
			httpx.WriteError(w, http.StatusForbidden, err.Error())
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]string{"ok": "true"})
		return
	}
	if request.DeviceFP == "" {
		httpx.WriteError(w, http.StatusBadRequest, "缺少 token 或 device_fp")
		return
	}
	if err := m.service.AbandonByDeviceFP(r.Context(), request.DeviceFP); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"ok": "true"})
}

func (m *module) handleStats(w http.ResponseWriter, r *http.Request, api contract.HTTP) {
	stats, err := m.service.Stats(r.Context())
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"participants": stats.Participants,
		"attempts":     stats.Attempts,
		"questions":    stats.Questions,
		"online":       api.OnlineCount(),
	})
}

func (m *module) handleSession(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Nickname string `json:"nickname"`
		DeviceFP string `json:"device_fp"`
	}
	if err := httpx.ReadJSON(r, &request); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "请求体格式错误")
		return
	}
	user, recovered, err := m.service.StartSession(r.Context(), request.Nickname, request.DeviceFP)
	if errors.Is(err, ErrIdentityBound) {
		httpx.WriteJSON(w, http.StatusConflict, map[string]string{
			"error": err.Error(), "code": "identity_bound",
		})
		return
	}
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"user_id": user.ID, "token": user.Token, "nickname": user.Nickname, "recovered": recovered,
	})
}

func (m *module) quizLimit() int {
	if m.cfg.QuizCount <= 0 {
		return 10
	}
	return m.cfg.QuizCount
}

func (m *module) handleStartRound(w http.ResponseWriter, r *http.Request, user contract.User) {
	var request struct {
		Difficulty string `json:"difficulty"`
	}
	_ = httpx.ReadJSON(r, &request)
	if request.Difficulty == "" {
		request.Difficulty = "全部"
	}
	roundNo, questions, deadline, err := m.service.StartRound(
		r.Context(), user.ID, request.Difficulty, m.quizLimit(),
	)
	if err != nil {
		if errors.Is(err, ErrBadRequest) || errors.Is(err, ErrNoQuestions) {
			httpx.WriteError(w, http.StatusBadRequest, err.Error())
			return
		}
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"round_no": roundNo, "questions": questions,
		"question_seconds": m.cfg.QuestionSeconds, "question_deadline": deadline,
	})
}

func (m *module) handleAbandonRound(w http.ResponseWriter, r *http.Request, user contract.User) {
	deleted, err := m.service.AbandonRound(r.Context(), user.ID)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": "true", "deleted": deleted})
}

func (m *module) handleCurrentRound(w http.ResponseWriter, r *http.Request, user contract.User) {
	roundNo, questions, answered, deadline, err := m.service.CurrentRound(r.Context(), user.ID)
	if errors.Is(err, ErrNoRound) {
		httpx.WriteError(w, http.StatusNotFound, err.Error())
		return
	}
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"round_no": roundNo, "questions": questions,
		"question_seconds": m.cfg.QuestionSeconds, "question_deadline": deadline,
		"answered": answered,
	})
}

func (m *module) handleAnswer(w http.ResponseWriter, r *http.Request, user contract.User) {
	var request struct {
		RequestID  string `json:"request_id"`
		QuestionID int64  `json:"question_id"`
		Selected   *int   `json:"selected"`
	}
	if err := httpx.ReadJSON(r, &request); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "请求体格式错误")
		return
	}
	attempt, correctIndex, duplicate, nextDeadline, err := m.service.Submit(
		r.Context(), user.ID, request.RequestID, request.QuestionID, request.Selected,
	)
	switch {
	case errors.Is(err, ErrQuizNotStarted), errors.Is(err, ErrNoRound):
		httpx.WriteError(w, http.StatusConflict, err.Error())
		return
	case errors.Is(err, ErrQuestionClosed), errors.Is(err, ErrQuestionExpired):
		httpx.WriteError(w, http.StatusGone, err.Error())
		return
	case errors.Is(err, ErrQuestionOrder), errors.Is(err, ErrQuestionTaken):
		httpx.WriteError(w, http.StatusConflict, err.Error())
		return
	case errors.Is(err, ErrBadRequest):
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	case errors.Is(err, ErrNotFound):
		httpx.WriteError(w, http.StatusNotFound, "题目不存在")
		return
	case err != nil:
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"correct": attempt.Correct, "correct_answer": correctIndex,
		"score": attempt.Score, "request_id": attempt.RequestID,
		"duplicate": duplicate, "next_deadline": nextDeadline,
	})
}

func (m *module) handleMe(w http.ResponseWriter, r *http.Request, user contract.User) {
	stats, err := m.service.MyStats(r.Context(), user.ID)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, stats)
}

func (m *module) handleAdminState(w http.ResponseWriter, r *http.Request) {
	var request struct {
		State string `json:"state"`
	}
	if err := httpx.ReadJSON(r, &request); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "请求体格式错误")
		return
	}
	if err := m.service.SetState(r.Context(), request.State); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"ok": "true", "state": request.State})
}

func (m *module) handleAdminListQuestions(w http.ResponseWriter, r *http.Request) {
	questions, err := m.service.AllQuestions(r.Context())
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"questions": questions})
}

func (m *module) handleAdminCreateQuestion(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Content    string   `json:"content"`
		Options    []string `json:"options"`
		Answer     int      `json:"answer"`
		Score      int      `json:"score"`
		Sort       int      `json:"sort"`
		Difficulty string   `json:"difficulty"`
	}
	if err := httpx.ReadJSON(r, &request); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "请求体格式错误")
		return
	}
	question, err := m.service.CreateQuestion(
		r.Context(), request.Content, request.Options, request.Answer,
		request.Score, request.Sort, request.Difficulty,
	)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, question)
}

func (m *module) handleAdminSetActive(w http.ResponseWriter, r *http.Request) {
	id, err := httpx.ParseID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "id 无效")
		return
	}
	var request struct {
		Active bool `json:"active"`
	}
	if err := httpx.ReadJSON(r, &request); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "请求体格式错误")
		return
	}
	if err := m.service.SetQuestionActive(r.Context(), id, request.Active); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"id": id, "active": request.Active})
}

func (m *module) handleAdminClearQuestions(w http.ResponseWriter, r *http.Request) {
	deleted, err := m.service.ClearQuestions(r.Context())
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"questions_deleted": deleted})
}

func (m *module) handleAdminExportScores(w http.ResponseWriter, r *http.Request) {
	rows, err := m.service.ExportScores(r.Context())
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	var buffer bytes.Buffer
	buffer.WriteString("\xEF\xBB\xBF")
	writer := csv.NewWriter(&buffer)
	_ = writer.Write([]string{"排名", "昵称", "答对", "已答", "得分", "用时(秒)", "轮数", "状态", "注册时间"})
	for _, row := range rows {
		rank := "-"
		if row.Rank > 0 {
			rank = strconv.FormatInt(row.Rank, 10)
		}
		status := "活跃"
		if row.Abandoned {
			status = "已放弃"
		}
		_ = writer.Write([]string{
			rank, httpx.CSVSafe(row.Nickname),
			strconv.Itoa(row.Correct), strconv.Itoa(row.Answered), strconv.Itoa(row.Score),
			fmt.Sprintf("%.1f", float64(row.ElapsedMS)/1000), strconv.Itoa(row.Rounds),
			status, row.CreatedAt.Format("2006-01-02 15:04"),
		})
	}
	writer.Flush()
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set(
		"Content-Disposition",
		fmt.Sprintf(`attachment; filename="scores-%s.csv"`, time.Now().Format("20060102-150405")),
	)
	_, _ = w.Write(buffer.Bytes())
}

func (m *module) handleAdminQuestionsTemplate(w http.ResponseWriter, r *http.Request) {
	var buffer bytes.Buffer
	buffer.WriteString("\xEF\xBB\xBF")
	writer := csv.NewWriter(&buffer)
	_ = writer.Write([]string{"题目", "选项A", "选项B", "选项C", "选项D", "选项E", "选项F", "正确答案", "难度", "分值"})
	_ = writer.Write([]string{"示例：二进制 1010 对应的十进制是？", "8", "9", "10", "12", "", "", "C", "容易", "10"})
	writer.Flush()
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="questions-template.csv"`)
	_, _ = w.Write(buffer.Bytes())
}

func (m *module) handleAdminImportQuestions(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 5<<20)
	if err := r.ParseMultipartForm(5 << 20); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "文件过大或格式错误（上限 5MB）")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "缺少 file 字段")
		return
	}
	defer file.Close()
	records, err := csv.NewReader(file).ReadAll()
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "CSV 解析失败："+err.Error())
		return
	}
	imported := 0
	failed := []map[string]any{}
	for index, record := range records {
		if len(record) == 0 {
			continue
		}
		line := index + 1
		if index == 0 && strings.Contains(record[0], "题目") {
			continue
		}
		content := strings.TrimSpace(record[0])
		if content == "" || strings.HasPrefix(content, "示例") {
			continue
		}
		options := []string{}
		for _, option := range record[1:min(7, len(record))] {
			if strings.TrimSpace(option) != "" {
				options = append(options, strings.TrimSpace(option))
			}
		}
		answerColumn := ""
		difficulty := "简单"
		score := 10
		if len(record) > 7 {
			answerColumn = strings.TrimSpace(record[7])
		} else if len(record) > 1 {
			answerColumn = strings.TrimSpace(record[len(record)-1])
		}
		if len(record) > 8 && strings.TrimSpace(record[8]) != "" {
			difficulty = strings.TrimSpace(record[8])
		}
		if len(record) > 9 {
			if value, err := strconv.Atoi(strings.TrimSpace(record[9])); err == nil && value > 0 {
				score = value
			}
		}
		answerIndex := -1
		if upper := strings.ToUpper(answerColumn); len(upper) == 1 && upper[0] >= 'A' && upper[0] <= 'F' {
			answerIndex = int(upper[0] - 'A')
		} else if value, err := strconv.Atoi(answerColumn); err == nil {
			answerIndex = value
		}
		if _, err := m.service.CreateQuestion(
			r.Context(), content, options, answerIndex, score, 0, difficulty,
		); err != nil {
			failed = append(failed, map[string]any{"line": line, "error": err.Error()})
			continue
		}
		imported++
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"imported": imported, "failed": failed})
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

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
