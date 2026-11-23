package site

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
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

func TestFilterPublicSectionsUsesPluginManifest(t *testing.T) {
	service := &Service{sectionPlugins: mustBuiltinSectionPluginRegistry(t)}
	sections := []Section{
		{ID: 1, Kind: "hero", PluginVersion: 1},
		{ID: 2, Kind: "quiz", PluginVersion: 1},
		{ID: 3, Kind: "join", PluginVersion: 1},
		{ID: 4, Kind: "quiz", PluginVersion: 2},
		{ID: 5, Kind: "not-installed", PluginVersion: 1},
	}
	filtered := service.filterPublicSections(sections, map[string]bool{
		FeatureQuiz: false,
		FeatureJoin: true,
	})
	if len(filtered) != 2 || filtered[0].ID != 1 || filtered[1].ID != 3 {
		t.Fatalf("filtered sections = %+v", filtered)
	}
}

func TestNormalizeSectionUpdateUsesPluginSchema(t *testing.T) {
	registry := mustBuiltinSectionPluginRegistry(t)
	tests := []struct {
		name   string
		update SectionUpdate
		want   string
	}{
		{
			name: "valid and fills defaults",
			update: SectionUpdate{
				Kind:   "quiz",
				Status: "draft",
				Config: json.RawMessage(`{"title":"社团答题","action_to":"/quiz"}`),
			},
		},
		{
			name: "unknown plugin",
			update: SectionUpdate{
				Kind: "not-installed", Status: "draft", Config: json.RawMessage(`{}`),
			},
			want: "不支持的 Section 插件",
		},
		{
			name: "unsupported version",
			update: SectionUpdate{
				Kind: "quiz", PluginVersion: 2, Status: "draft", Config: json.RawMessage(`{}`),
			},
			want: "版本",
		},
		{
			name: "html",
			update: SectionUpdate{
				Kind: "about", Status: "draft",
				Config: json.RawMessage(`{"title":"<script>alert(1)</script>"}`),
			},
			want: "HTML",
		},
		{
			name: "external path",
			update: SectionUpdate{
				Kind: "quiz", Status: "draft",
				Config: json.RawMessage(`{"action_to":"https://example.com"}`),
			},
			want: "站内路径",
		},
		{
			name: "unknown field",
			update: SectionUpdate{
				Kind: "about", Status: "draft",
				Config: json.RawMessage(`{"raw_text":"unsafe"}`),
			},
			want: "未知字段",
		},
		{
			name: "invalid time range",
			update: SectionUpdate{
				Kind: "hero", Status: "draft", Config: json.RawMessage(`{}`),
				StartsAt: timePointer(time.Date(2026, 11, 24, 0, 0, 0, 0, time.UTC)),
				EndsAt:   timePointer(time.Date(2026, 11, 23, 0, 0, 0, 0, time.UTC)),
			},
			want: "结束时间",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			update := test.update
			err := normalizeSectionUpdate(&update, registry)
			if test.want == "" {
				if err != nil {
					t.Fatalf("valid update rejected: %v", err)
				}
				if update.PluginVersion != 1 {
					t.Fatalf("plugin version = %d, want 1", update.PluginVersion)
				}
				var config map[string]any
				if err := json.Unmarshal(update.Config, &config); err != nil {
					t.Fatalf("normalized config is invalid JSON: %v", err)
				}
				if config["title"] != "社团答题" || config["action_label"] == "" {
					t.Fatalf("normalized config did not merge defaults: %v", config)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("error = %v, want substring %q", err, test.want)
			}
		})
	}
}

func TestValidateSectionMutations(t *testing.T) {
	registry := mustBuiltinSectionPluginRegistry(t)
	existing := map[int64]string{
		1: "hero",
		2: "about",
		3: "gallery",
	}
	tests := []struct {
		name     string
		updates  []SectionUpdate
		deletes  []int64
		existing map[int64]string
		want     string
	}{
		{
			name: "allow duplicate kinds",
			updates: []SectionUpdate{
				{ID: 0, Kind: "gallery"},
				{ID: 0, Kind: "gallery"},
				{ID: 0, Kind: "gallery"},
			},
		},
		{
			name:    "delete and recreate same kind",
			updates: []SectionUpdate{{ID: 0, Kind: "about"}},
			deletes: []int64{2},
		},
		{
			name:    "update and delete same id",
			updates: []SectionUpdate{{ID: 1, Kind: "hero"}},
			deletes: []int64{1},
			want:    "同时更新和删除",
		},
		{
			name:    "plugin kind is immutable",
			updates: []SectionUpdate{{ID: 1, Kind: "about"}},
			want:    "插件类型不可修改",
		},
		{
			name:    "missing delete target",
			deletes: []int64{99},
			want:    "不存在",
		},
		{
			name:     "existing duplicates are valid",
			existing: map[int64]string{1: "hero", 2: "hero"},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			current := test.existing
			if current == nil {
				current = existing
			}
			err := validateSectionMutations(test.updates, test.deletes, current, registry)
			if test.want == "" {
				if err != nil {
					t.Fatalf("changes rejected: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("error = %v, want substring %q", err, test.want)
			}
		})
	}
}

func TestValidateSectionMutationsHonorsPluginInstanceLimits(t *testing.T) {
	registry := mustBuiltinSectionPluginRegistry(t)
	manifest, ok := registry.Get("gallery")
	if !ok {
		t.Fatal("gallery plugin missing")
	}
	manifest.Repeatable = false
	manifest.MaxInstances = 1
	restricted, err := newSectionPluginRegistry(manifest)
	if err != nil {
		t.Fatal(err)
	}
	existing := map[int64]string{1: "gallery", 2: "gallery"}
	err = validateSectionMutations(nil, nil, existing, restricted)
	if err == nil || !strings.Contains(err.Error(), "不允许重复") {
		t.Fatalf("non-repeatable plugin accepted duplicate instances: %v", err)
	}
}

func TestNormalizeSectionDeletes(t *testing.T) {
	got, err := normalizeSectionDeletes([]int64{3, 2, 3})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0] != 3 || got[1] != 2 {
		t.Fatalf("delete ids = %v", got)
	}
	if _, err := normalizeSectionDeletes([]int64{1, -2}); err == nil {
		t.Fatal("negative section id accepted")
	}
}

func mustBuiltinSectionPluginRegistry(t *testing.T) *sectionPluginRegistry {
	t.Helper()
	registry, err := newSectionPluginRegistry(builtinSectionPlugins()...)
	if err != nil {
		t.Fatal(err)
	}
	return registry
}

func timePointer(value time.Time) *time.Time {
	return &value
}
