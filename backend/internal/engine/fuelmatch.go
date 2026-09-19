package engine

import (
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/vektorfleet/backend/internal/domain"
	"github.com/vektorfleet/backend/internal/geo"
	"github.com/vektorfleet/backend/internal/store"
)

// The Fuel Match Engine.
//
// Card data alone cannot prove theft, and fuel-probe data alone cannot either.
// This engine joins three independent sources — fuel-card transactions, the GPS
// trip index, and the tank physics of the vehicle itself — and flags the exact
// points where they disagree. Every flag carries its own evidence and a KES
// exposure, so an ops manager can act on it without reading raw telemetry.
//
// The walk is chronological and does not use a single piece of stored truth: the
// trip index provides distance, the transaction stream provides volume, and the
// tank capacity provides the physical ceiling. What is left over is the finding.

// Tuning holds the engine's thresholds. It is exported and documented because
// every flag has to be explainable to the fleet manager who receives it.
type Tuning struct {
	// ExcessTolerance is the allowed consumption overshoot vs the trip baseline.
	ExcessTolerance float64
	// ExcessFloorL is absolute slack before an excess fill is flagged.
	ExcessFloorL float64
	// CapacityTolerance is the multiple of tank capacity above which a fill is
	// physically impossible.
	CapacityTolerance float64
	// HeadroomTolerance is the overshoot allowed over reconstructed headroom.
	HeadroomTolerance float64
	// StationMismatchKm is the gap between station and vehicle before a mismatch
	// is raised. Set well above the ~20 km spacing of plausible fuelling points
	// along the corridors, so an honest fill in a sparsely serviced stretch such
	// as Tsavo is never flagged.
	StationMismatchKm float64
	// MinLitresForReview is the volume below which a fill is not worth examining.
	MinLitresForReview float64
	// CollusionCount is the number of fills at one station that starts a pattern.
	CollusionCount int
	// CollusionWindowDays is the rolling window that pattern is measured over.
	CollusionWindowDays int
	// CollusionVolumeRatio is the volume drawn at one station as a multiple of
	// what the vehicle could physically have burnt over the same period. Regular,
	// honest fuelling sits at about 1.0, so this must clear 1 before a pattern is
	// asserted.
	CollusionVolumeRatio float64
	// CollusionConcentration is the share of a vehicle's litres that must
	// concentrate at one station before the pattern is credible.
	CollusionConcentration float64
}

// DefaultTuning is the configuration currently in force.
var DefaultTuning = Tuning{
	ExcessTolerance:        1.25,
	ExcessFloorL:           5,
	CapacityTolerance:      1.02,
	HeadroomTolerance:      1.08,
	StationMismatchKm:      60,
	MinLitresForReview:     12,
	CollusionCount:         4,
	CollusionWindowDays:    21,
	CollusionVolumeRatio:   1.12,
	CollusionConcentration: 0.55,
}

const dayDuration = 24 * time.Hour

// HourEAT returns the hour of day in East Africa Time for an instant.
func HourEAT(ts time.Time) int {
	utc := ts.UTC()
	return (utc.Hour() + 3) % 24
}

// isOffHours reports whether fuel was drawn outside the authorised window.
//
// Long-haul crews legitimately fuel before a 05:00 departure, so the window runs
// from 22:00 to 05:00 rather than sweeping up every early start.
func isOffHours(ts time.Time) bool {
	hour := HourEAT(ts)
	return hour >= 22 || hour < 5
}

func severityFor(code domain.FlagCode, ratio float64) domain.Severity {
	switch code {
	case domain.FlagOverfillImpossible, domain.FlagGhostFill:
		return domain.SeverityCritical
	case domain.FlagStationMismatch, domain.FlagCollusionPattern:
		return domain.SeverityHigh
	case domain.FlagExcessLitres:
		if ratio >= 1.6 {
			return domain.SeverityHigh
		}
		return domain.SeverityMedium
	case domain.FlagOdometerRegression:
		return domain.SeverityMedium
	default:
		return domain.SeverityLow
	}
}

// flag is the internal constructor; it stamps the deterministic identifier.
func flag(f domain.FuelFlag) domain.FuelFlag {
	f.ID = fmt.Sprintf("flg_%s_%s", toLower(string(f.Code)), f.TransactionID)
	return f
}

func toLower(s string) string {
	out := []rune(s)
	for i, r := range out {
		if r >= 'A' && r <= 'Z' {
			out[i] = r + 32
		}
	}
	return string(out)
}

func fptr(v float64) *float64 { return &v }
func prettyLitres(v float64) string {
	return fmt.Sprintf("%.1f", v)
}

// ReconcileVehicle runs the engine for one vehicle.
func ReconcileVehicle(st *store.Store, vehicleID string, t Tuning) (*domain.Reconciliation, bool) {
	vehicle, ok := st.Vehicle(vehicleID)
	if !ok {
		return nil, false
	}
	result := Reconcile(st, *vehicle, st.TransactionsFor(vehicleID), t)
	return &result, true
}

type fuelEvent struct {
	ts         time.Time
	isTrip     bool
	distanceKm float64
	tx         *domain.FuelTransaction
}

// Reconcile rebuilds one vehicle's fuel ledger from first principles.
func Reconcile(st *store.Store, vehicle domain.Vehicle, transactions []domain.FuelTransaction, t Tuning) domain.Reconciliation {
	trips := st.TripsFor(vehicle.ID)
	txs := make([]domain.FuelTransaction, len(transactions))
	copy(txs, transactions)
	sort.Slice(txs, func(i, j int) bool { return txs[i].TS.Before(txs[j].TS) })

	events := make([]fuelEvent, 0, len(trips)+len(txs))
	for _, trip := range trips {
		events = append(events, fuelEvent{ts: trip.StartTS, isTrip: true, distanceKm: trip.DistanceKm})
	}
	for i := range txs {
		events = append(events, fuelEvent{ts: txs[i].TS, tx: &txs[i]})
	}
	sort.SliceStable(events, func(i, j int) bool {
		if events[i].ts.Equal(events[j].ts) {
			// Burn before topping up on a tie, so the ledger reads naturally.
			return events[i].isTrip && !events[j].isTrip
		}
		return events[i].ts.Before(events[j].ts)
	})

	var (
		flags             []domain.FuelFlag
		levelL            *float64
		openingLevelL     float64
		lastFillTS        *time.Time
		lastKnownOdometer *float64
		totalLitres       float64
		totalSpendKes     float64
		fillIndex         int
	)

	for _, event := range events {
		if event.isTrip {
			if levelL != nil {
				next := math.Max(0, *levelL-event.distanceKm/vehicle.KmPerLitre)
				levelL = &next
			}
			continue
		}

		tx := *event.tx
		totalLitres += tx.Litres
		totalSpendKes += tx.TotalKes
		txTS := tx.TS

		// ---- 1. Odometer regression ------------------------------------
		if tx.OdometerAtPumpKm != nil {
			if lastKnownOdometer != nil && *tx.OdometerAtPumpKm < *lastKnownOdometer-5 {
				flags = append(flags, flag(domain.FuelFlag{
					Code:           domain.FlagOdometerRegression,
					Severity:       severityFor(domain.FlagOdometerRegression, 0),
					VehicleID:      vehicle.ID,
					DriverID:       tx.DriverID,
					TransactionID:  tx.ID,
					Headline:       "Odometer reading went backwards at the pump",
					Detail:         fmt.Sprintf("Pump reading of %.0f km is lower than the previous logged reading of %.0f km.", *tx.OdometerAtPumpKm, *lastKnownOdometer),
					ActualLitres:   tx.Litres,
					ExposureKes:    0,
					Confidence:     0.75,
					DetectedAt:     txTS,
				}))
			}
			best := *tx.OdometerAtPumpKm
			if lastKnownOdometer != nil && *lastKnownOdometer > best {
				best = *lastKnownOdometer
			}
			lastKnownOdometer = &best
		}

		// ---- 2. Physically impossible fill -----------------------------
		var headroom *float64
		if levelL != nil {
			h := math.Max(0, vehicle.TankCapacityL-*levelL)
			headroom = &h
		}
		exceedsCapacity := tx.Litres > vehicle.TankCapacityL*t.CapacityTolerance
		exceedsHeadroom := headroom != nil &&
			tx.Litres > *headroom*t.HeadroomTolerance+5 &&
			tx.Litres > t.MinLitresForReview

		if exceedsCapacity || exceedsHeadroom {
			impossible := tx.Litres - vehicle.TankCapacityL
			if !exceedsCapacity {
				impossible = tx.Litres - *headroom
			}
			pctOver := int(math.Round(impossible / math.Max(1, tx.Litres) * 100))

			headline := fmt.Sprintf("%.0f L charged into a %.0f L tank", tx.Litres, vehicle.TankCapacityL)
			detail := fmt.Sprintf("The card captured %s L, %s L more than the tank can hold. Either the volume was keyed in manually or fuel was dispensed into another container.", prettyLitres(tx.Litres), prettyLitres(impossible))
			if !exceedsCapacity {
				headline = fmt.Sprintf("%.0f L charged with only %.0f L of headroom", tx.Litres, *headroom)
				detail = fmt.Sprintf("Tank level before the fill was reconstructed at %s L, leaving %.0f L of usable space. %s L (%d%%) cannot have entered this tank.", prettyLitres(*levelL), *headroom, prettyLitres(impossible), pctOver)
			}

			confidence := 0.82
			if exceedsCapacity {
				confidence = 0.96
			}
			flags = append(flags, flag(domain.FuelFlag{
				Code:           domain.FlagOverfillImpossible,
				Severity:       severityFor(domain.FlagOverfillImpossible, 0),
				VehicleID:      vehicle.ID,
				DriverID:       tx.DriverID,
				TransactionID:  tx.ID,
				Headline:       headline,
				Detail:         detail,
				ExpectedLitres: headroom,
				ActualLitres:   tx.Litres,
				ExposureKes:    math.Round(impossible * tx.UnitPriceKes),
				Confidence:     confidence,
				DetectedAt:     txTS,
			}))
		}

		// ---- 3. Excess litres vs distance actually driven ---------------
		since := vehicleStartOfHistory(trips, txTS)
		if lastFillTS != nil {
			since = *lastFillTS
		}
		distanceSince := DistanceInWindow(st, vehicle.ID, since, txTS)
		expected := distanceSince/math.Max(0.1, vehicle.KmPerLitre) + t.ExcessFloorL
		ratio := tx.Litres / math.Max(1, expected)

		// The very first fill has no prior reference point: the tank's opening
		// level is unknowable, so no consumption claim can honestly be made.
		if fillIndex > 0 &&
			tx.Litres > expected*t.ExcessTolerance &&
			tx.Litres >= t.MinLitresForReview &&
			!exceedsCapacity {
			excess := tx.Litres - expected
			confidence := math.Min(0.94, 0.45+(ratio-t.ExcessTolerance)*0.5)
			flags = append(flags, flag(domain.FuelFlag{
				Code:           domain.FlagExcessLitres,
				Severity:       severityFor(domain.FlagExcessLitres, ratio),
				VehicleID:      vehicle.ID,
				DriverID:       tx.DriverID,
				TransactionID:  tx.ID,
				Headline:       fmt.Sprintf("%.0f L more than the trip plan can justify", excess),
				Detail:         fmt.Sprintf("Since the previous fill the vehicle covered %.0f km, which at %g km/L burns about %s L. The card captured %s L — a surplus of %s L.", distanceSince, vehicle.KmPerLitre, prettyLitres(expected), prettyLitres(tx.Litres), prettyLitres(excess)),
				ExpectedLitres: fptr(math.Round(expected*10) / 10),
				ActualLitres:   tx.Litres,
				ExposureKes:    math.Round(excess * tx.UnitPriceKes),
				Confidence:     math.Round(confidence*100) / 100,
				DetectedAt:     txTS,
			}))
		}

		// ---- 4. Station nowhere near the vehicle ------------------------
		if estimate, ok := PositionAt(st, vehicle.ID, txTS); ok {
			gap := geo.HaversineKm(estimate.Point, tx.Position)
			if gap > t.StationMismatchKm {
				flags = append(flags, flag(domain.FuelFlag{
					Code:           domain.FlagStationMismatch,
					Severity:       severityFor(domain.FlagStationMismatch, ratio),
					VehicleID:      vehicle.ID,
					DriverID:       tx.DriverID,
					TransactionID:  tx.ID,
					Headline:       fmt.Sprintf("Card used %.0f km away from the vehicle", gap),
					Detail:         fmt.Sprintf("The transaction is logged at %s, but at %s the tracker places the vehicle %.0f km away%s.", tx.StationName, txTS.UTC().Format(time.RFC3339), gap, DescribeTrackedState(estimate.Source)),
					ActualLitres:   tx.Litres,
					ExposureKes:    math.Round(tx.TotalKes * 0.8),
					Confidence:     math.Min(0.95, 0.6+gap/300),
					DetectedAt:     txTS,
				}))
			}
		}

		// ---- 5. Fill while parked (ghost fill) --------------------------
		movement := DistanceInWindow(st, vehicle.ID, txTS.Add(-12*time.Hour), txTS.Add(12*time.Hour))
		if movement < 1 && tx.Litres >= t.MinLitresForReview {
			flags = append(flags, flag(domain.FuelFlag{
				Code:          domain.FlagGhostFill,
				Severity:      severityFor(domain.FlagGhostFill, 0),
				VehicleID:     vehicle.ID,
				DriverID:      tx.DriverID,
				TransactionID: tx.ID,
				Headline:      "Fuel charged while the vehicle did not move",
				Detail:        fmt.Sprintf("No movement is recorded within 12 hours either side of this fill, yet %s L were billed at %s. Fuel cannot have entered a vehicle that never moved.", prettyLitres(tx.Litres), tx.StationName),
				ExpectedLitres: fptr(0),
				ActualLitres:  tx.Litres,
				ExposureKes:   math.Round(tx.TotalKes),
				Confidence:    0.88,
				DetectedAt:    txTS,
			}))
		}

		// ---- 6. Off-hours pumping ---------------------------------------
		if isOffHours(txTS) && tx.Litres >= t.MinLitresForReview {
			flags = append(flags, flag(domain.FuelFlag{
				Code:          domain.FlagOffHoursFill,
				Severity:      severityFor(domain.FlagOffHoursFill, 0),
				VehicleID:     vehicle.ID,
				DriverID:      tx.DriverID,
				TransactionID: tx.ID,
				Headline:      fmt.Sprintf("Fuel drawn at %02d:00 EAT", HourEAT(txTS)),
				Detail:        fmt.Sprintf("%s L at %s outside the authorised fuelling window (05:00-22:00 EAT). Correlate with the driver rota and yard gate log.", prettyLitres(tx.Litres), tx.StationName),
				ActualLitres:  tx.Litres,
				ExposureKes:   0,
				Confidence:    0.6,
				DetectedAt:    txTS,
			}))
		}

		// ---- 7. Advance the ledger --------------------------------------
		if levelL == nil {
			// Anchor the reconstruction: assume the tank held exactly the headroom
			// implied by the first fill, which is the least-surprising valid state.
			opening := math.Max(0, vehicle.TankCapacityL-tx.Litres)
			levelL = &opening
			openingLevelL = opening
		} else {
			next := math.Min(vehicle.TankCapacityL, *levelL+tx.Litres)
			levelL = &next
		}
		tsCopy := txTS
		lastFillTS = &tsCopy
		fillIndex++
	}

	flags = append(flags, DetectCollusion(st, vehicle, txs, t)...)

	// ---- Aggregate the unexplained pool ---------------------------------
	//
	// Mass balance over the window:
	//   litres_billed - litres_burnt - net_change_in_tank = unexplained litres
	//
	// The burn is known independently (distance / nominal efficiency) and the net
	// tank change is read off the reconstructed level, so whatever is left over is
	// fuel that was paid for and never consumed.
	var windowStart time.Time
	if len(txs) > 0 {
		windowStart = txs[0].TS
	} else {
		windowStart = time.Now().Add(-30 * dayDuration)
	}
	expectedLitres := ExpectedLitresFor(vehicle, DistanceInWindow(st, vehicle.ID, windowStart, time.Now()))

	netTankGain := 0.0
	if levelL != nil {
		netTankGain = math.Max(0, *levelL-openingLevelL)
	}
	unexplained := math.Max(0, totalLitres-expectedLitres-netTankGain)

	exposure := 0.0
	for _, f := range flags {
		exposure += f.ExposureKes
	}

	leakage := 0.0
	if totalLitres > 0 {
		leakage = math.Round(unexplained/totalLitres*1000) / 10
	}

	result := domain.Reconciliation{
		VehicleID:        vehicle.ID,
		Plate:            vehicle.Plate,
		Transactions:     len(txs),
		TotalLitres:      math.Round(totalLitres*10) / 10,
		TotalSpendKes:    math.Round(totalSpendKes),
		ExpectedLitres:   math.Round(expectedLitres*10) / 10,
		UnverifiedLitres: math.Round(unexplained*10) / 10,
		LeakagePercent:   leakage,
		ExposureKes:      math.Round(exposure),
		Flags:            flags,
	}
	if levelL != nil {
		result.ClosingLevelL = fptr(math.Round(*levelL*10) / 10)
	}
	return result
}

func vehicleStartOfHistory(trips []domain.Trip, fallback time.Time) time.Time {
	if len(trips) == 0 {
		return fallback.Add(-dayDuration)
	}
	earliest := trips[0].StartTS
	for _, trip := range trips[1:] {
		if trip.StartTS.Before(earliest) {
			earliest = trip.StartTS
		}
	}
	return earliest
}

// DetectCollusion looks for the same driver repeatedly filling the same vehicle
// at the same station, at volumes that exceed what the vehicle could physically
// have burnt over the same period.
//
// Individually each fill passes every per-transaction check; the cadence and the
// concentration are what give the pattern away.
func DetectCollusion(st *store.Store, vehicle domain.Vehicle, transactions []domain.FuelTransaction, t Tuning) []domain.FuelFlag {
	windowMs := time.Duration(t.CollusionWindowDays) * dayDuration

	groups := map[string][]domain.FuelTransaction{}
	for _, tx := range transactions {
		key := tx.DriverID + "::" + tx.StationName
		groups[key] = append(groups[key], tx)
	}

	var out []domain.FuelFlag
	for _, list := range groups {
		sorted := make([]domain.FuelTransaction, len(list))
		copy(sorted, list)
		sort.Slice(sorted, func(i, j int) bool { return sorted[i].TS.Before(sorted[j].TS) })
		if len(sorted) < t.CollusionCount {
			continue
		}

		// Evaluate only the most recent window, so one group yields one finding.
		latest := sorted[len(sorted)-1]
		spanFrom := sorted[0].TS
		if cutoff := latest.TS.Add(-windowMs); cutoff.After(spanFrom) {
			spanFrom = cutoff
		}

		var cluster []domain.FuelTransaction
		for _, tx := range sorted {
			if !tx.TS.Before(spanFrom) {
				cluster = append(cluster, tx)
			}
		}
		if len(cluster) < t.CollusionCount {
			continue
		}

		litres := 0.0
		spend := 0.0
		for _, tx := range cluster {
			litres += tx.Litres
			spend += tx.TotalKes
		}
		avg := litres / float64(len(cluster))
		if avg < vehicle.TankCapacityL*0.35 {
			continue
		}

		justified := ExpectedLitresFor(vehicle, DistanceInWindow(st, vehicle.ID, spanFrom, latest.TS))
		ratio := math.Inf(1)
		if justified > 0 {
			ratio = litres / justified
		}
		if ratio < t.CollusionVolumeRatio {
			continue
		}

		spanLitres := 0.0
		for _, tx := range transactions {
			if !tx.TS.Before(spanFrom) && !tx.TS.After(latest.TS) {
				spanLitres += tx.Litres
			}
		}
		concentration := 0.0
		if spanLitres > 0 {
			concentration = litres / spanLitres
		}
		if concentration < t.CollusionConcentration {
			continue
		}

		padding := math.Max(0, litres-justified)
		unitPrice := spend / math.Max(1, litres)

		out = append(out, flag(domain.FuelFlag{
			Code:           domain.FlagCollusionPattern,
			Severity:       severityFor(domain.FlagCollusionPattern, ratio),
			VehicleID:      vehicle.ID,
			DriverID:       vehicle.DriverID,
			TransactionID:  latest.ID,
			Headline:       fmt.Sprintf("%d fills at %s in %d days", len(cluster), latest.StationName, t.CollusionWindowDays),
			Detail:         fmt.Sprintf("Same driver, same station, averaging %.0f L per visit and taking %.0f%% of everything this vehicle bought. That volume is %.0f%% more than the %.0f L the trip plan can justify over the same period. No single fill at this station is extraordinary on its own — it is the concentration and the cadence that do not match the vehicle's duty cycle, which is exactly how collusive fuelling hides inside a card report. Suggested action: pull station camera footage for %s and reconcile it against the yard gate log.", avg, concentration*100, ratio*100-100, justified, latest.TS.UTC().Format("2006-01-02")),
			ExpectedLitres: fptr(math.Round(justified*10) / 10),
			ActualLitres:   math.Round(litres*10) / 10,
			ExposureKes:    math.Round(padding * unitPrice),
			Confidence:     0.74,
			DetectedAt:     latest.TS,
		}))
	}
	return out
}

// AuditFleet runs the engine across the whole book of business.
func AuditFleet(st *store.Store, t Tuning) domain.FleetAudit {
	vehicles := st.Vehicles()
	reconciliations := make([]domain.Reconciliation, 0, len(vehicles))
	var allFlags []domain.FuelFlag

	for _, v := range vehicles {
		rec := Reconcile(st, v, st.TransactionsFor(v.ID), t)
		allFlags = append(allFlags, rec.Flags...)
		reconciliations = append(reconciliations, rec)
	}

	sort.SliceStable(allFlags, func(i, j int) bool {
		si, sj := severityRank(allFlags[i].Severity), severityRank(allFlags[j].Severity)
		if si != sj {
			return si < sj
		}
		return allFlags[i].ExposureKes > allFlags[j].ExposureKes
	})

	bySeverity := map[domain.Severity]int{
		domain.SeverityCritical: 0, domain.SeverityHigh: 0, domain.SeverityMedium: 0, domain.SeverityLow: 0,
	}
	byCode := map[domain.FlagCode]int{}
	for _, f := range allFlags {
		bySeverity[f.Severity]++
		byCode[f.Code]++
	}

	totals := domain.AuditTotals{BySeverity: bySeverity, ByCode: byCode}
	for _, rec := range reconciliations {
		totals.Litres += rec.TotalLitres
		totals.SpendKes += rec.TotalSpendKes
		totals.ExpectedLitres += rec.ExpectedLitres
		totals.UnverifiedLitres += rec.UnverifiedLitres
	}
	for _, f := range allFlags {
		totals.ExposureKes += f.ExposureKes
	}
	if totals.Litres > 0 {
		totals.LeakagePercent = math.Round(totals.UnverifiedLitres/totals.Litres*1000) / 10
	}
	totals.Litres = math.Round(totals.Litres*10) / 10
	totals.ExpectedLitres = math.Round(totals.ExpectedLitres*10) / 10
	totals.UnverifiedLitres = math.Round(totals.UnverifiedLitres*10) / 10
	totals.SpendKes = math.Round(totals.SpendKes)
	totals.ExposureKes = math.Round(totals.ExposureKes)

	return domain.FleetAudit{Reconciliations: reconciliations, Flags: allFlags, Totals: totals}
}

func severityRank(s domain.Severity) int {
	switch s {
	case domain.SeverityCritical:
		return 0
	case domain.SeverityHigh:
		return 1
	case domain.SeverityMedium:
		return 2
	default:
		return 3
	}
}
