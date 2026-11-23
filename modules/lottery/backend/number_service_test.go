package lottery

import (
	"math/rand"
	"testing"
)

func TestNormalizeNumberEvent(t *testing.T) {
	normalized, err := normalizeNumberEvent(NumberEventInput{
		Name:        " 现场开奖 ",
		RangeStart:  "1",
		RangeEnd:    "999",
		NumberWidth: 3,
		Levels: []NumberLevelInput{
			{Name: "三等奖", WinnerCount: 20},
			{Name: "一等奖", WinnerCount: 5},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if normalized.name != "现场开奖" ||
		normalized.rangeStart != 1 ||
		normalized.rangeEnd != 999 ||
		normalized.numberWidth != 3 ||
		len(normalized.levels) != 2 {
		t.Fatalf("normalized event = %+v", normalized)
	}
}

func TestNormalizeNumberEventRejectsInvalidConfig(t *testing.T) {
	tests := []struct {
		name  string
		input NumberEventInput
	}{
		{
			name: "reversed range",
			input: NumberEventInput{
				Name: "开奖", RangeStart: "10", RangeEnd: "9",
				NumberWidth: 2, Levels: []NumberLevelInput{{Name: "一等奖", WinnerCount: 1}},
			},
		},
		{
			name: "short width",
			input: NumberEventInput{
				Name: "开奖", RangeStart: "1", RangeEnd: "999",
				NumberWidth: 2, Levels: []NumberLevelInput{{Name: "一等奖", WinnerCount: 1}},
			},
		},
		{
			name: "duplicate level",
			input: NumberEventInput{
				Name: "开奖", RangeStart: "1", RangeEnd: "10",
				NumberWidth: 2, Levels: []NumberLevelInput{
					{Name: "一等奖", WinnerCount: 1},
					{Name: "一等奖", WinnerCount: 1},
				},
			},
		},
		{
			name: "winner total above cap",
			input: NumberEventInput{
				Name: "开奖", RangeStart: "1", RangeEnd: "999",
				NumberWidth: 3, Levels: []NumberLevelInput{
					{Name: "一等奖", WinnerCount: 100},
					{Name: "二等奖", WinnerCount: 1},
				},
			},
		},
		{
			name: "winner count above range",
			input: NumberEventInput{
				Name: "开奖", RangeStart: "1", RangeEnd: "2",
				NumberWidth: 1, Levels: []NumberLevelInput{{Name: "一等奖", WinnerCount: 3}},
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := normalizeNumberEvent(test.input); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}

func TestRandomNumbersAreUniqueAndExcludePreviousWinners(t *testing.T) {
	service := &NumberService{random: rand.New(rand.NewSource(7))}
	excluded := map[int64]struct{}{2: {}, 5: {}}
	numbers, err := service.randomNumbers(1, 20, 10, excluded)
	if err != nil {
		t.Fatal(err)
	}
	if len(numbers) != 10 {
		t.Fatalf("generated %d numbers, want 10", len(numbers))
	}
	seen := map[int64]struct{}{}
	for _, number := range numbers {
		if number < 1 || number > 20 {
			t.Fatalf("number %d outside range", number)
		}
		if number == 2 || number == 5 {
			t.Fatalf("number %d was already excluded", number)
		}
		if _, exists := seen[number]; exists {
			t.Fatalf("duplicate number %d", number)
		}
		seen[number] = struct{}{}
	}
}

func TestFormatNumberUsesConfiguredWidth(t *testing.T) {
	if got := formatNumber(7, 3); got != "007" {
		t.Fatalf("formatNumber = %q, want 007", got)
	}
	if got := formatNumber(1000, 3); got != "1000" {
		t.Fatalf("formatNumber overflow = %q, want 1000", got)
	}
}

func TestValidatePersistedNumberEvent(t *testing.T) {
	event := numberEventRecord{
		RangeStart: 1,
		RangeEnd:   10,
	}
	if err := validatePersistedNumberEvent(event, []NumberLevelView{
		{Name: "一等奖", WinnerCount: 5},
		{Name: "二等奖", WinnerCount: 5},
	}); err != nil {
		t.Fatal(err)
	}
	if err := validatePersistedNumberEvent(event, []NumberLevelView{
		{Name: "一等奖", WinnerCount: 11},
	}); err == nil {
		t.Fatal("expected range overflow")
	}
}

func TestNormalizeNumberEventAllowsTwentyLevels(t *testing.T) {
	levels := make([]NumberLevelInput, 20)
	for index := range levels {
		levels[index] = NumberLevelInput{
			Name:        "等级" + string(rune('A'+index)),
			WinnerCount: 1,
		}
	}
	if _, err := normalizeNumberEvent(NumberEventInput{
		Name:        "二十等级",
		RangeStart:  "1",
		RangeEnd:    "100",
		NumberWidth: 3,
		Levels:      levels,
	}); err != nil {
		t.Fatal(err)
	}
	levels = append(levels, NumberLevelInput{Name: "超出", WinnerCount: 1})
	if _, err := normalizeNumberEvent(NumberEventInput{
		Name:        "二十一个等级",
		RangeStart:  "1",
		RangeEnd:    "100",
		NumberWidth: 3,
		Levels:      levels,
	}); err == nil {
		t.Fatal("expected 21 levels to be rejected")
	}
}
