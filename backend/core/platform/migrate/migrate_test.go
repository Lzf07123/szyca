package migrate

import (
	"crypto/sha256"
	"encoding/hex"
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

func TestHistoricalMigrationChecksumsRemainStable(t *testing.T) {
	migrations, err := loadMigrations()
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{
		"0001_quiz_baseline.sql":          "748ac4e4f0ca6ef909fcf378d2b381d2043e0cbfe3756bcc1c56f438243cf2c4",
		"0002_site_access_media.sql":      "4d320a9fee2e4dd23661a81b0845899b15e945b5f3ed29df1d1935682d38ed02",
		"0003_lottery.sql":                "ac92be88b0faa9ea5d46fc7c746088951f4e8a32951ed310ac45dab976fed8bc",
		"0004_section_plugins.sql":        "67ee02e5d9d52aee031f0fd00f3b2dcea4e4dfb1a623fd114f2882672135654c",
		"0005_gallery.sql":                "dcf0aa351c4e05e9d94a3cb4bfea10b69eb2e8a29ec597dbe881a0f57c964c1a",
		"202611240001_screen_section.sql": "6045da8e91f8ea324c0167f20bf540fb0b7f5c3646be320f08bade54174cf5ac",
	}
	for version, expected := range want {
		sql, ok := migrations[version]
		if !ok {
			t.Fatalf("migration %s missing", version)
		}
		sum := sha256.Sum256(sql)
		got := hex.EncodeToString(sum[:])
		if got != expected {
			t.Fatalf("migration %s checksum = %s, want %s", version, got, expected)
		}
	}
}
