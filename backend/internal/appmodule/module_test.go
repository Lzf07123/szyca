package appmodule

import "testing"

func TestModuleKeysAndFeaturesAreUnique(t *testing.T) {
	keys := map[string]bool{}
	features := map[string]bool{}
	lastNavOrder := -1
	for _, manifest := range All() {
		if manifest.Key == "" {
			t.Fatal("module key must not be empty")
		}
		if keys[manifest.Key] {
			t.Fatalf("duplicate module key %q", manifest.Key)
		}
		keys[manifest.Key] = true
		if manifest.Feature != "" {
			if features[manifest.Feature] {
				t.Fatalf("duplicate feature %q", manifest.Feature)
			}
			features[manifest.Feature] = true
		}
		if manifest.NavLabel != "" {
			if manifest.NavOrder <= lastNavOrder {
				t.Fatalf("navigation order is not increasing for %q", manifest.Key)
			}
			lastNavOrder = manifest.NavOrder
		}
		if manifest.Path != "" && manifest.Feature == "" {
			t.Fatalf("public module %q must bind a feature", manifest.Key)
		}
	}
}

func TestFeatureKeysFollowManifest(t *testing.T) {
	got := FeatureKeys()
	want := []string{"join", "quiz", "lottery", "screen"}
	if len(got) != len(want) {
		t.Fatalf("feature keys = %v", got)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("feature keys = %v, want %v", got, want)
		}
		if !FeatureAllowed(want[index]) {
			t.Fatalf("feature %q is not allowed", want[index])
		}
	}
	if FeatureAllowed(KeyRealtime) {
		t.Fatal("internal realtime module must not be a public feature")
	}
}

func TestGalleryModuleIsInternalContentModule(t *testing.T) {
	manifest, ok := Get(KeyGallery)
	if !ok {
		t.Fatal("gallery module missing")
	}
	if manifest.Feature != "" || manifest.Path != "" {
		t.Fatalf("gallery module must not expose a feature or page: %+v", manifest)
	}
}
