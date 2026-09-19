package engine

import (
	"testing"
	"time"

	"github.com/vektorfleet/backend/internal/domain"
	"github.com/vektorfleet/backend/internal/store"
)

func TestEvaluateItemBands(t *testing.T) {
	now := time.Date(2026, 3, 14, 9, 0, 0, 0, time.UTC)

	cases := []struct {
		name    string
		due     time.Time
		lead    int
		want    domain.ComplianceStatus
		wantDay int
	}{
		{"expired", now.AddDate(0, 0, -3), 30, domain.ComplianceExpired, -3},
		{"critical inside 7 days", now.AddDate(0, 0, 3), 30, domain.ComplianceCritical, 3},
		{"due soon inside lead", now.AddDate(0, 0, 20), 30, domain.ComplianceDueSoon, 20},
		{"ok beyond lead", now.AddDate(0, 0, 90), 30, domain.ComplianceOK, 90},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			item := domain.ComplianceItem{
				ID: "c1", VehicleID: "v1", Category: domain.CategoryNTASInspection,
				Title: "NTSA inspection", Authority: "NTSA", DueDate: tc.due,
				LeadDays: tc.lead, Notes: "fine exposure 5,000",
			}
			got := EvaluateItem(item, now)
			if got.Status != tc.want {
				t.Errorf("status = %s, want %s", got.Status, tc.want)
			}
			if got.DaysRemaining != tc.wantDay {
				t.Errorf("days remaining = %d, want %d", got.DaysRemaining, tc.wantDay)
			}
		})
	}
}

func TestFleetPostureIsInternallyConsistent(t *testing.T) {
	st := store.New(time.Date(2026, 3, 14, 9, 0, 0, 0, time.UTC))
	now := time.Date(2026, 3, 14, 9, 0, 0, 0, time.UTC)

	posture := FleetCompliancePosture(st, now)
	if posture.Total != posture.Expired+posture.Critical+posture.DueSoon+posture.OK {
		t.Errorf("band counts %d+%d+%d+%d != total %d",
			posture.Expired, posture.Critical, posture.DueSoon, posture.OK, posture.Total)
	}
	if posture.HealthyPercent < 0 || posture.HealthyPercent > 100 {
		t.Errorf("healthy percent out of range: %d", posture.HealthyPercent)
	}
	if posture.RiskScore < 0 || posture.RiskScore > 100 {
		t.Errorf("risk score out of range: %d", posture.RiskScore)
	}
	if posture.Total == 0 {
		t.Fatal("fixture produced no compliance items")
	}
	// The fixture deliberately plants urgent items so the console has work to show.
	if posture.Expired+posture.Critical == 0 {
		t.Error("expected at least one expired or critical item in the fixture")
	}
}

func TestAlertQueueIsSortedByDifficultyAndCarriesTier(t *testing.T) {
	st := store.New(time.Date(2026, 3, 14, 9, 0, 0, 0, time.UTC))
	now := time.Date(2026, 3, 14, 9, 0, 0, 0, time.UTC)

	alerts := BuildAlertQueue(st, now)
	if len(alerts) == 0 {
		t.Fatal("expected a non-empty alert queue")
	}
	for i := 1; i < len(alerts); i++ {
		if alerts[i].DaysRemaining < alerts[i-1].DaysRemaining {
			t.Errorf("alerts not sorted by urgency at index %d: %d after %d",
				i, alerts[i].DaysRemaining, alerts[i-1].DaysRemaining)
		}
	}
	for _, a := range alerts {
		switch a.Tier {
		case domain.Tier30, domain.Tier7, domain.Tier1, domain.TierOverdue:
		default:
			t.Errorf("unexpected alert tier %q", a.Tier)
		}
		if a.Channel != domain.ChannelWhatsApp && a.Channel != domain.ChannelSMS && a.Channel != domain.ChannelEmail {
			t.Errorf("unexpected alert channel %q", a.Channel)
		}
	}
}

func TestEvaluateAllForVehicle(t *testing.T) {
	st := store.New(time.Date(2026, 3, 14, 9, 0, 0, 0, time.UTC))
	now := time.Date(2026, 3, 14, 9, 0, 0, 0, time.UTC)

	vehicle := st.Vehicles()[0]
	evaluations := EvaluateAll(st, vehicle.ID, now)
	if len(evaluations) == 0 {
		t.Fatalf("expected compliance items for %s", vehicle.Plate)
	}
	for _, e := range evaluations {
		if e.VehicleID != vehicle.ID {
			t.Errorf("evaluation for wrong vehicle: %s", e.VehicleID)
		}
	}

	if got := EvaluateAll(st, "does-not-exist", now); len(got) != 0 {
		t.Errorf("expected no evaluations for an unknown vehicle, got %d", len(got))
	}
}

func TestWorstStatus(t *testing.T) {
	items := []domain.ComplianceEvaluation{
		{Status: domain.ComplianceOK},
		{Status: domain.ComplianceDueSoon},
		{Status: domain.ComplianceExpired},
	}
	if got := WorstStatus(items); got != domain.ComplianceExpired {
		t.Errorf("worst status = %s, want expired", got)
	}
	if got := WorstStatus(nil); got != domain.ComplianceOK {
		t.Errorf("worst status of nothing = %s, want ok", got)
	}
}
