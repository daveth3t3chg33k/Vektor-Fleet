package engine

import (
	"testing"
	"time"

	"github.com/vektorfleet/backend/internal/domain"
	"github.com/vektorfleet/backend/internal/store"
)

// newTestStore builds the deterministic fixture anchored to a fixed instant, so
// every assertion in this file is reproducible.
func newTestStore(t *testing.T) *store.Store {
	t.Helper()
	anchor := time.Date(2026, 3, 14, 9, 0, 0, 0, time.UTC)
	return store.New(anchor)
}

// cleanPlates are the fixture vehicles whose ledger genuinely adds up. The fraud
// engine must stay silent on them — a false positive on an honest driver costs
// more trust than a missed anomaly.
var cleanPlates = []string{"KDA 412M", "KDB 908T", "KDE 155L", "KCA 318P", "KCC 449G", "KCX 100A", "KCY 205C", "KCZ 330D", "KDZ 901E"}

func TestCleanVehiclesAreNotFlagged(t *testing.T) {
	st := newTestStore(t)
	for _, plate := range cleanPlates {
		vehicle, ok := st.VehicleByPlate(plate)
		if !ok {
			t.Fatalf("fixture missing clean vehicle %s", plate)
		}
		rec, ok := ReconcileVehicle(st, vehicle.ID, DefaultTuning)
		if !ok {
			t.Fatalf("no reconciliation for %s", plate)
		}
		if len(rec.Flags) != 0 {
			t.Errorf("%s expected zero flags, got %d: %+v", plate, len(rec.Flags), rec.Flags)
		}
		if rec.LeakagePercent > 3 {
			t.Errorf("%s expected leakage under 3%%, got %.1f%%", plate, rec.LeakagePercent)
		}
	}
}

func TestFraudProfilesAreCaught(t *testing.T) {
	st := newTestStore(t)

	cases := []struct {
		plate      string
		wantCodes  []domain.FlagCode
		profile    string
	}{
		{"KDC 233J", []domain.FlagCode{domain.FlagExcessLitres}, "siphon"},
		{"KDD 771V", []domain.FlagCode{domain.FlagOverfillImpossible}, "overfill"},
		{"KDF 604R", []domain.FlagCode{domain.FlagStationMismatch}, "phantom_station"},
		{"KCB 712K", []domain.FlagCode{domain.FlagGhostFill}, "ghost"},
		{"KCD 826B", []domain.FlagCode{domain.FlagCollusionPattern}, "collusion"},
	}

	for _, tc := range cases {
		vehicle, ok := st.VehicleByPlate(tc.plate)
		if !ok {
			t.Fatalf("fixture missing vehicle %s", tc.plate)
		}
		rec, ok := ReconcileVehicle(st, vehicle.ID, DefaultTuning)
		if !ok {
			t.Fatalf("no reconciliation for %s", tc.plate)
		}

		codes := map[domain.FlagCode]bool{}
		for _, f := range rec.Flags {
			codes[f.Code] = true
		}
		for _, want := range tc.wantCodes {
			if !codes[want] {
				t.Errorf("%s (%s) expected flag %s, got %v", tc.plate, tc.profile, want, codes)
			}
		}
		if rec.ExposureKes <= 0 {
			t.Errorf("%s (%s) expected positive exposure, got %.0f", tc.plate, tc.profile, rec.ExposureKes)
		}
	}
}

func TestFleetAuditTotalsAreInternallyConsistent(t *testing.T) {
	st := newTestStore(t)
	audit := AuditFleet(st, DefaultTuning)

	if len(audit.Reconciliations) != len(st.Vehicles()) {
		t.Errorf("expected one reconciliation per vehicle (%d), got %d", len(st.Vehicles()), len(audit.Reconciliations))
	}

	flagCount := 0
	for _, rec := range audit.Reconciliations {
		flagCount += len(rec.Flags)
	}
	if flagCount != len(audit.Flags) {
		t.Errorf("flags mismatch: receptions %d vs flat %d", flagCount, len(audit.Flags))
	}

	bySeverity := 0
	for _, n := range audit.Totals.BySeverity {
		bySeverity += n
	}
	if bySeverity != len(audit.Flags) {
		t.Errorf("severity breakdown %d does not sum to %d flags", bySeverity, len(audit.Flags))
	}

	if audit.Totals.LeakagePercent < 0 || audit.Totals.LeakagePercent > 100 {
		t.Errorf("leakage percent out of range: %.2f", audit.Totals.LeakagePercent)
	}
}

func TestReconcileIsDeterministic(t *testing.T) {
	st := newTestStore(t)
	vehicle, _ := st.VehicleByPlate("KDC 233J")

	first, _ := ReconcileVehicle(st, vehicle.ID, DefaultTuning)
	second, _ := ReconcileVehicle(st, vehicle.ID, DefaultTuning)

	if len(first.Flags) != len(second.Flags) {
		t.Fatalf("non-deterministic flag count: %d then %d", len(first.Flags), len(second.Flags))
	}
	for i := range first.Flags {
		if first.Flags[i].Code != second.Flags[i].Code {
			t.Errorf("flag %d differs between runs: %s vs %s", i, first.Flags[i].Code, second.Flags[i].Code)
		}
	}
}

func TestUnverifiedLitresNeverExceedPurchased(t *testing.T) {
	st := newTestStore(t)
	audit := AuditFleet(st, DefaultTuning)
	for _, rec := range audit.Reconciliations {
		if rec.UnverifiedLitres > rec.TotalLitres+0.01 {
			t.Errorf("%s unverified %.1f exceeds purchased %.1f", rec.Plate, rec.UnverifiedLitres, rec.TotalLitres)
		}
	}
}
