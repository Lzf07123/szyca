package modulecatalog

import "testing"

func TestCatalogContainsBusinessModulesAndSections(t *testing.T) {
	modules := All()
	if len(modules) != 6 {
		t.Fatalf("module count = %d, want 6", len(modules))
	}
	want := []string{"gallery", "join", "lottery", "quiz", "realtime", "screen"}
	for index, key := range want {
		if modules[index].Key != key {
			t.Fatalf("module[%d] = %s, want %s", index, modules[index].Key, key)
		}
	}
	sections := Sections()
	if len(sections) != 6 {
		t.Fatalf("section count = %d, want 6", len(sections))
	}
	layouts := map[string]string{}
	for _, section := range sections {
		layouts[section.Key] = section.Layout
	}
	for _, key := range []string{
		"quiz",
		"lottery",
		"lottery-participate",
		"join",
		"screen",
	} {
		if layouts[key] != "module-card" {
			t.Fatalf("%s layout = %q", key, layouts[key])
		}
	}
	if layouts["gallery"] != "block" {
		t.Fatalf("gallery layout = %q", layouts["gallery"])
	}
}

func TestFeatureAndCapabilityMetadata(t *testing.T) {
	wantFeatures := []string{"join", "lottery", "quiz", "screen"}
	features := FeatureKeys()
	if len(features) != len(wantFeatures) {
		t.Fatalf("features = %v", features)
	}
	for index, feature := range wantFeatures {
		if features[index] != feature {
			t.Fatalf("feature[%d] = %s, want %s", index, features[index], feature)
		}
	}
	if permission, err := FeatureWriteCapability("lottery"); err != nil || permission != "lottery.configure" {
		t.Fatalf("lottery write capability = %q, %v", permission, err)
	}
	grants := CapabilityGrants("event_operator")
	wantGrants := map[string]bool{
		"quiz.operate": true, "lottery.configure": true, "lottery.claim": true,
	}
	for _, grant := range grants {
		delete(wantGrants, grant)
	}
	if len(wantGrants) != 0 {
		t.Fatalf("missing event operator grants: %v; got %v", wantGrants, grants)
	}
}
