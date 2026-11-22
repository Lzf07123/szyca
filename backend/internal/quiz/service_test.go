package quiz

import (
	"slices"
	"testing"

	"stpt/quiz/internal/store"
)

func TestOrderedOptionsDeterministic(t *testing.T) {
	q := store.Question{
		ID:      42,
		Options: []string{"A", "B", "C", "D"},
		Answer:  2,
	}
	first := orderedOptions(q, 7, 3)
	second := orderedOptions(q, 7, 3)
	if !slices.Equal(first, second) {
		t.Fatalf("same user/round produced different option order: %v != %v", first, second)
	}
	if len(first) != len(q.Options) {
		t.Fatalf("option count changed: %d", len(first))
	}
	want := correctIndex(q, 7, 3)
	if want < 0 || first[want] != q.Options[q.Answer] {
		t.Fatalf("correctIndex pointed to the wrong option: %v", first)
	}
}

func TestDifficultyValidation(t *testing.T) {
	for _, difficulty := range []string{"全部", "容易", "简单", "困难"} {
		if !validDifficulty(difficulty) {
			t.Fatalf("%q should be valid", difficulty)
		}
	}
	for _, difficulty := range []string{"", "中等", "ALL"} {
		if validDifficulty(difficulty) {
			t.Fatalf("%q should be invalid", difficulty)
		}
	}
}

func TestNicknameBadWordFilter(t *testing.T) {
	if !containsBadWord("测试 SB 昵称") {
		t.Fatal("bad-word filter missed a spaced English variant")
	}
	if containsBadWord("计算机协会") {
		t.Fatal("bad-word filter rejected a normal nickname")
	}
}
