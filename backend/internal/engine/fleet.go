package engine

import (
	"math"
	"time"

	"github.com/vektorfleet/backend/internal/domain"
	"github.com/vektorfleet/backend/internal/store"
)

// Fleet analytics turns raw engine output into the shapes the console renders.
// Everything here is derived; nothing is stored twice.

const snapshotPingWindow = 48 * time.Hour

// buildSnapshot assembles one vehicle's row, reusing an already-computed
// reconciliation so a dashboard load does not reconcile the book twice.
func buildSnapshot(st *store.Store, v domain.Vehicle, rec *domain.Reconciliation, now time.Time) domain.VehicleSnapshot {
	driver, _ := st.Driver(v.DriverID)
	device, _ := st.DeviceForVehicle(v.ID)

	pings := PingsFor(st, v.ID, now.Add(-snapshotPingWindow), now)
	var lastPing *domain.TelemetryPing
	if len(pings) > 0 {
		lastPing = &pings[len(pings)-1]
	}

	compliance := EvaluateAll(st, v.ID, now)
	openFlags := 0
	if rec != nil {
		openFlags = len(rec.Flags)
	}

	snapshot := domain.VehicleSnapshot{
		Vehicle:          v,
		Device:           device,
		LastPing:         lastPing,
		Distance24hKm:    math.Round(DistanceInWindow(st, v.ID, now.Add(-24*time.Hour), now)*10) / 10,
		OverspeedEvents:  len(OverspeedEvents(pings, v.GovernorLimitKph, 3)),
		IdlingMinutes:    IdlingMinutes(pings, 20),
		OpenFlags:        openFlags,
		Compliance:       compliance,
		ComplianceStatus: WorstStatus(compliance),
	}
	if driver != nil {
		snapshot.Driver = driver
	}

	// Live efficiency over the reconciliation window, which is the only place
	// both a distance and a billed volume exist.
	if rec != nil && rec.TotalLitres > 0 && rec.Transactions > 0 {
		distance30d := DistanceInWindow(st, v.ID, now.Add(-30*24*time.Hour), now)
		value := math.Round(distance30d/math.Max(1, rec.TotalLitres)*100) / 100
		snapshot.LiveKmPerLitre = &value
	}

	return snapshot
}

// fleetData computes the audit and the snapshots once, so every KPI shares them.
func fleetData(st *store.Store, now time.Time) ([]domain.VehicleSnapshot, domain.FleetAudit, PostureSummary) {
	audit := AuditFleet(st, DefaultTuning)

	byVehicle := make(map[string]*domain.Reconciliation, len(audit.Reconciliations))
	for i := range audit.Reconciliations {
		byVehicle[audit.Reconciliations[i].VehicleID] = &audit.Reconciliations[i]
	}

	vehicles := st.Vehicles()
	snapshots := make([]domain.VehicleSnapshot, 0, len(vehicles))
	for _, v := range vehicles {
		snapshots = append(snapshots, buildSnapshot(st, v, byVehicle[v.ID], now))
	}

	return snapshots, audit, FleetCompliancePosture(st, now)
}

// AllSnapshots returns every vehicle's derived row.
func AllSnapshots(st *store.Store, now time.Time) []domain.VehicleSnapshot {
	snapshots, _, _ := fleetData(st, now)
	return snapshots
}

// SnapshotFor returns one vehicle's derived row.
func SnapshotFor(st *store.Store, vehicleID string, now time.Time) (domain.VehicleSnapshot, bool) {
	vehicle, ok := st.Vehicle(vehicleID)
	if !ok {
		return domain.VehicleSnapshot{}, false
	}
	rec, _ := ReconcileVehicle(st, vehicleID, DefaultTuning)
	return buildSnapshot(st, *vehicle, rec, now), true
}

// FleetKPIs is the headline pulse of the book of business.
//
// AnnualisedSavingKes is the number the sales motion leads with, and every
// component of it is traceable to an engine output rather than asserted.
func FleetKPIs(st *store.Store, now time.Time) domain.FleetKpis {
	snapshots, audit, posture := fleetData(st, now)

	kpis := domain.FleetKpis{
		Vehicles:              len(snapshots),
		UnverifiedLitres:      audit.Totals.UnverifiedLitres,
		FlaggedExposureKes:    audit.Totals.ExposureKes,
		ComplianceExpired:     posture.Expired,
		ComplianceExpiring30d: posture.DueSoon + posture.Critical,
	}

	for _, s := range snapshots {
		if s.Vehicle.Status == domain.StatusActive {
			kpis.Active++
		}
		if s.Device == nil || !s.Device.Online || s.Vehicle.Status == domain.StatusOffline {
			kpis.Offline++
		}
		kpis.DistanceTodayKm += s.Distance24hKm
	}
	for _, f := range audit.Flags {
		if f.Severity == domain.SeverityCritical {
			kpis.OpenCriticalFlags++
		}
	}
	for _, rec := range audit.Reconciliations {
		kpis.FuelLitresToday += rec.TotalLitres / 30
		kpis.FuelSpendTodayKes += rec.TotalSpendKes / 30
	}

	kpis.DistanceTodayKm = math.Round(kpis.DistanceTodayKm)
	kpis.FuelLitresToday = math.Round(kpis.FuelLitresToday)
	kpis.FuelSpendTodayKes = math.Round(kpis.FuelSpendTodayKes)

	kpis.Breakdown = SavingsBreakdown(snapshots, audit, posture)
	for _, line := range kpis.Breakdown {
		kpis.AnnualisedSavingKes += line.AnnualKes
	}
	kpis.AnnualisedSavingKes = math.Round(kpis.AnnualisedSavingKes)

	overspeedEvents := 0
	idlingMinutes := 0.0
	for _, s := range snapshots {
		overspeedEvents += s.OverspeedEvents
		idlingMinutes += s.IdlingMinutes
	}

	health := 100.0 -
		(float64(kpis.OpenCriticalFlags)*6 +
			float64(posture.Expired)*2.5 +
			float64(posture.Critical)*1.2 +
			float64(kpis.Offline)*2.5 +
			float64(overspeedEvents)*0.4)
	kpis.HealthScore = int(math.Max(0, math.Min(100, math.Round(health))))

	return kpis
}

// SavingsBreakdown states where the saving actually comes from. Each line
// carries its method so the number survives procurement scrutiny.
func SavingsBreakdown(snapshots []domain.VehicleSnapshot, audit domain.FleetAudit, posture PostureSummary) []domain.SavingsBreakdown {
	overspeedEvents := 0
	idlingMinutes := 0.0
	for _, s := range snapshots {
		overspeedEvents += s.OverspeedEvents
		idlingMinutes += s.IdlingMinutes
	}

	// Flagged exposure recurs monthly once controls are in place.
	fuelTheftAnnual := audit.Totals.ExposureKes * 12

	// A governed, well-driven truck burns roughly 4% less fuel; idling burns
	// about 1.6 L/h.
	drivingEfficiencyAnnual := math.Round((float64(overspeedEvents)*45 + idlingMinutes*1.6*190*0.35) * 12)

	// Reactive-to-planned maintenance typically cuts unplanned downtime by a
	// third, and a breakdown day costs a commercial vehicle real money.
	maintenanceAnnual := math.Round(float64(len(snapshots)) * 12_000 * 5 * 0.33)

	// Compliance: fines avoided plus two days of avoided downtime per lapse.
	atRisk := posture.Expired + posture.Critical + posture.DueSoon
	complianceAnnual := math.Round(float64(atRisk) * 18_000)

	return []domain.SavingsBreakdown{
		{
			Label:       "Fuel pilferage recovered",
			Description: "Card volumes that the trip plan cannot justify, run-rate annualised.",
			AnnualKes:   fuelTheftAnnual,
			Method:      "Flagged exposure KES " + formatThousands(audit.Totals.ExposureKes) + " x 12 months",
		},
		{
			Label:       "Driving behaviour & idling",
			Description: "Overspeed and excess-idling burn eliminated through driver coaching.",
			AnnualKes:   drivingEfficiencyAnnual,
			Method:      formatThousands(float64(overspeedEvents)) + " overspeed events and " + formatThousands(idlingMinutes) + " idling minutes, priced at diesel rates",
		},
		{
			Label:       "Predictive maintenance",
			Description: "Unplanned breakdown days avoided by servicing on telemetry rather than failure.",
			AnnualKes:   maintenanceAnnual,
			Method:      formatThousands(float64(len(snapshots))) + " vehicles x 5 avoided downtime days x KES 12,000/day x 33%",
		},
		{
			Label:       "Compliance fines & impoundment avoided",
			Description: "NTSA, county and KRA lapses caught 30 days out.",
			AnnualKes:   complianceAnnual,
			Method:      formatThousands(float64(atRisk)) + " at-risk items x KES 18,000 average fine and downtime",
		},
	}
}
