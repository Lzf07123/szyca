package migrate

import (
	"strings"
	"testing"
)

func TestMigrationVersionsAreOrderedAndUnique(t *testing.T) {
	versions, err := loadVersions()
	if err != nil {
		t.Fatal(err)
	}
	if len(versions) < 3 {
		t.Fatalf("expected at least 3 migrations, got %d", len(versions))
	}
	seen := map[string]bool{}
	for index, version := range versions {
		if !strings.HasSuffix(version, ".sql") {
			t.Fatalf("migration %q must end in .sql", version)
		}
		if seen[version] {
			t.Fatalf("duplicate migration %q", version)
		}
		seen[version] = true
		if index > 0 && versions[index-1] >= version {
			t.Fatalf("migrations are not sorted: %q >= %q", versions[index-1], version)
		}
	}
}
