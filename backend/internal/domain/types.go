// Package domain holds the shared vocabulary of VektorFleet: the types that the
// seed generator, the engines, the store and the HTTP API all agree on.
//
// Every type is a plain data struct with explicit JSON tags, so the wire format
// is stated once here rather than being inferred from handler code.
package domain

import "time"

// ---------------------------------------------------------------------------
// Geography and network
// ---------------------------------------------------------------------------

// Point is a WGS-84 coordinate.
type Point struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

// Corridor is a modelled logistics route, stored as an ordered centreline.
type Corridor struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Waypoints []Point `json:"waypoints"`
}

// StationProvider identifies who operates a fuelling point. Independent
// operators sit outside a corporate card network's controls, which is why they
// matter to the fraud engine.
type StationProvider string

const (
	ProviderRubis       StationProvider = "rubis"
	ProviderTotal       StationProvider = "total"
	ProviderShell       StationProvider = "shell"
	ProviderIndependent StationProvider = "independent"
)

// FuelStation is a fuelling point the fleet can transact at.
type FuelStation struct {
	Name     string          `json:"name"`
	Position Point           `json:"position"`
	Provider StationProvider `json:"provider"`
}

// ---------------------------------------------------------------------------
// Fleet assets
// ---------------------------------------------------------------------------

// VehicleClass is the physical category of the asset.
type VehicleClass string

const (
	ClassTruck      VehicleClass = "truck"
	ClassVan        VehicleClass = "van"
	ClassPickup     VehicleClass = "pickup"
	ClassPrimeMover VehicleClass = "prime_mover"
	ClassMatatu     VehicleClass = "matatu"
)

// VehicleStatus is the operational state reported by the platform.
type VehicleStatus string

const (
	StatusActive      VehicleStatus = "active"
	StatusIdle        VehicleStatus = "idle"
	StatusMaintenance VehicleStatus = "maintenance"
	StatusOffline     VehicleStatus = "offline"
)

// Vehicle is a single asset under management.
type Vehicle struct {
	ID               string        `json:"id"`
	Plate            string        `json:"plate"`
	FleetID          string        `json:"fleetId"`
	Class            VehicleClass  `json:"class"`
	Make             string        `json:"make"`
	Model            string        `json:"model"`
	Year             int           `json:"year"`
	FuelType         string        `json:"fuelType"`
	TankCapacityL    float64       `json:"tankCapacityL"`
	KmPerLitre       float64       `json:"kmPerLitre"`
	OdometerKm       float64       `json:"odometerKm"`
	Status           VehicleStatus `json:"status"`
	Corridor         string        `json:"corridor"`
	HomeDepot        string        `json:"homeDepot"`
	DeviceID         string        `json:"deviceId"`
	DriverID         string        `json:"driverId"`
	GovernorLimitKph float64       `json:"governorLimitKph"`
}

// Driver is the person accountable for a vehicle on a shift.
type Driver struct {
	ID                string    `json:"id"`
	Name              string    `json:"name"`
	Phone             string    `json:"phone"`
	LicenceNo         string    `json:"licenceNo"`
	LicenceExpiry     time.Time `json:"licenceExpiry"`
	AssignedVehicleID string    `json:"assignedVehicleId"`
	Score             int       `json:"score"`
}

// GpsVendorID identifies a tracker brand already fitted to a customer vehicle.
type GpsVendorID string

const (
	VendorCarTrack   GpsVendorID = "cartrack"
	VendorSafeRide   GpsVendorID = "saferide"
	VendorTeltonika  GpsVendorID = "teltonika"
	VendorRuptela    GpsVendorID = "ruptela"
	VendorGenericTCP GpsVendorID = "generic_tcp"
)

// GpsDevice is one transponder.
type GpsDevice struct {
	ID             string      `json:"id"`
	IMEI           string      `json:"imei"`
	Vendor         GpsVendorID `json:"vendor"`
	VendorDeviceID string      `json:"vendorDeviceId"`
	VehicleID      string      `json:"vehicleId"`
	Firmware       string      `json:"firmware"`
	LastSeenAt     time.Time   `json:"lastSeenAt"`
	Online         bool        `json:"online"`
}

// TelemetryPing is one normalised position sample. Every vendor payload is
// flattened into this shape at the edge, so nothing downstream knows or cares
// which brand produced it.
type TelemetryPing struct {
	VehicleID    string      `json:"vehicleId"`
	DeviceID     string      `json:"deviceId"`
	Vendor       GpsVendorID `json:"vendor"`
	TS           time.Time   `json:"ts"`
	Position     Point       `json:"position"`
	SpeedKph     float64     `json:"speedKph"`
	HeadingDeg   float64     `json:"headingDeg"`
	Ignition     bool        `json:"ignition"`
	OdometerKm   *float64    `json:"odometerKm,omitempty"`
	FuelLevelL   *float64    `json:"fuelLevelL,omitempty"`
	DelayedSync  bool        `json:"delayedSync,omitempty"`
}

// Trip is a completed movement between two points on a corridor. The trip index
// is the backbone of fuel forensics: it answers both "how far did this vehicle
// actually drive between two fills" and "where was it at any instant".
type Trip struct {
	ID                 string    `json:"id"`
	VehicleID          string    `json:"vehicleId"`
	DriverID           string    `json:"driverId"`
	StartTS            time.Time `json:"startTs"`
	EndTS              time.Time `json:"endTs"`
	DistanceKm         float64   `json:"distanceKm"`
	Corridor           string    `json:"corridor"`
	StartFraction      float64   `json:"startFraction"`
	EndFraction        float64   `json:"endFraction"`
	AvgSpeedKph        float64   `json:"avgSpeedKph"`
	MaxSpeedKph        float64   `json:"maxSpeedKph"`
	OverspeedSeconds   float64   `json:"overspeedSeconds"`
	IdlingMinutes      float64   `json:"idlingMinutes"`
	OffCorridorDetourKm float64  `json:"offCorridorDetourKm"`
}

// ---------------------------------------------------------------------------
// Fuel
// ---------------------------------------------------------------------------

// FuelCard is a corporate card bound to a vehicle and a driver.
type FuelCard struct {
	ID        string          `json:"id"`
	Provider  StationProvider `json:"provider"`
	MaskedPan string          `json:"maskedPan"`
	VehicleID string          `json:"vehicleId"`
	DriverID  string          `json:"driverId"`
}

// FuelTransaction is one card capture at the pump.
type FuelTransaction struct {
	ID               string    `json:"id"`
	CardID           string    `json:"cardId"`
	VehicleID        string    `json:"vehicleId"`
	DriverID         string    `json:"driverId"`
	TS               time.Time `json:"ts"`
	Litres           float64   `json:"litres"`
	UnitPriceKes     float64   `json:"unitPriceKes"`
	TotalKes         float64   `json:"totalKes"`
	StationName      string    `json:"stationName"`
	Position         Point     `json:"position"`
	OdometerAtPumpKm *float64  `json:"odometerAtPumpKm,omitempty"`
	ReceiptURL       string    `json:"receiptUrl,omitempty"`
}

// FlagCode enumerates the ways a fill can fail to add up.
type FlagCode string

const (
	FlagOverfillImpossible FlagCode = "OVERFILL_IMPOSSIBLE"
	FlagExcessLitres       FlagCode = "EXCESS_LITRES"
	FlagStationMismatch    FlagCode = "STATION_MISMATCH"
	FlagGhostFill          FlagCode = "GHOST_FILL"
	FlagCollusionPattern   FlagCode = "COLLUSION_PATTERN"
	FlagOffHoursFill       FlagCode = "OFF_HOURS_FILL"
	FlagOdometerRegression FlagCode = "ODOMETER_REGRESSION"
)

// Severity ranks a finding for triage.
type Severity string

const (
	SeverityCritical Severity = "critical"
	SeverityHigh     Severity = "high"
	SeverityMedium   Severity = "medium"
	SeverityLow      Severity = "low"
)

// FuelFlag is a single, self-contained accusation with its own evidence.
type FuelFlag struct {
	ID              string    `json:"id"`
	Code            FlagCode  `json:"code"`
	Severity        Severity  `json:"severity"`
	VehicleID       string    `json:"vehicleId"`
	DriverID        string    `json:"driverId"`
	TransactionID   string    `json:"transactionId"`
	Headline        string    `json:"headline"`
	Detail          string    `json:"detail"`
	ExpectedLitres  *float64  `json:"expectedLitres"`
	ActualLitres    float64   `json:"actualLitres"`
	ExposureKes     float64   `json:"exposureKes"`
	Confidence      float64   `json:"confidence"`
	DetectedAt      time.Time `json:"detectedAt"`
}

// Reconciliation is one vehicle's fuel ledger, rebuilt from first principles.
type Reconciliation struct {
	VehicleID       string    `json:"vehicleId"`
	Plate           string    `json:"plate"`
	Transactions    int       `json:"transactions"`
	TotalLitres     float64   `json:"totalLitres"`
	TotalSpendKes   float64   `json:"totalSpendKes"`
	ExpectedLitres  float64   `json:"expectedLitres"`
	UnverifiedLitres float64  `json:"unverifiedLitres"`
	LeakagePercent  float64   `json:"leakagePercent"`
	ExposureKes     float64   `json:"exposureKes"`
	Flags           []FuelFlag `json:"flags"`
	ClosingLevelL   *float64  `json:"closingLevelL"`
}

// AuditTotals aggregates a fleet-wide audit.
type AuditTotals struct {
	Litres           float64            `json:"litres"`
	SpendKes         float64            `json:"spendKes"`
	ExpectedLitres   float64            `json:"expectedLitres"`
	UnverifiedLitres float64            `json:"unverifiedLitres"`
	LeakagePercent   float64            `json:"leakagePercent"`
	ExposureKes      float64            `json:"exposureKes"`
	BySeverity       map[Severity]int   `json:"bySeverity"`
	ByCode           map[FlagCode]int   `json:"byCode"`
}

// FleetAudit is the engine's whole-of-book output.
type FleetAudit struct {
	Reconciliations []Reconciliation `json:"reconciliations"`
	Flags           []FuelFlag       `json:"flags"`
	Totals          AuditTotals      `json:"totals"`
}

// ---------------------------------------------------------------------------
// Compliance
// ---------------------------------------------------------------------------

// ComplianceCategory is a statutory obligation family.
type ComplianceCategory string

const (
	CategoryNTASInspection ComplianceCategory = "NTSA_INSPECTION"
	CategorySpeedGovernor  ComplianceCategory = "SPEED_GOVERNOR"
	CategoryInsurance      ComplianceCategory = "INSURANCE"
	CategoryTransitLicence ComplianceCategory = "TRANSIT_LICENCE"
	CategoryCountyPermit   ComplianceCategory = "COUNTY_PERMIT"
	CategoryKRATax         ComplianceCategory = "KRA_TAX"
	CategoryEmission       ComplianceCategory = "EMISSION"
)

// ComplianceStatus is the computed urgency band.
type ComplianceStatus string

const (
	ComplianceOK       ComplianceStatus = "ok"
	ComplianceDueSoon  ComplianceStatus = "due_soon"
	ComplianceCritical ComplianceStatus = "critical"
	ComplianceExpired  ComplianceStatus = "expired"
)

// ComplianceItem is a tracked obligation on one vehicle.
type ComplianceItem struct {
	ID              string             `json:"id"`
	VehicleID       string             `json:"vehicleId"`
	Category        ComplianceCategory `json:"category"`
	Title           string             `json:"title"`
	Authority       string             `json:"authority"`
	DueDate         time.Time          `json:"dueDate"`
	LastCompletedAt *time.Time         `json:"lastCompletedAt,omitempty"`
	LeadDays        int                `json:"leadDays"`
	Notes           string             `json:"notes,omitempty"`
}

// ComplianceEvaluation is an item plus its computed urgency and money at risk.
type ComplianceEvaluation struct {
	ComplianceItem
	Status              ComplianceStatus `json:"status"`
	DaysRemaining       int              `json:"daysRemaining"`
	PenaltyExposureKes  float64          `json:"penaltyExposureKes"`
}

// AlertChannel is how a reminder reaches a human.
type AlertChannel string

const (
	ChannelWhatsApp AlertChannel = "whatsapp"
	ChannelSMS      AlertChannel = "sms"
	ChannelEmail    AlertChannel = "email"
)

// AlertTier is the escalation rung.
type AlertTier string

const (
	Tier30      AlertTier = "T-30"
	Tier7       AlertTier = "T-7"
	Tier1       AlertTier = "T-1"
	TierOverdue AlertTier = "OVERDUE"
)

// ComplianceAlert is a scheduled dispatch.
type ComplianceAlert struct {
	ID            string       `json:"id"`
	ItemID        string       `json:"itemId"`
	VehicleID     string       `json:"vehicleId"`
	DueDate       time.Time    `json:"dueDate"`
	DaysRemaining int          `json:"daysRemaining"`
	Channel       AlertChannel `json:"channel"`
	Tier          AlertTier    `json:"tier"`
	Message       string       `json:"message"`
}

// ---------------------------------------------------------------------------
// WhatsApp driver assistant
// ---------------------------------------------------------------------------

// WhatsAppStep is a state in the bot's conversation machine.
type WhatsAppStep string

const (
	StepIdle        WhatsAppStep = "IDLE"
	StepPreTrip     WhatsAppStep = "PRE_TRIP"
	StepOdometer    WhatsAppStep = "ODOMETER"
	StepFuelReceipt WhatsAppStep = "FUEL_RECEIPT"
	StepIncident    WhatsAppStep = "INCIDENT"
	StepDone        WhatsAppStep = "DONE"
)

// WhatsAppSession is the bot's memory for one driver number.
type WhatsAppSession struct {
	Phone          string            `json:"phone"`
	DriverID       string            `json:"driverId"`
	Step           WhatsAppStep      `json:"step"`
	ChecklistIndex int               `json:"checklistIndex"`
	Answers        map[string]string `json:"answers"`
	UpdatedAt      time.Time         `json:"updatedAt"`
}

// WhatsAppMessage is one turn in the thread.
type WhatsAppMessage struct {
	ID        string    `json:"id"`
	Phone     string    `json:"phone"`
	Direction string    `json:"direction"`
	Body      string    `json:"body"`
	TS        time.Time `json:"ts"`
	MediaURL  string    `json:"mediaUrl,omitempty"`
}

// TripReport is the structured output of a completed pre-trip checklist.
type TripReport struct {
	ID             string            `json:"id"`
	DriverID       string            `json:"driverId"`
	VehicleID      string            `json:"vehicleId"`
	SubmittedAt    time.Time         `json:"submittedAt"`
	Checklist      map[string]string `json:"checklist"`
	OdometerKm     *float64          `json:"odometerKm,omitempty"`
	ReceiptMediaURL string           `json:"receiptMediaUrl,omitempty"`
}

// OfflineEnvelope preserves a field entry captured with no signal.
type OfflineEnvelope struct {
	ID         string    `json:"id"`
	Kind       string    `json:"kind"`
	CapturedAt time.Time `json:"capturedAt"`
	EnqueuedAt time.Time `json:"enqueuedAt"`
	DeviceID   string    `json:"deviceId"`
	Payload    any       `json:"payload"`
	Synced     bool      `json:"synced"`
}

// ---------------------------------------------------------------------------
// Derived analytics
// ---------------------------------------------------------------------------

// VehicleSnapshot is the per-vehicle row the console renders.
type VehicleSnapshot struct {
	Vehicle          Vehicle                `json:"vehicle"`
	Driver           *Driver                `json:"driver"`
	Device           *GpsDevice             `json:"device"`
	LastPing         *TelemetryPing         `json:"lastPing"`
	Distance24hKm    float64                `json:"distance24hKm"`
	LiveKmPerLitre   *float64               `json:"liveKmPerLitre"`
	OverspeedEvents  int                    `json:"overspeedEvents"`
	IdlingMinutes    float64                `json:"idlingMinutes"`
	OpenFlags        int                    `json:"openFlags"`
	Compliance       []ComplianceEvaluation `json:"compliance"`
	ComplianceStatus ComplianceStatus       `json:"complianceStatus"`
}

// SavingsBreakdown is one auditable line of the payback case.
type SavingsBreakdown struct {
	Label       string  `json:"label"`
	Description string  `json:"description"`
	AnnualKes   float64 `json:"annualKes"`
	Method      string  `json:"method"`
}

// FleetKpis is the headline pulse of the book of business.
type FleetKpis struct {
	Vehicles             int                `json:"vehicles"`
	Active               int                `json:"active"`
	Offline              int                `json:"offline"`
	DistanceTodayKm      float64            `json:"distanceTodayKm"`
	FuelLitresToday      float64            `json:"fuelLitresToday"`
	FuelSpendTodayKes    float64            `json:"fuelSpendTodayKes"`
	AnnualisedSavingKes  float64            `json:"annualisedSavingKes"`
	UnverifiedLitres     float64            `json:"unverifiedLitres"`
	FlaggedExposureKes   float64            `json:"flaggedExposureKes"`
	OpenCriticalFlags    int                `json:"openCriticalFlags"`
	ComplianceExpiring30d int               `json:"complianceExpiring30d"`
	ComplianceExpired    int                `json:"complianceExpired"`
	HealthScore          int                `json:"healthScore"`
	Breakdown            []SavingsBreakdown `json:"breakdown"`
}

// ---------------------------------------------------------------------------
// Seed container
// ---------------------------------------------------------------------------

// Dataset is the generated book of business.
type Dataset struct {
	GeneratedAt      time.Time           `json:"generatedAt"`
	Fleets           []Fleet             `json:"fleets"`
	Vehicles         []Vehicle           `json:"vehicles"`
	Drivers          []Driver            `json:"drivers"`
	Devices          []GpsDevice         `json:"devices"`
	Trips            []Trip              `json:"trips"`
	Telemetry        []TelemetryPing     `json:"telemetry"`
	FuelCards        []FuelCard          `json:"fuelCards"`
	FuelTransactions []FuelTransaction   `json:"fuelTransactions"`
	ComplianceItems  []ComplianceItem    `json:"complianceItems"`
}

// Fleet is a customer account.
type Fleet struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Sector       string `json:"sector"`
	Tier         int    `json:"tier"`
	HQ           string `json:"hq"`
	ContractPlan string `json:"contractPlan"`
	SeatsBilled  int    `json:"seatsBilled"`
}
