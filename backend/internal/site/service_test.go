package site

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestPublicNavigationFollowsFeatureFlags(t *testing.T) {
	nav := publicNav(map[string]bool{
		FeatureJoin:    true,
		FeatureQuiz:    true,
		FeatureLottery: false,
		FeatureScreen:  true,
	})
	var paths []string
	for _, item := range nav {
		paths = append(paths, item.To)
	}
	got := strings.Join(paths, ",")
	want := "/,/join,/quiz,/screen"
	if got != want {
		t.Fatalf("navigation = %q, want %q", got, want)
	}
}

func TestValidateSectionConfigRejectsUnsafeContent(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
	}{
		{
			name: "valid",
			raw:  `{"eyebrow":"社团","title":"标题","action_label":"进入","action_to":"/quiz"}`,
		},
		{
			name: "html",
			raw:  `{"title":"<script>alert(1)</script>"}`,
			want: "HTML",
		},
		{
			name: "external path",
			raw:  `{"action_to":"https://example.com"}`,
			want: "站内路径",
		},
		{
			name: "unknown field",
			raw:  `{"raw_text":"unsafe"}`,
			want: "未知字段",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := validateSectionConfig(json.RawMessage(test.raw))
			if test.want == "" {
				if err != nil {
					t.Fatalf("valid config rejected: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("error = %v, want substring %q", err, test.want)
			}
		})
	}
}
