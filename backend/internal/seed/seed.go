// Package seed generates VektorFleet's demo book of business.
//
// The generator is the single source of truth for physics: trips drive both the
// telemetry timeline and the fuel burn, so the fuel-match engine reconciles
// against data that genuinely adds up — except where an anomaly profile
// deliberately breaks it. Every anomaly is injected by construction (a siphoned
// volume that never reaches the tank, a fill billed above tank capacity, a card
// used where the vehicle was not), never by writing a flag into the fixture.
//
// Two clocks are in play. The generator reasons in East Africa Time, because
// that is the working day of a Kenyan fleet, and serialises to true UTC. Keeping
// them distinct is what makes the engine's local-time rules — off-hours fuelling
// in particular — agree with the data instead of drifting three hours out.
package seed

import (
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/vektorfleet/backend/internal/corridors"
	"github.com/vektorfleet/backend/internal/domain"
	"github.com/vektorfleet/backend/internal/geo"
)

const (
	hourMillis = int64(60 * 60 * 1000)
	dayMillis  = 24 * hourMillis

	// EatOffsetMillis is East Africa Time's offset from UTC. Kenya has no DST.
	EatOffsetMillis = int64(3 * hourMillis)

	// refillThreshold is the tank fraction at which an honest fleet fuels up.
	refillThreshold = 0.28
	// fillTarget is how full a normal fill leaves the tank.
	fillTarget = 0.94

	historyDays = 30
	seedValue   = 20260919

	telemetryHours = 48
)

// FraudProfile selects how a vehicle's fuel ledger is deliberately corrupted.
// Exactly one vehicle in the fixture carries each profile, so a test can assert
// that the engine finds the right thing without being told where to look.
type FraudProfile string

const (
	ProfileClean          FraudProfile = "clean"
	ProfileSiphon         FraudProfile = "siphon"
	ProfileOverfill       FraudProfile = "overfill"
	ProfilePhantomStation FraudProfile = "phantom_station"
	ProfileGhost          FraudProfile = "ghost"
	ProfileCollusion      FraudProfile = "collusion"
)

type vehicleSpec struct {
	Plate         string
	FleetIndex    int
	Class         domain.VehicleClass
	Make          string
	Model         string
	Year          int
	TankCapacityL float64
	KmPerLitre    float64
	Corridor      string
	DepotIndex    int
	Profile       FraudProfile
	DailyKm       float64
	TripsPerDay   int
}

var vehicleSpecs = []vehicleSpec{
	// Fleet 1 — Safari Logistics Ltd (Tier 1, Mombasa Road)
	{Plate: "KDA 412M", FleetIndex: 0, Class: domain.ClassTruck, Make: "Isuzu", Model: "FRR 90", Year: 2021, TankCapacityL: 200, KmPerLitre: 4.2, Corridor: corridors.MombasaRoad, DepotIndex: 0, Profile: ProfileClean, DailyKm: 380, TripsPerDay: 1},
	{Plate: "KDB 908T", FleetIndex: 0, Class: domain.ClassPrimeMover, Make: "Mitsubishi", Model: "Fuso FV26", Year: 2019, TankCapacityL: 400, KmPerLitre: 2.6, Corridor: corridors.MombasaRoad, DepotIndex: 1, Profile: ProfileClean, DailyKm: 640, TripsPerDay: 1},
	{Plate: "KDC 233J", FleetIndex: 0, Class: domain.ClassPrimeMover, Make: "Scania", Model: "G410", Year: 2020, TankCapacityL: 500, KmPerLitre: 2.4, Corridor: corridors.NorthernCorridor, DepotIndex: 1, Profile: ProfileSiphon, DailyKm: 520, TripsPerDay: 1},
	{Plate: "KDD 771V", FleetIndex: 0, Class: domain.ClassTruck, Make: "Isuzu", Model: "NQR", Year: 2022, TankCapacityL: 140, KmPerLitre: 5.0, Corridor: corridors.MombasaRoad, DepotIndex: 0, Profile: ProfileOverfill, DailyKm: 300, TripsPerDay: 2},
	{Plate: "KDE 155L", FleetIndex: 0, Class: domain.ClassVan, Make: "Nissan", Model: "NV350", Year: 2023, TankCapacityL: 80, KmPerLitre: 9.5, Corridor: corridors.NairobiMetro, DepotIndex: 0, Profile: ProfileClean, DailyKm: 180, TripsPerDay: 4},
	{Plate: "KDF 604R", FleetIndex: 0, Class: domain.ClassTruck, Make: "Hino", Model: "300 Series", Year: 2020, TankCapacityL: 120, KmPerLitre: 6.2, Corridor: corridors.MombasaRoad, DepotIndex: 4, Profile: ProfilePhantomStation, DailyKm: 260, TripsPerDay: 2},

	// Fleet 2 — Rift Valley FMCG Distributors (Tier 2, Nakuru)
	{Plate: "KCA 318P", FleetIndex: 1, Class: domain.ClassTruck, Make: "Isuzu", Model: "FSR", Year: 2021, TankCapacityL: 150, KmPerLitre: 5.2, Corridor: corridors.NorthernCorridor, DepotIndex: 2, Profile: ProfileClean, DailyKm: 240, TripsPerDay: 2},
	{Plate: "KCB 712K", FleetIndex: 1, Class: domain.ClassTruck, Make: "Mitsubishi", Model: "Canter", Year: 2018, TankCapacityL: 100, KmPerLitre: 7.0, Corridor: corridors.KisumuBranch, DepotIndex: 2, Profile: ProfileGhost, DailyKm: 210, TripsPerDay: 1},
	{Plate: "KCC 449G", FleetIndex: 1, Class: domain.ClassPickup, Make: "Toyota", Model: "Hilux", Year: 2023, TankCapacityL: 80, KmPerLitre: 11.0, Corridor: corridors.NorthernCorridor, DepotIndex: 2, Profile: ProfileClean, DailyKm: 190, TripsPerDay: 3},
	{Plate: "KCD 826B", FleetIndex: 1, Class: domain.ClassTruck, Make: "Isuzu", Model: "FRR 90", Year: 2019, TankCapacityL: 200, KmPerLitre: 4.4, Corridor: corridors.NorthernCorridor, DepotIndex: 3, Profile: ProfileCollusion, DailyKm: 340, TripsPerDay: 1},

	// Fleet 3 — Nairobi Last-Mile Couriers (Tier 2, standard plan)
	{Plate: "KCX 100A", FleetIndex: 2, Class: domain.ClassVan, Make: "Nissan", Model: "NV350", Year: 2023, TankCapacityL: 70, KmPerLitre: 10.5, Corridor: corridors.NairobiMetro, DepotIndex: 0, Profile: ProfileClean, DailyKm: 160, TripsPerDay: 5},
	{Plate: "KCY 205C", FleetIndex: 2, Class: domain.ClassVan, Make: "Toyota", Model: "Hiace", Year: 2022, TankCapacityL: 65, KmPerLitre: 9.0, Corridor: corridors.NairobiMetro, DepotIndex: 0, Profile: ProfileClean, DailyKm: 140, TripsPerDay: 5},
	{Plate: "KCZ 330D", FleetIndex: 2, Class: domain.ClassVan, Make: "Isuzu", Model: "NLR", Year: 2024, TankCapacityL: 75, KmPerLitre: 9.8, Corridor: corridors.ThikaSuperhighway, DepotIndex: 0, Profile: ProfileClean, DailyKm: 130, TripsPerDay: 3},
	{Plate: "KDZ 901E", FleetIndex: 2, Class: domain.ClassTruck, Make: "Tata", Model: "Ultra 1518", Year: 2021, TankCapacityL: 110, KmPerLitre: 6.8, Corridor: corridors.ThikaSuperhighway, DepotIndex: 0, Profile: ProfileClean, DailyKm: 150, TripsPerDay: 2},
}

type fleetSpec struct {
	ID           string
	Name         string
	Sector       string
	Tier         int
	HQ           string
	ContractPlan string
}

var fleetSpecs = []fleetSpec{
	{ID: "flt_safari", Name: "Safari Logistics Ltd", Sector: "Container haulage & long-haul freight", Tier: 1, HQ: "Mombasa Road, Nairobi", ContractPlan: "enterprise"},
	{ID: "flt_riftvalley", Name: "Rift Valley FMCG Distributors", Sector: "FMCG distribution & agricultural transit", Tier: 2, HQ: "Nakuru ICD", ContractPlan: "premium"},
	{ID: "flt_lastmile", Name: "Nairobi Last-Mile Couriers", Sector: "E-commerce courier & urban distribution", Tier: 2, HQ: "Industrial Area, Nairobi", ContractPlan: "standard"},
}

var driverNames = []string{
	"Peter Mwangi", "Joseph Otieno", "Hassan Abdi", "Samuel Kipchoge", "Grace Wanjiru",
	"Daniel Mutiso", "Brian Ochieng", "Ali Mohamed", "Faith Njeri", "Kevin Barasa",
	"Mary Achieng", "Stephen Kamau", "Ibrahim Yusuf", "Dennis Wekesa", "Lucy Chebet",
}

var vendors = []domain.GpsVendorID{
	domain.VendorCarTrack,
	domain.VendorSafeRide,
	domain.VendorTeltonika,
	domain.VendorRuptela,
	domain.VendorGenericTCP,
}

type complianceTemplate struct {
	Category            domain.ComplianceCategory
	Title               string
	Authority           string
	NominalDaysUntilDue int
	IntervalDays        int
}

var complianceTemplates = []complianceTemplate{
	{domain.CategoryNTASInspection, "NTSA annual roadworthiness inspection", "NTSA", 65, 365},
	{domain.CategorySpeedGovernor, "Speed governor recalibration", "NTSA-approved centre", 45, 365},
	{domain.CategoryInsurance, "Commercial vehicle insurance renewal", "IRA-licensed insurer", 25, 365},
	{domain.CategoryTransitLicence, "Transit goods vehicle licence", "NTSA", 35, 365},
	{domain.CategoryCountyPermit, "County single business permit", "County Government", 15, 365},
	{domain.CategoryKRATax, "KRA commercial vehicle tax filing", "KRA", 65, 365},
	{domain.CategoryEmission, "Emissions compliance certificate", "NEMA licensed centre", 55, 365},
}

// ---------------------------------------------------------------------------
// Clock helpers
// ---------------------------------------------------------------------------

// eatMillis converts a stored (true UTC) instant back to its EAT wall-clock epoch.
func eatMillis(t time.Time) int64 { return t.UTC().UnixMilli() + EatOffsetMillis }

// fromEatMillis serialises an EAT wall-clock epoch as a true UTC time.
func fromEatMillis(ms int64) time.Time { return time.UnixMilli(ms - EatOffsetMillis).UTC() }

// startOfNextEatDay returns EAT midnight at the start of the following day.
func startOfNextEatDay(ms int64) int64 {
	return (ms/dayMillis + 1) * dayMillis
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

// Generate builds a complete, internally consistent dataset.
func Generate(now time.Time) *domain.Dataset {
	nowTrue := now.UTC().UnixMilli()
	nowEat := nowTrue + EatOffsetMillis
	rng := domain.NewRng(seedValue)

	fleets := make([]domain.Fleet, 0, len(fleetSpecs))
	for i, f := range fleetSpecs {
		seats := 0
		for _, v := range vehicleSpecs {
			if v.FleetIndex == i {
				seats++
			}
		}
		fleets = append(fleets, domain.Fleet{
			ID: f.ID, Name: f.Name, Sector: f.Sector, Tier: f.Tier,
			HQ: f.HQ, ContractPlan: f.ContractPlan, SeatsBilled: seats,
		})
	}

	var (
		vehicles         []domain.Vehicle
		drivers          []domain.Driver
		devices          []domain.GpsDevice
		trips            []domain.Trip
		cards            []domain.FuelCard
		transactions     []domain.FuelTransaction
		complianceItems  []domain.ComplianceItem
	)

	for idx, spec := range vehicleSpecs {
		vehicleID := fmt.Sprintf("veh_%03d", idx+1)
		driverID := fmt.Sprintf("drv_%03d", idx+1)
		deviceID := fmt.Sprintf("dev_%03d", idx+1)
		fleet := fleets[spec.FleetIndex]

		plannedTrips := planTrips(rng, spec, vehicleID, driverID, nowEat)
		trips = append(trips, plannedTrips...)

		state := &fuelState{
			level:    spec.TankCapacityL * rng.Float(0.15, 0.3),
			odometer: spec.DailyKm * 365 * rng.Float(1.2, 2.6),
		}

		card := domain.FuelCard{
			ID:        fmt.Sprintf("card_%03d", idx+1),
			Provider:  domain.Pick(rng, []domain.StationProvider{domain.ProviderRubis, domain.ProviderTotal, domain.ProviderShell}),
			MaskedPan: fmt.Sprintf("**** **** **** %d", rng.Int(1000, 9999)),
			VehicleID: vehicleID,
			DriverID:  driverID,
		}
		cards = append(cards, card)

		transactions = append(transactions, generateFuelHistory(rng, spec, vehicleID, driverID, card.ID, plannedTrips, state, nowEat)...)

		drivers = append(drivers, domain.Driver{
			ID:                driverID,
			Name:              driverNames[idx%len(driverNames)],
			Phone:             fmt.Sprintf("+2547%d%d", rng.Int(10, 99), rng.Int(100000, 999999)),
			LicenceNo:         fmt.Sprintf("DL-%d", rng.Int(100000, 999999)),
			LicenceExpiry:     time.UnixMilli(nowTrue + int64(rng.Int(-20, 400))*dayMillis).UTC(),
			AssignedVehicleID: vehicleID,
			Score:             driverScore(rng, spec.Profile),
		})

		device := domain.GpsDevice{
			ID:             deviceID,
			IMEI:           fmt.Sprintf("86%d", rng.Int64(1000000000000, 9999999999999)),
			Vendor:         vendors[idx%len(vendors)],
			VendorDeviceID: fmt.Sprintf("%s-%d", vendors[idx%len(vendors)], rng.Int(100000, 999999)),
			VehicleID:      vehicleID,
			Firmware:       fmt.Sprintf("%d.%d.%d", rng.Int(2, 7), rng.Int(0, 9), rng.Int(0, 9)),
			LastSeenAt:     time.UnixMilli(nowTrue - int64(rng.Int(0, 4))*60*1000).UTC(),
			Online:         rng.Bool(0.88),
		}
		devices = append(devices, device)

		status := domain.StatusIdle
		switch {
		case spec.Profile == ProfileGhost:
			status = domain.StatusMaintenance
		case rng.Bool(0.8):
			status = domain.StatusActive
		}

		vehicles = append(vehicles, domain.Vehicle{
			ID:               vehicleID,
			Plate:            spec.Plate,
			FleetID:          fleet.ID,
			Class:            spec.Class,
			Make:             spec.Make,
			Model:            spec.Model,
			Year:             spec.Year,
			FuelType:         "diesel",
			TankCapacityL:    spec.TankCapacityL,
			KmPerLitre:       spec.KmPerLitre,
			OdometerKm:       domain.Round(state.odometer, 0),
			Status:           status,
			Corridor:         spec.Corridor,
			HomeDepot:        corridors.Depots[spec.DepotIndex],
			DeviceID:         deviceID,
			DriverID:         driverID,
			GovernorLimitKph: 80,
		})

		for tIdx, tpl := range complianceTemplates {
			// Per-vehicle variation around the nominal renewal age, so the fleet
			// shows a realistic mix of expired, critical, due-soon and healthy
			// obligations across every category — including the driver-facing
			// NTSA items.
			variation := domain.Weighted(rng, []domain.WeightedChoice[int]{
				{Value: rng.Int(-70, -35), Weight: 0.12},
				{Value: rng.Int(-30, 0), Weight: 0.32},
				{Value: rng.Int(1, 90), Weight: 0.34},
				{Value: rng.Int(91, 300), Weight: 0.22},
			})
			dueMillis := nowTrue + int64(tpl.NominalDaysUntilDue+variation)*dayMillis
			lastDone := time.UnixMilli(dueMillis - int64(tpl.IntervalDays)*dayMillis).UTC()

			item := domain.ComplianceItem{
				ID:              fmt.Sprintf("cmp_%03d_%d", idx+1, tIdx),
				VehicleID:       vehicleID,
				Category:        tpl.Category,
				Title:           tpl.Title,
				Authority:       tpl.Authority,
				DueDate:         time.UnixMilli(dueMillis).UTC(),
				LastCompletedAt: &lastDone,
				LeadDays:        30,
			}
			if tpl.Category == domain.CategorySpeedGovernor {
				item.Notes = "Governor must be set to 80 km/h and re-sealed."
			}
			complianceItems = append(complianceItems, item)
		}
	}

	sort.Slice(trips, func(i, j int) bool { return trips[i].StartTS.Before(trips[j].StartTS) })
	sort.Slice(transactions, func(i, j int) bool { return transactions[i].TS.Before(transactions[j].TS) })

	return &domain.Dataset{
		GeneratedAt:      time.UnixMilli(nowTrue).UTC(),
		Fleets:           fleets,
		Vehicles:         vehicles,
		Drivers:          drivers,
		Devices:          devices,
		Trips:            trips,
		Telemetry:        buildTelemetry(rng, vehicles, trips, nowEat),
		FuelCards:        cards,
		FuelTransactions: transactions,
		ComplianceItems:  complianceItems,
	}
}

func driverScore(rng *domain.Rng, profile FraudProfile) int {
	if profile == ProfileClean {
		return rng.Int(78, 98)
	}
	return rng.Int(41, 68)
}

// ---------------------------------------------------------------------------
// Movement planning
// ---------------------------------------------------------------------------

// downtimeDay reports whether a vehicle is scheduled off the road, which is
// shared by the trip planner and the fuel generator so both agree about which
// days the vehicle genuinely did not move.
func downtimeDay(spec vehicleSpec, dayIndex int) bool {
	if spec.Profile == ProfileGhost {
		return dayIndex%7 == 2 || dayIndex%7 == 5
	}
	return false
}

func planTrips(rng *domain.Rng, spec vehicleSpec, vehicleID, driverID string, nowEat int64) []domain.Trip {
	corridor := corridors.ByID[spec.Corridor]
	lengthKm := geo.PolylineLengthKm(corridor.Waypoints)

	var trips []domain.Trip
	startDay := (nowEat - historyDays*dayMillis) / dayMillis
	today := nowEat / dayMillis
	tripNo := 0

	// Where the vehicle sits along its corridor and which way it is heading.
	fraction := rng.Float(0.05, 0.4)
	direction := 1.0

	for day := startDay; day <= today; day++ {
		dayStart := day * dayMillis
		weekday := time.UnixMilli(dayStart).UTC().Weekday()
		isSunday := weekday == time.Sunday

		load := 1.0
		switch {
		case isSunday:
			load = 0.15
		case weekday == time.Saturday:
			load = 0.6
		}

		tripCount := 0
		if !downtimeDay(spec, int(day)) {
			tripCount = int(math.Round(float64(spec.TripsPerDay) * load * rng.Float(0.85, 1.15)))
			if tripCount < 0 {
				tripCount = 0
			}
		}

		cursor := dayStart + int64((5+rng.Float(0, 1.5))*float64(hourMillis))
		for t := 0; t < tripCount; t++ {
			distanceKm := domain.Round(spec.DailyKm/float64(spec.TripsPerDay)*rng.Float(0.82, 1.2), 1)

			var avgSpeedKph float64
			if spec.Class == domain.ClassPrimeMover || spec.Class == domain.ClassTruck {
				if spec.Corridor == corridors.NairobiMetro {
					avgSpeedKph = rng.Float(26, 38)
				} else {
					avgSpeedKph = rng.Float(48, 68)
				}
			} else {
				avgSpeedKph = rng.Float(24, 46)
			}

			durationH := distanceKm / avgSpeedKph
			startEat := cursor
			endEat := startEat + int64(durationH*float64(hourMillis))
			if endEat > nowEat {
				break
			}

			// Continuous movement: every leg starts exactly where the previous one
			// ended and bounces between the corridor's ends. Keeping the position
			// timeline physically coherent is what lets the fuel engine trust it —
			// a fill logged near a leg's start lands where the vehicle actually was.
			span := math.Min(0.9, math.Max(0.02, distanceKm/math.Max(40, lengthKm)))
			endFraction := fraction + direction*span
			if endFraction > 1 {
				direction = -1
				endFraction = fraction + direction*span
			} else if endFraction < 0 {
				direction = 1
				endFraction = fraction + direction*span
			}
			startFrac := fraction
			endFrac := math.Max(0, math.Min(1, endFraction))
			fraction = endFrac

			maxSpeedKph := avgSpeedKph * rng.Float(1.05, pickFloat(spec.Profile == ProfileClean, 1.22, 1.45))
			overspeedRatio := math.Max(0, (maxSpeedKph-80)/math.Max(1, maxSpeedKph))
			overspeedSeconds := math.Round(overspeedRatio * durationH * 3600 * rng.Float(0.2, 0.6))

			var idlingMinutes float64
			if spec.Corridor == corridors.NairobiMetro {
				idlingMinutes = math.Round(rng.Float(6, 26))
			} else {
				idlingMinutes = math.Round(rng.Float(2, 14))
			}

			tripNo++
			trips = append(trips, domain.Trip{
				ID:                  fmt.Sprintf("trp_%03d_%04d", specIndex(spec), tripNo),
				VehicleID:           vehicleID,
				DriverID:            driverID,
				StartTS:             fromEatMillis(startEat),
				EndTS:               fromEatMillis(endEat),
				DistanceKm:          distanceKm,
				Corridor:            spec.Corridor,
				StartFraction:       domain.Round(startFrac, 4),
				EndFraction:         domain.Round(endFrac, 4),
				AvgSpeedKph:         domain.Round(avgSpeedKph, 1),
				MaxSpeedKph:         domain.Round(maxSpeedKph, 1),
				OverspeedSeconds:    overspeedSeconds,
				IdlingMinutes:       idlingMinutes,
				OffCorridorDetourKm: detourKm(rng, spec.Profile),
			})

			cursor = endEat + int64(rng.Float(0.6, 3)*float64(hourMillis))
		}
	}

	return trips
}

func detourKm(rng *domain.Rng, profile FraudProfile) float64 {
	if profile == ProfileCollusion {
		return domain.Round(rng.Float(4, 22), 1)
	}
	return domain.Round(rng.Float(0, 3), 1)
}

func pickFloat(cond bool, ifTrue, ifFalse float64) float64 {
	if cond {
		return ifTrue
	}
	return ifFalse
}

// specIndex derives the 1-based fixture index of a vehicle from its plate.
func specIndex(spec vehicleSpec) int {
	for i, s := range vehicleSpecs {
		if s.Plate == spec.Plate {
			return i + 1
		}
	}
	return 0
}

// ---------------------------------------------------------------------------
// Fuel history
// ---------------------------------------------------------------------------

type fuelState struct {
	level    float64
	odometer float64
}

// generateFuelHistory walks the trip plan chronologically, burning fuel at the
// vehicle's nominal efficiency and booking each card transaction *after* the leg
// that caused it. That ordering is the whole point: the ledger and the odometer
// then tell the same story, and anything left over is genuinely unexplained.
func generateFuelHistory(
	rng *domain.Rng,
	spec vehicleSpec,
	vehicleID, driverID, cardID string,
	trips []domain.Trip,
	state *fuelState,
	nowEat int64,
) []domain.FuelTransaction {
	ordered := make([]domain.Trip, len(trips))
	copy(ordered, trips)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].StartTS.Before(ordered[j].StartTS) })

	var out []domain.FuelTransaction
	txNo := 0
	// Timestamps must stay strictly ordered across the ledger: two fills with no
	// driving between them would look exactly like theft to the engine.
	lastEventTs := int64(0)

	for i, trip := range ordered {
		nextTripStart := nowEat
		if i+1 < len(ordered) {
			nextTripStart = eatMillis(ordered[i+1].StartTS)
		}

		burn := trip.DistanceKm / spec.KmPerLitre
		state.level = math.Max(0.5, state.level-burn)
		state.odometer += trip.DistanceKm

		levelFraction := state.level / spec.TankCapacityL
		// The collusion profile tops up high and often, which is itself part of
		// its signature; ghost fills are injected separately on workshop days.
		needsFuel := levelFraction <= refillThreshold ||
			(spec.Profile == ProfileCollusion && levelFraction <= 0.72)
		if !needsFuel {
			continue
		}

		tripEnd := eatMillis(trip.EndTS)
		floor := max64(lastEventTs+10*60*1000, tripEnd+20*60*1000)

		var windowFrom, windowTo int64
		if spec.Profile == ProfileCollusion {
			windowFrom = max64(floor, startOfNextEatDay(tripEnd)+hourMillis)
			windowTo = max64(windowFrom, startOfNextEatDay(tripEnd)+4*hourMillis)
		} else {
			windowFrom = floor
			windowTo = max64(floor, min64(nextTripStart-30*60*1000, tripEnd+2*hourMillis))
		}
		ts := int64(rng.Float(float64(windowFrom), float64(windowTo)))
		if ts+60*1000 > nowEat {
			continue
		}

		fillFraction := trip.EndFraction
		if spec.Profile == ProfileCollusion {
			fillFraction = trip.StartFraction
		}
		positionAtFill := geo.PointAlongPolyline(corridors.ByID[spec.Corridor].Waypoints, clamp01(fillFraction))

		headroom := spec.TankCapacityL - state.level
		target := spec.TankCapacityL*fillTarget - state.level

		litres := math.Max(0, target)
		// How much of the charged volume actually reaches the tank. The gap
		// between litres and absorbed is the physical fuel loss, and it is what
		// the engine's mass balance later rediscovers without being told.
		absorbed := litres
		odometerAtPump := domain.Round(state.odometer, 0)
		station := corridors.NearestStation(positionAtFill)

		switch spec.Profile {
		case ProfileSiphon:
			// Direct pilferage on some fills: charged for a full top-up, but only
			// a fraction reaches the tank, so the vehicle keeps needing fuel far
			// more often than its duty cycle can justify.
			if rng.Bool(0.45) {
				litres = math.Max(litres, headroom*rng.Float(0.85, 1.0))
				absorbed = litres * rng.Float(0.35, 0.6)
			}
		case ProfileOverfill:
			// Billed volume above the tank's physical capacity — the classic
			// attendant-entered volume fraud, and the one case that needs no
			// reconstruction at all to prove.
			if rng.Bool(0.5) {
				litres = spec.TankCapacityL * rng.Float(1.05, 1.22)
				absorbed = headroom
			}
		case ProfilePhantomStation:
			// Transaction logged at a station the truck was nowhere near.
			if far := corridors.StationsFartherThan(positionAtFill, 150); len(far) > 0 && rng.Bool(0.6) {
				station = domain.Pick(rng, far)
			}
		case ProfileCollusion:
			// Attendant padding of roughly a fifth at a single independent stop.
			// Individually each fill passes every per-transaction check; only the
			// cadence and concentration give it away.
			station = corridors.IndependentStation
			litres = headroom * rng.Float(1.08, 1.32)
			absorbed = headroom
		}

		if litres < 8 {
			continue
		}

		unitPriceKes := domain.Round(rng.Float(178, 196), 2)
		tx := domain.FuelTransaction{
			ID:           fmt.Sprintf("ftx_%03d_%04d", specIndex(spec), txNo+1),
			CardID:       cardID,
			VehicleID:    vehicleID,
			DriverID:     driverID,
			TS:           fromEatMillis(ts),
			Litres:       domain.Round(litres, 2),
			UnitPriceKes: unitPriceKes,
			TotalKes:     domain.Round(litres*unitPriceKes, 2),
			StationName:  station.Name,
			Position:     station.Position,
		}
		txNo++
		if rng.Bool(0.7) {
			tx.ReceiptURL = fmt.Sprintf("/receipts/%s/%04d.jpg", vehicleID, txNo)
		}
		pump := odometerAtPump
		tx.OdometerAtPumpKm = &pump
		out = append(out, tx)

		// Only the absorbed volume enters the tank; an overfill beyond capacity
		// simply cannot land anywhere.
		state.level = math.Min(spec.TankCapacityL, state.level+absorbed)
		lastEventTs = ts
	}

	// Ghost profile: fills charged on scheduled workshop days, provably while the
	// vehicle never moved.
	if spec.Profile == ProfileGhost {
		currentDay := nowEat / dayMillis
		for back := int64(1); back <= 24; back++ {
			day := currentDay - back
			if !downtimeDay(spec, int(day)) {
				continue
			}
			ts := day*dayMillis + 14*hourMillis + int64(rng.Int(0, 90))*60*1000
			if ts > nowEat {
				continue
			}
			station := domain.Pick(rng, corridors.Stations)
			litres := domain.Round(spec.TankCapacityL*rng.Float(0.7, 0.92), 2)
			unitPriceKes := domain.Round(rng.Float(178, 196), 2)
			out = append(out, domain.FuelTransaction{
				ID:           fmt.Sprintf("ftx_%03d_g%d", specIndex(spec), back),
				CardID:       cardID,
				VehicleID:    vehicleID,
				DriverID:     driverID,
				TS:           fromEatMillis(ts),
				Litres:       litres,
				UnitPriceKes: unitPriceKes,
				TotalKes:     domain.Round(litres*unitPriceKes, 2),
				StationName:  station.Name,
				Position:     station.Position,
			})
			// The tank is unaffected: this fuel never entered the vehicle.
		}
	}

	sort.Slice(out, func(i, j int) bool { return out[i].TS.Before(out[j].TS) })
	return out
}

// ---------------------------------------------------------------------------
// Live telemetry
// ---------------------------------------------------------------------------

// buildTelemetry produces the last 48 hours of fixes: 15-minute cadence inside
// trips and hourly while parked, which is what a real tracker reports.
func buildTelemetry(rng *domain.Rng, vehicles []domain.Vehicle, trips []domain.Trip, nowEat int64) []domain.TelemetryPing {
	var pings []domain.TelemetryPing
	from := nowEat - telemetryHours*hourMillis

	for _, vehicle := range vehicles {
		var vehicleTrips []domain.Trip
		for _, t := range trips {
			if t.VehicleID == vehicle.ID {
				vehicleTrips = append(vehicleTrips, t)
			}
		}
		sort.Slice(vehicleTrips, func(i, j int) bool { return vehicleTrips[i].StartTS.Before(vehicleTrips[j].StartTS) })

		corridor := corridors.ByID[vehicle.Corridor]
		depot := corridors.DepotPoint(vehicle.HomeDepot)
		deviceID := vehicle.DeviceID

		for t := from; t <= nowEat; t += 15 * 60 * 1000 {
			var active *domain.Trip
			for i := range vehicleTrips {
				if start, end := eatMillis(vehicleTrips[i].StartTS), eatMillis(vehicleTrips[i].EndTS); t >= start && t <= end {
					active = &vehicleTrips[i]
					break
				}
			}

			var (
				position   domain.Point
				speedKph   float64
				ignition   bool
				headingDeg float64
			)

			if active != nil {
				start := eatMillis(active.StartTS)
				end := eatMillis(active.EndTS)
				progress := float64(t-start) / math.Max(1, float64(end-start))
				frac := active.StartFraction + (active.EndFraction-active.StartFraction)*progress
				base := geo.PointAlongPolyline(corridor.Waypoints, clamp01(frac))
				// Wander slightly off-centre to look like real road noise.
				position = geo.OffsetPoint(base, rng.Float(0, 1.4), rng.Float(0, 360))
				speedKph = math.Max(0, active.AvgSpeedKph*rng.Float(0.5, 1.3))
				ignition = true
				headingDeg = rng.Float(0, 360)
			} else {
				// Hourly only while parked.
				if t%hourMillis > 60*1000 {
					continue
				}
				position = geo.OffsetPoint(depot, rng.Float(0, 0.25), rng.Float(0, 360))
				speedKph = 0
				ignition = rng.Bool(0.12)
				headingDeg = rng.Float(0, 360)
			}

			progressFraction := float64(t-from) / math.Max(1, float64(nowEat-from))
			ping := domain.TelemetryPing{
				VehicleID:  vehicle.ID,
				DeviceID:   deviceID,
				Vendor:     domain.VendorCarTrack,
				TS:         fromEatMillis(t),
				Position:   domain.Point{Lat: domain.Round(position.Lat, 5), Lng: domain.Round(position.Lng, 5)},
				SpeedKph:   domain.Round(speedKph, 1),
				HeadingDeg: domain.Round(headingDeg, 0),
				Ignition:   ignition,
			}
			if active == nil {
				// Parked fixes carry a device odometer and a fuel-probe reading,
				// the way a real tracker reports while stationary.
				odo := math.Round(vehicle.OdometerKm - (1-progressFraction)*5)
				ping.OdometerKm = &odo
				level := domain.Round(vehicle.TankCapacityL*rng.Float(0.3, 0.8), 1)
				ping.FuelLevelL = &level
			}
			pings = append(pings, ping)
		}
	}

	sort.Slice(pings, func(i, j int) bool { return pings[i].TS.Before(pings[j].TS) })
	return pings
}

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

func clamp01(v float64) float64 { return math.Max(0, math.Min(1, v)) }
func max64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
func min64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}
