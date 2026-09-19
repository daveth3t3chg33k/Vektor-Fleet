package engine

import (
	"fmt"
	"testing"
	"time"

	"github.com/vektorfleet/backend/internal/store"
)

func TestProbeCleanLedger(t *testing.T) {
	anchor := time.Date(2026, 3, 14, 9, 0, 0, 0, time.UTC)
	st := store.New(anchor)
	eat := func(ts time.Time) string { return ts.Add(3 * time.Hour).Format("01-02 15:04") }

	for _, plate := range []string{"KDA 412M", "KDB 908T", "KCX 100A", "KDZ 901E"} {
		v, _ := st.VehicleByPlate(plate)
		trips := st.TripsFor(v.ID)
		txs := st.TransactionsFor(v.ID)
		rec, _ := ReconcileVehicle(st, v.ID, DefaultTuning)
		fmt.Printf("\n=== %s km/L=%.1f cap=%.0f trips=%d txs=%d leakage=%.1f%% unverified=%.1f\n",
			plate, v.KmPerLitre, v.TankCapacityL, len(trips), len(txs), rec.LeakagePercent, rec.UnverifiedLitres)
		var prev time.Time
		for _, tx := range txs {
			dist := -1.0
			if !prev.IsZero() {
				dist = DistanceInWindow(st, v.ID, prev, tx.TS)
			}
			fmt.Printf("  %s  %6.1fL  %-22s  dist=%.0fkm\n", eat(tx.TS), tx.Litres, tx.StationName, dist)
			prev = tx.TS
		}
		for _, f := range rec.Flags {
			fmt.Printf("  FLAG %s | %s | %s\n", f.Code, f.Headline, f.Detail)
		}
	}
}
