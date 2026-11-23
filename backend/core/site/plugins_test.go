package site

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestBuiltinSectionPluginsAreRepeatable(t *testing.T) {
	registry := mustBuiltinSectionPluginRegistry(t)
	plugins := registry.List()
	if len(plugins) != 8 {
		t.Fatalf("built-in plugin count = %d, want 8", len(plugins))
	}
	for _, plugin := range plugins {
		if !plugin.Repeatable {
			t.Fatalf("built-in plugin %s must be repeatable", plugin.Key)
		}
		wantVersion := 1
		if plugin.Key == "gallery" {
			wantVersion = 2
		}
		if plugin.Version != wantVersion || plugin.Scope != "home" {
			t.Fatalf("plugin %s has invalid version/scope: %+v", plugin.Key, plugin)
		}
		if len(plugin.DefaultConfig) == 0 || len(plugin.Fields) == 0 {
			t.Fatalf("plugin %s is missing defaults or fields", plugin.Key)
		}
	}
}

func TestSectionPluginRegistryRejectsDuplicateKeys(t *testing.T) {
	plugins := builtinSectionPlugins()
	_, err := newSectionPluginRegistry(plugins[0], plugins[0])
	if err == nil || !strings.Contains(err.Error(), "duplicate") {
		t.Fatalf("duplicate key accepted: %v", err)
	}
}

func TestSectionPluginRegistryNormalizesItems(t *testing.T) {
	registry := mustBuiltinSectionPluginRegistry(t)
	raw := json.RawMessage(`{"items":[{"title":"技术分享"},{"title":"项目协作"}]}`)
	normalized, err := registry.NormalizeConfig("activities", raw)
	if err != nil {
		t.Fatal(err)
	}
	var config map[string]any
	if err := json.Unmarshal(normalized, &config); err != nil {
		t.Fatal(err)
	}
	items, ok := config["items"].([]any)
	if !ok || len(items) != 2 {
		t.Fatalf("items = %#v", config["items"])
	}
	if config["title"] != "活动类型" {
		t.Fatalf("defaults were not merged: %v", config)
	}

	tooMany := make([]any, 9)
	for index := range tooMany {
		tooMany[index] = map[string]any{"title": "tag"}
	}
	raw, _ = json.Marshal(map[string]any{"items": tooMany})
	if _, err := registry.NormalizeConfig("activities", raw); err == nil {
		t.Fatal("items above max_items were accepted")
	}

	if _, err := registry.NormalizeConfig(
		"activities",
		json.RawMessage(`{"items":[{"subtitle":"unknown"}]}`),
	); err == nil {
		t.Fatal("unknown item field was accepted")
	}
}

func TestSectionPluginManifestRejectsInvalidDefaults(t *testing.T) {
	manifest := builtinSectionPlugins()[1]
	manifest.DefaultConfig = json.RawMessage(`{"unknown":"value"}`)
	if _, err := newSectionPluginRegistry(manifest); err == nil {
		t.Fatal("invalid default_config was accepted")
	}
}

func TestGalleryPluginOwnsImagesOutsideSectionConfig(t *testing.T) {
	registry := mustBuiltinSectionPluginRegistry(t)
	plugin, ok := registry.Get("gallery")
	if !ok {
		t.Fatal("gallery plugin missing")
	}
	if plugin.Version != 2 {
		t.Fatalf("gallery plugin version = %d, want 2", plugin.Version)
	}
	var config map[string]any
	if err := json.Unmarshal(plugin.DefaultConfig, &config); err != nil {
		t.Fatal(err)
	}
	if _, exists := config["items"]; exists {
		t.Fatal("gallery default config must not contain images")
	}
	if _, ok := findConfigField(plugin.Fields, "items"); ok {
		t.Fatal("gallery plugin must not expose an items config field")
	}
}
