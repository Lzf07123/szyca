package httpapi

import (
	"testing"

	"szyca/internal/appmodule"
)

func TestAPIRouteModulesReferenceRegisteredManifests(t *testing.T) {
	seen := map[string]bool{}
	for _, module := range apiRouteModules() {
		if seen[module.key] {
			t.Fatalf("duplicate API route module %q", module.key)
		}
		seen[module.key] = true
		if _, ok := appmodule.Get(module.key); !ok {
			t.Fatalf("API route module %q has no application manifest", module.key)
		}
	}
}

func TestCoreAndModuleRoutePatternsDoNotCollide(t *testing.T) {
	server := &Server{}
	_ = server.Handler()
}
