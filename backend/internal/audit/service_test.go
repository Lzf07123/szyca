package audit

import (
	"strings"
	"testing"
)

func TestSanitizeJSONRedactsSensitiveFields(t *testing.T) {
	raw, err := sanitizeJSON(map[string]any{
		"username":      "editor",
		"password":      "do-not-log",
		"nested":        map[string]any{"csrf_token": "secret", "value": "ok"},
		"authorization": "Bearer secret",
	})
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	if strings.Contains(text, "do-not-log") || strings.Contains(text, "secret") {
		t.Fatalf("sensitive audit value leaked: %s", text)
	}
	if !strings.Contains(text, `"username":"editor"`) || !strings.Contains(text, `"value":"ok"`) {
		t.Fatalf("safe audit fields missing: %s", text)
	}
}
