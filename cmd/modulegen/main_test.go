package main

import "testing"

func testManifest(key string, requires ...string) manifest {
	return manifest{
		Schema: 1, Key: key, Label: key, Feature: key, Path: "/" + key,
		FeatureWriteCapability: "site.write",
		Requires:               requires, Routes: []route{{Path: "/" + key, Feature: key}},
	}
}

func TestValidateRejectsDuplicateFeature(t *testing.T) {
	a := testManifest("quiz")
	b := testManifest("quiz-copy")
	b.Feature = "quiz"
	if err := validate([]manifest{a, b}); err == nil {
		t.Fatal("duplicate feature accepted")
	}
}

func TestValidateRejectsDependencyCycle(t *testing.T) {
	a := testManifest("quiz", "lottery")
	b := testManifest("lottery", "quiz")
	if err := validate([]manifest{a, b}); err == nil {
		t.Fatal("dependency cycle accepted")
	}
}

func TestValidateAcceptsTopologicalDependencies(t *testing.T) {
	if err := validate([]manifest{
		testManifest("quiz"),
		testManifest("lottery", "quiz"),
	}); err != nil {
		t.Fatal(err)
	}
}

func TestValidateRejectsMissingFeatureWriteCapability(t *testing.T) {
	module := testManifest("quiz")
	module.FeatureWriteCapability = ""
	if err := validate([]manifest{module}); err == nil {
		t.Fatal("public feature without write capability accepted")
	}
}

func TestValidateRejectsAdminPanelWithoutTab(t *testing.T) {
	module := testManifest("quiz")
	module.AdminPanels = []adminPanel{{
		Key: "missing", Tab: "not-registered", Label: "Missing", Permission: "quiz.read",
	}}
	if err := validate([]manifest{module}); err == nil {
		t.Fatal("admin panel without tab accepted")
	}
}
