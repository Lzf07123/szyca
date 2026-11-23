package lottery

import (
	"bytes"
	"testing"
	"time"
)

func TestSelectPrizeUsesNoWinAndWeightedBuckets(t *testing.T) {
	prizeA := Prize{ID: 1, Name: "A", Remaining: 2, Weight: 3, Enabled: true}
	prizeB := Prize{ID: 2, Name: "B", Remaining: 2, Weight: 7, Enabled: true}

	noWinService := &Service{random: bytes.NewReader([]byte{0})}
	selected, err := noWinService.selectPrize([]Prize{prizeA, prizeB}, 100)
	if err != nil {
		t.Fatal(err)
	}
	if selected != nil {
		t.Fatalf("expected no-win, got %+v", selected)
	}

	prizeService := &Service{random: bytes.NewReader([]byte{5})}
	selected, err = prizeService.selectPrize([]Prize{prizeA, prizeB}, 0)
	if err != nil {
		t.Fatal(err)
	}
	if selected == nil || selected.ID != prizeB.ID {
		t.Fatalf("expected weighted prize B, got %+v", selected)
	}
}

func TestSelectPrizeSkipsOutOfStock(t *testing.T) {
	service := &Service{random: bytes.NewReader([]byte{2})}
	selected, err := service.selectPrize([]Prize{
		{ID: 1, Name: "empty", Remaining: 0, Weight: 100, Enabled: true},
		{ID: 2, Name: "available", Remaining: 1, Weight: 5, Enabled: true},
	}, 0)
	if err != nil {
		t.Fatal(err)
	}
	if selected == nil || selected.ID != 2 {
		t.Fatalf("expected stocked prize, got %+v", selected)
	}
}

func TestCampaignState(t *testing.T) {
	now := time.Date(2026, 11, 23, 12, 0, 0, 0, time.UTC)
	start := now.Add(-time.Hour)
	end := now.Add(time.Hour)
	campaign := Campaign{Status: "active", StartsAt: &start, EndsAt: &end}
	if got := campaignState(campaign, now); got != "active" {
		t.Fatalf("active state = %q", got)
	}
	start = now.Add(time.Hour)
	if got := campaignState(campaign, now); got != "upcoming" {
		t.Fatalf("upcoming state = %q", got)
	}
	campaign.Status = "paused"
	if got := campaignState(campaign, now); got != "paused" {
		t.Fatalf("paused state = %q", got)
	}
}

func TestCampaignValidation(t *testing.T) {
	start := time.Now()
	end := start.Add(-time.Minute)
	err := validateCampaign(CampaignInput{
		Name: "测试活动", Status: "active", Eligibility: "completed_round",
		StartsAt: &start, EndsAt: &end,
	})
	if err == nil {
		t.Fatal("expected invalid time range")
	}
}
