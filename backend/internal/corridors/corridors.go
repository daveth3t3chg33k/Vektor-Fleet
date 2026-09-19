// Package corridors describes the logistics network VektorFleet models: the
// named Kenyan trade corridors, the depots on them, and the fuelling points a
// fleet could realistically transact at.
package corridors

import (
	"github.com/vektorfleet/backend/internal/domain"
	"github.com/vektorfleet/backend/internal/geo"
)

// Corridor identifiers used throughout the platform.
const (
	MombasaRoad       = "mombasa_road"
	NorthernCorridor  = "northern_corridor"
	NairobiMetro      = "nairobi_metro"
	ThikaSuperhighway = "thika_superhighway"
	KisumuBranch      = "kisumu_branch"
)

// All is the modelled network. Coordinates are approximate centreline points in
// driving order, which is what lets the trip planner interpolate positions and
// the fuel engine measure how far a vehicle strayed.
var All = []domain.Corridor{
	{
		ID:   MombasaRoad,
		Name: "Mombasa Road (A109)",
		Waypoints: []domain.Point{
			{Lat: -1.3080, Lng: 36.8540},  // Industrial Area, Nairobi
			{Lat: -1.3950, Lng: 36.9380},  // Mlolongo
			{Lat: -1.4565, Lng: 36.9784},  // Athi River
			{Lat: -1.5177, Lng: 37.2634},  // Machakos turnoff
			{Lat: -2.3500, Lng: 37.9000},  // Kibwezi approach
			{Lat: -2.6900, Lng: 38.1700},  // Mtito Andei
			{Lat: -3.3961, Lng: 38.5561},  // Voi
			{Lat: -3.8639, Lng: 39.4765},  // Mariakani
			{Lat: -4.0435, Lng: 39.6682},  // Mombasa port
		},
	},
	{
		ID:   NorthernCorridor,
		Name: "Northern Corridor (A104)",
		Waypoints: []domain.Point{
			{Lat: -4.0435, Lng: 39.6682},  // Mombasa
			{Lat: -3.3961, Lng: 38.5561},  // Voi
			{Lat: -2.6900, Lng: 38.1700},  // Mtito Andei
			{Lat: -1.5177, Lng: 37.2634},  // Machakos
			{Lat: -1.3080, Lng: 36.8540},  // Nairobi
			{Lat: -0.7167, Lng: 36.4359},  // Naivasha
			{Lat: -0.3031, Lng: 36.0800},  // Nakuru
			{Lat: 0.5143, Lng: 35.2698},   // Eldoret
			{Lat: 0.6342, Lng: 34.2814},   // Malaba (UG border)
		},
	},
	{
		ID:   NairobiMetro,
		Name: "Nairobi Metro Distribution",
		Waypoints: []domain.Point{
			{Lat: -1.3080, Lng: 36.8540}, // Industrial Area
			{Lat: -1.2921, Lng: 36.8219}, // CBD
			{Lat: -1.2673, Lng: 36.8065}, // Westlands
			{Lat: -1.3192, Lng: 36.9278}, // JKIA
			{Lat: -1.3800, Lng: 36.7500}, // Ngong Road
		},
	},
	{
		ID:   ThikaSuperhighway,
		Name: "Thika Superhighway (A2)",
		Waypoints: []domain.Point{
			{Lat: -1.2921, Lng: 36.8219}, // Nairobi CBD
			{Lat: -1.0332, Lng: 37.0693}, // Thika
			{Lat: -0.9000, Lng: 37.3000}, // Kenol
			{Lat: -0.4704, Lng: 37.4637}, // Embu road junction
		},
	},
	{
		ID:   KisumuBranch,
		Name: "Nakuru-Kisumu (B1)",
		Waypoints: []domain.Point{
			{Lat: -0.3031, Lng: 36.0800}, // Nakuru
			{Lat: -0.2000, Lng: 35.5000}, // Timboroa
			{Lat: -0.0917, Lng: 34.7680}, // Kisumu
		},
	},
}

// ByID indexes the corridors for lookup.
var ByID = func() map[string]domain.Corridor {
	m := make(map[string]domain.Corridor, len(All))
	for _, c := range All {
		m[c.ID] = c
	}
	return m
}()

// Depots are the yards vehicles start and end their schedules at.
var Depots = []string{
	"Nairobi Industrial Area",
	"Mombasa Changamwe",
	"Nakuru ICD",
	"Eldoret Depot",
	"Athi River Yard",
}

var depotPoints = map[string]domain.Point{
	"Nairobi Industrial Area": {Lat: -1.3080, Lng: 36.8540},
	"Mombasa Changamwe":       {Lat: -4.0237, Lng: 39.6293},
	"Nakuru ICD":              {Lat: -0.3031, Lng: 36.0800},
	"Eldoret Depot":           {Lat: 0.5143, Lng: 35.2698},
	"Athi River Yard":         {Lat: -1.4565, Lng: 36.9784},
}

// DepotPoint resolves a depot name to its coordinate, falling back to Nairobi
// Industrial Area for anything unrecognised.
func DepotPoint(name string) domain.Point {
	if p, ok := depotPoints[name]; ok {
		return p
	}
	return depotPoints["Nairobi Industrial Area"]
}

// BrandedStations are the retail networks an enterprise fuel card actually
// settles against.
var BrandedStations = []domain.FuelStation{
	{Name: "Rubis Mlolongo", Position: domain.Point{Lat: -1.3951, Lng: 36.9384}, Provider: domain.ProviderRubis},
	{Name: "Total Athi River", Position: domain.Point{Lat: -1.4562, Lng: 36.9781}, Provider: domain.ProviderTotal},
	{Name: "Rubis Voi", Position: domain.Point{Lat: -3.3958, Lng: 38.5567}, Provider: domain.ProviderRubis},
	{Name: "Total Mariakani", Position: domain.Point{Lat: -3.8635, Lng: 39.4771}, Provider: domain.ProviderTotal},
	{Name: "Shell Changamwe", Position: domain.Point{Lat: -4.0237, Lng: 39.6293}, Provider: domain.ProviderShell},
	{Name: "Total Nakuru", Position: domain.Point{Lat: -0.3028, Lng: 36.0805}, Provider: domain.ProviderTotal},
	{Name: "Shell Industrial Area", Position: domain.Point{Lat: -1.3085, Lng: 36.8536}, Provider: domain.ProviderShell},
	{Name: "Rubis Eldoret", Position: domain.Point{Lat: 0.5141, Lng: 35.2701}, Provider: domain.ProviderRubis},
}

// IndependentStation is the archetypal venue for collusive fuelling: it sits
// outside the corporate card's branded network controls.
var IndependentStation = domain.FuelStation{
	Name:     "Makutano Fuels · Machakos bypass",
	Position: domain.Point{Lat: -1.5305, Lng: 37.3102},
	Provider: domain.ProviderIndependent,
}

// corridorTowns labels the generated stops. Stations are placed at roughly 40 km
// intervals along each centreline, so a vehicle is never more than about 20 km
// from a plausible fuelling point. Without that density the station-mismatch
// detector would fire on honest fills in sparsely serviced stretches such as Tsavo.
var corridorTowns = map[string][]string{
	MombasaRoad:       {"Mlolongo", "Athi River", "Salama", "Sultan Hamud", "Emali", "Kibwezi", "Mtito Andei", "Tsavo", "Voi", "Mackinnon Road", "Samburu", "Mariakani", "Changamwe"},
	NorthernCorridor:  {"Changamwe", "Voi", "Mtito Andei", "Athi River", "Naivasha", "Gilgil", "Nakuru", "Salgaa", "Timboroa", "Eldoret", "Webuye", "Bungoma", "Malaba"},
	NairobiMetro:      {"Industrial Area", "CBD", "Westlands", "JKIA", "Karen", "Ngong"},
	ThikaSuperhighway: {"Ruiru", "Juja", "Thika", "Kenol", "Sagana", "Karatina", "Embu Junction"},
	KisumuBranch:      {"Nakuru", "Timboroa", "Kapsabet", "Kisumu", "Ahero", "Muhoroni"},
}

var corridorTag = map[string]string{
	MombasaRoad:       "A109",
	NorthernCorridor:  "A104",
	NairobiMetro:      "Metro",
	ThikaSuperhighway: "A2",
	KisumuBranch:      "B1",
}

var providerCycle = []domain.StationProvider{
	domain.ProviderRubis,
	domain.ProviderTotal,
	domain.ProviderShell,
	domain.ProviderIndependent,
	domain.ProviderTotal,
	domain.ProviderRubis,
}

func buildCorridorStations() []domain.FuelStation {
	var stations []domain.FuelStation
	for _, corridor := range All {
		lengthKm := geo.PolylineLengthKm(corridor.Waypoints)
		stops := int(lenRounding(lengthKm / 40))
		if stops < 2 {
			stops = 2
		}
		towns := corridorTowns[corridor.ID]
		tag := corridorTag[corridor.ID]

		for i := 0; i <= stops; i++ {
			town := "Stop"
			if len(towns) > 0 {
				town = towns[i%len(towns)]
			}
			stations = append(stations, domain.FuelStation{
				Name:     town + " · " + tag,
				Position: geo.PointAlongPolyline(corridor.Waypoints, float64(i)/float64(stops)),
				Provider: providerCycle[i%len(providerCycle)],
			})
		}
	}
	return stations
}

func lenRounding(v float64) float64 {
	// Round half away from zero, matching the generator's expectations.
	if v < 0 {
		return float64(int(v - 0.5))
	}
	return float64(int(v + 0.5))
}

// Stations is every fuelling point the generator and engines consider.
var Stations = func() []domain.FuelStation {
	out := make([]domain.FuelStation, 0, len(BrandedStations)+1+64)
	out = append(out, BrandedStations...)
	out = append(out, IndependentStation)
	out = append(out, buildCorridorStations()...)
	return out
}()

// NearestStation returns the fuelling point closest to a coordinate.
func NearestStation(p domain.Point) domain.FuelStation {
	best := Stations[0]
	bestDistance := geo.HaversineKm(best.Position, p)
	for _, s := range Stations[1:] {
		if d := geo.HaversineKm(s.Position, p); d < bestDistance {
			best, bestDistance = s, d
		}
	}
	return best
}

// StationsFartherThan returns every station at least minKm from a coordinate.
func StationsFartherThan(p domain.Point, minKm float64) []domain.FuelStation {
	var out []domain.FuelStation
	for _, s := range Stations {
		if geo.HaversineKm(s.Position, p) > minKm {
			out = append(out, s)
		}
	}
	return out
}
