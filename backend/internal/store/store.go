// Package store holds the platform's state: the generated book of business and
// the mutable runtime data (chat sessions, trip reports, the offline queue).
//
// The seeded dataset is built once and never mutated, so every read is a plain
// map or slice lookup. Only genuinely mutable state — ingested telemetry and the
// WhatsApp runtime — takes a write lock. That split is what keeps an in-memory
// store honest under `go test -race` without turning every read into a
// bottleneck.
package store

import (
	"fmt"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/vektorfleet/backend/internal/domain"
	"github.com/vektorfleet/backend/internal/seed"
)

// telemetryBufferLimit bounds memory if a vendor floods the ingest endpoint.
const telemetryBufferLimit = 25_000

// Store is the application's data layer. Swap the body of New for a database
// client and nothing upstream changes.
type Store struct {
	mu sync.RWMutex
	ds *domain.Dataset

	vehicleByID     map[string]*domain.Vehicle
	vehicleByPlate  map[string]*domain.Vehicle
	driverByID      map[string]*domain.Driver
	driverByPhone   map[string]*domain.Driver
	deviceByVehicle map[string]*domain.GpsDevice
	tripsByVehicle  map[string][]domain.Trip
	txByVehicle     map[string][]domain.FuelTransaction
	complianceByVeh map[string][]domain.ComplianceItem
	cardByID        map[string]*domain.FuelCard

	sessions    map[string]domain.WhatsAppSession
	messages    []domain.WhatsAppMessage
	tripReports []domain.TripReport
	queue       []domain.OfflineEnvelope

	seq atomic.Uint64
}

// New builds a store from a freshly generated dataset.
func New(now time.Time) *Store {
	ds := seed.Generate(now)
	s := &Store{
		ds:              ds,
		vehicleByID:     make(map[string]*domain.Vehicle, len(ds.Vehicles)),
		vehicleByPlate:  make(map[string]*domain.Vehicle, len(ds.Vehicles)),
		driverByID:      make(map[string]*domain.Driver, len(ds.Drivers)),
		driverByPhone:   make(map[string]*domain.Driver, len(ds.Drivers)),
		deviceByVehicle: make(map[string]*domain.GpsDevice, len(ds.Devices)),
		tripsByVehicle:  make(map[string][]domain.Trip, len(ds.Vehicles)),
		txByVehicle:     make(map[string][]domain.FuelTransaction, len(ds.Vehicles)),
		complianceByVeh: make(map[string][]domain.ComplianceItem, len(ds.Vehicles)),
		cardByID:        make(map[string]*domain.FuelCard, len(ds.FuelCards)),
		sessions:        make(map[string]domain.WhatsAppSession),
	}

	for i := range ds.Vehicles {
		v := &ds.Vehicles[i]
		s.vehicleByID[v.ID] = v
		s.vehicleByPlate[plateKey(v.Plate)] = v
	}
	for i := range ds.Drivers {
		d := &ds.Drivers[i]
		s.driverByID[d.ID] = d
		s.driverByPhone[NormalisePhone(d.Phone)] = d
	}
	for i := range ds.Devices {
		s.deviceByVehicle[ds.Devices[i].VehicleID] = &ds.Devices[i]
	}
	for _, t := range ds.Trips {
		s.tripsByVehicle[t.VehicleID] = append(s.tripsByVehicle[t.VehicleID], t)
	}
	for _, tx := range ds.FuelTransactions {
		s.txByVehicle[tx.VehicleID] = append(s.txByVehicle[tx.VehicleID], tx)
	}
	for _, c := range ds.ComplianceItems {
		s.complianceByVeh[c.VehicleID] = append(s.complianceByVeh[c.VehicleID], c)
	}
	for i := range ds.FuelCards {
		s.cardByID[ds.FuelCards[i].ID] = &ds.FuelCards[i]
	}

	// Chronological order is assumed by the fuel engine's single-pass walk.
	for id := range s.tripsByVehicle {
		trips := s.tripsByVehicle[id]
		sort.Slice(trips, func(i, j int) bool { return trips[i].StartTS.Before(trips[j].StartTS) })
	}
	for id := range s.txByVehicle {
		txs := s.txByVehicle[id]
		sort.Slice(txs, func(i, j int) bool { return txs[i].TS.Before(txs[j].TS) })
	}

	return s
}

// Dataset returns the whole seeded book. The pointer is read-only by contract.
func (s *Store) Dataset() *domain.Dataset { return s.ds }

// GeneratedAt reports when the dataset was built.
func (s *Store) GeneratedAt() time.Time { return s.ds.GeneratedAt }

// ---- Reference data --------------------------------------------------------

// Fleets returns every customer account.
func (s *Store) Fleets() []domain.Fleet { return s.ds.Fleets }

// Vehicles returns every vehicle in the book.
func (s *Store) Vehicles() []domain.Vehicle { return s.ds.Vehicles }

// Devices returns every transponder.
func (s *Store) Devices() []domain.GpsDevice { return s.ds.Devices }

// FuelCards returns every corporate card on issue.
func (s *Store) FuelCards() []domain.FuelCard { return s.ds.FuelCards }

// AllTrips returns the full trip index.
func (s *Store) AllTrips() []domain.Trip { return s.ds.Trips }

// AllCompliance returns every tracked obligation.
func (s *Store) AllCompliance() []domain.ComplianceItem { return s.ds.ComplianceItems }

// Vehicle looks up a vehicle by identifier.
func (s *Store) Vehicle(id string) (*domain.Vehicle, bool) {
	v, ok := s.vehicleByID[id]
	return v, ok
}

// VehicleByPlate looks up a vehicle by registration, ignoring spacing and case.
func (s *Store) VehicleByPlate(plate string) (*domain.Vehicle, bool) {
	v, ok := s.vehicleByPlate[plateKey(plate)]
	return v, ok
}

// Driver looks up a driver by identifier.
func (s *Store) Driver(id string) (*domain.Driver, bool) {
	d, ok := s.driverByID[id]
	return d, ok
}

// DriverByPhone looks up a driver by MSISDN in any common Kenyan format.
func (s *Store) DriverByPhone(phone string) (*domain.Driver, bool) {
	d, ok := s.driverByPhone[NormalisePhone(phone)]
	return d, ok
}

// DeviceForVehicle returns the transponder fitted to a vehicle.
func (s *Store) DeviceForVehicle(vehicleID string) (*domain.GpsDevice, bool) {
	d, ok := s.deviceByVehicle[vehicleID]
	return d, ok
}

// Card looks up a fuel card by identifier.
func (s *Store) Card(id string) (*domain.FuelCard, bool) {
	c, ok := s.cardByID[id]
	return c, ok
}

// TripsFor returns a vehicle's trips in chronological order.
func (s *Store) TripsFor(vehicleID string) []domain.Trip { return s.tripsByVehicle[vehicleID] }

// TransactionsFor returns a vehicle's card captures in chronological order.
func (s *Store) TransactionsFor(vehicleID string) []domain.FuelTransaction {
	return s.txByVehicle[vehicleID]
}

// ComplianceFor returns a vehicle's obligations in chronological order.
func (s *Store) ComplianceFor(vehicleID string) []domain.ComplianceItem {
	items := s.complianceByVeh[vehicleID]
	out := make([]domain.ComplianceItem, len(items))
	copy(out, items)
	sort.Slice(out, func(i, j int) bool { return out[i].DueDate.Before(out[j].DueDate) })
	return out
}

// ---- Telemetry ------------------------------------------------------------

// Telemetry returns the live buffer.
func (s *Store) Telemetry() []domain.TelemetryPing {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.ds.Telemetry
}

// AppendTelemetry adds normalised samples, trimming the oldest once the buffer
// is full. Readers holding an older slice header are unaffected, because append
// never mutates elements below the previous length.
func (s *Store) AppendTelemetry(pings []domain.TelemetryPing) {
	if len(pings) == 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	s.ds.Telemetry = append(s.ds.Telemetry, pings...)
	if excess := len(s.ds.Telemetry) - telemetryBufferLimit; excess > 0 {
		trimmed := make([]domain.TelemetryPing, telemetryBufferLimit)
		copy(trimmed, s.ds.Telemetry[excess:])
		s.ds.Telemetry = trimmed
	}
}

// ---- Runtime: WhatsApp ----------------------------------------------------

// Session returns a driver's conversation state.
func (s *Store) Session(phone string) (domain.WhatsAppSession, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	session, ok := s.sessions[NormalisePhone(phone)]
	return session, ok
}

// PutSession stores a driver's conversation state.
func (s *Store) PutSession(session domain.WhatsAppSession) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions[NormalisePhone(session.Phone)] = session
}

// AppendMessage records one side of a conversation and returns the stored turn.
func (s *Store) AppendMessage(msg domain.WhatsAppMessage) domain.WhatsAppMessage {
	s.mu.Lock()
	defer s.mu.Unlock()
	if msg.ID == "" {
		msg.ID = s.nextIDLocked("msg")
	}
	if msg.TS.IsZero() {
		msg.TS = time.Now().UTC()
	}
	s.messages = append(s.messages, msg)
	return msg
}

// MessagesFor returns a conversation in chronological order.
func (s *Store) MessagesFor(phone string) []domain.WhatsAppMessage {
	s.mu.RLock()
	defer s.mu.RUnlock()

	key := NormalisePhone(phone)
	var out []domain.WhatsAppMessage
	for _, m := range s.messages {
		if NormalisePhone(m.Phone) == key {
			out = append(out, m)
		}
	}
	return out
}

// AppendTripReport files a completed pre-trip checklist.
func (s *Store) AppendTripReport(report domain.TripReport) domain.TripReport {
	s.mu.Lock()
	defer s.mu.Unlock()
	if report.ID == "" {
		report.ID = s.nextIDLocked("rpt")
	}
	s.tripReports = append(s.tripReports, report)
	return report
}

// TripReports returns every filed report.
func (s *Store) TripReports() []domain.TripReport {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]domain.TripReport, len(s.tripReports))
	copy(out, s.tripReports)
	return out
}

// ---- Runtime: offline-first queue -----------------------------------------

// Enqueue stores a field entry captured without connectivity.
func (s *Store) Enqueue(env domain.OfflineEnvelope) domain.OfflineEnvelope {
	s.mu.Lock()
	defer s.mu.Unlock()
	if env.ID == "" {
		env.ID = s.nextIDLocked("env")
	}
	if env.EnqueuedAt.IsZero() {
		env.EnqueuedAt = time.Now().UTC()
	}
	s.queue = append(s.queue, env)
	return env
}

// QueueDepth reports how much field data is waiting to sync.
func (s *Store) QueueDepth() (pending, synced int) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, item := range s.queue {
		if item.Synced {
			synced++
		} else {
			pending++
		}
	}
	return pending, synced
}

// NextID returns a unique identifier with a human-readable prefix.
func (s *Store) NextID(prefix string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.nextIDLocked(prefix)
}

func (s *Store) nextIDLocked(prefix string) string {
	n := s.seq.Add(1)
	return fmt.Sprintf("%s_%d_%d", prefix, time.Now().UnixMilli(), n)
}

// ---- Helpers --------------------------------------------------------------

// NormalisePhone canonicalises a Kenyan MSISDN to E.164 (+254...), accepting the
// local 07xx and 01xx forms a driver would actually type.
func NormalisePhone(phone string) string {
	var b strings.Builder
	for _, r := range phone {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	digits := b.String()

	switch {
	case strings.HasPrefix(digits, "254"):
		return "+" + digits
	case strings.HasPrefix(digits, "0"):
		return "+254" + digits[1:]
	case strings.HasPrefix(digits, "7"), strings.HasPrefix(digits, "1"):
		return "+254" + digits
	default:
		return "+" + digits
	}
}

func plateKey(plate string) string {
	return strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(plate), " ", ""))
}

// NewRng exposes a seeded generator for callers that need deterministic values
// (tests, fixtures) without reaching for the global math/rand source.
func NewRng(seedValue uint32) *domain.Rng {
	return domain.NewRng(seedValue)
}
