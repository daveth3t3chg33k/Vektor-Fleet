package api

import (
	"net/http"
	"sort"
	"time"

	"github.com/vektorfleet/backend/internal/domain"
	"github.com/vektorfleet/backend/internal/engine"
	"github.com/vektorfleet/backend/internal/store"
)

// handleHealth reports liveness plus enough context to confirm the process came
// up with a usable dataset.
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeData(w, http.StatusOK, map[string]any{
		"status":      "ok",
		"service":     "vektorfleet-api",
		"version":     s.cfg.Version,
		"generatedAt": s.store.GeneratedAt(),
		"vehicles":    len(s.store.Vehicles()),
		"trips":       len(s.store.AllTrips()),
	})
}

// handleFleetSummary is the console's landing payload: KPIs, per-vehicle rows and
// the savings case, in one round trip.
func (s *Server) handleFleetSummary(w http.ResponseWriter, r *http.Request) {
	now := s.cfg.Now()
	snapshots := engine.AllSnapshots(s.store, now)
	audit := engine.AuditFleet(s.store, engine.DefaultTuning)
	posture := engine.FleetCompliancePosture(s.store, now)
	kpis := engine.FleetKPIs(s.store, now)
	kpis.Breakdown = engine.SavingsBreakdown(snapshots, audit, posture)

	writeData(w, http.StatusOK, map[string]any{
		"generatedAt": s.store.GeneratedAt(),
		"kpis":        kpis,
		"snapshots":   snapshots,
		"posture":     postureWithoutEvaluations(posture),
	})
}

// handleVehicles lists the register.
//
// Filtering happens here rather than in the engine so the engine has no opinion
// about HTTP query syntax.
func (s *Server) handleVehicles(w http.ResponseWriter, r *http.Request) {
	now := s.cfg.Now()
	snapshots := engine.AllSnapshots(s.store, now)

	status := r.URL.Query().Get("status")
	fleetID := r.URL.Query().Get("fleetId")
	if status != "" || fleetID != "" {
		filtered := snapshots[:0:0]
		for _, snap := range snapshots {
			if status != "" && string(snap.Vehicle.Status) != status {
				continue
			}
			if fleetID != "" && snap.Vehicle.FleetID != fleetID {
				continue
			}
			filtered = append(filtered, snap)
		}
		snapshots = filtered
	}

	writeData(w, http.StatusOK, map[string]any{
		"generatedAt": s.store.GeneratedAt(),
		"count":       len(snapshots),
		"vehicles":    snapshots,
	})
}

// handleVehicle returns everything the detail page needs for one asset.
func (s *Server) handleVehicle(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	now := s.cfg.Now()

	snapshot, ok := engine.SnapshotFor(s.store, id, now)
	if !ok {
		// Fall back to plate lookup so links can use the human-readable plate.
		if v, found := s.store.VehicleByPlate(id); found {
			snapshot, ok = engine.SnapshotFor(s.store, v.ID, now)
			id = v.ID
		}
	}
	if !ok {
		writeError(w, http.StatusNotFound, "vehicle not found", "no vehicle matches "+id)
		return
	}

	rec, _ := engine.ReconcileVehicle(s.store, id, engine.DefaultTuning)
	evaluations := engine.EvaluateAll(s.store, id, now)

	position, _ := engine.PositionAt(s.store, id, now)
	pings := engine.PingsFor(s.store, id, now.Add(-6*time.Hour), now)
	overspeed := engine.OverspeedEvents(pings, snapshot.Vehicle.GovernorLimitKph, 5)

	writeData(w, http.StatusOK, map[string]any{
		"snapshot":     snapshot,
		"reconciliation": rec,
		"compliance":   evaluations,
		"position":     position,
		"trips":        s.store.TripsFor(id),
		"overspeed":    overspeed,
	})
}

// handleVehicleTrack returns the last six hours of positions for the live map,
// plus the evaluated position so a gap can still be drawn.
func (s *Server) handleVehicleTrack(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	now := s.cfg.Now()
	if v, found := s.store.VehicleByPlate(id); found {
		id = v.ID
	}

	pings := engine.PingsFor(s.store, id, now.Add(-6*time.Hour), now)
	position, ok := engine.PositionAt(s.store, id, now)
	if !ok {
		writeError(w, http.StatusNotFound, "vehicle not found", "no vehicle matches "+id)
		return
	}
	writeData(w, http.StatusOK, map[string]any{
		"vehicleId": id,
		"position":  position,
		"pings":     engine.DenoisePings(pings, 15),
	})
}

// handleFuelAudit is the investigation queue: every reconciliation with its flags.
func (s *Server) handleFuelAudit(w http.ResponseWriter, r *http.Request) {
	audit := engine.AuditFleet(s.store, engine.DefaultTuning)
	writeData(w, http.StatusOK, audit)
}

// handleCompliance returns fleet posture plus the scheduled alert queue.
func (s *Server) handleCompliance(w http.ResponseWriter, r *http.Request) {
	now := s.cfg.Now()
	posture := engine.FleetCompliancePosture(s.store, now)
	alerts := engine.BuildAlertQueue(s.store, now)
	writeData(w, http.StatusOK, map[string]any{
		"generatedAt": s.store.GeneratedAt(),
		"posture":     posture,
		"alerts":      alerts,
	})
}

// handleWhatsAppThread returns the driver roster and the recent conversation for
// the simulator's default thread.
func (s *Server) handleWhatsAppThread(w http.ResponseWriter, r *http.Request) {
	roster := s.whatsappRoster()

	phone := r.URL.Query().Get("phone")
	if phone == "" && len(roster) > 0 {
		if first, ok := roster[0]["phone"].(string); ok {
			phone = first
		}
	}
	normalised := store.NormalisePhone(phone)
	session, hasSession := s.store.Session(normalised)

	writeData(w, http.StatusOK, map[string]any{
		"roster":     roster,
		"phone":      normalised,
		"messages":   s.store.MessagesFor(normalised),
		"session":    session,
		"hasSession": hasSession,
	})
}

// whatsappRoster is the list of drivers the simulator can adopt.
func (s *Server) whatsappRoster() []map[string]any {
	drivers := append([]domain.Driver(nil), s.store.Dataset().Drivers...)
	sort.Slice(drivers, func(i, j int) bool { return drivers[i].ID < drivers[j].ID })

	roster := make([]map[string]any, 0, len(drivers))
	for _, d := range drivers {
		vehicle, _ := s.store.Vehicle(d.AssignedVehicleID)
		plate := ""
		if vehicle != nil {
			plate = vehicle.Plate
		}
		roster = append(roster, map[string]any{
			"driverId": d.ID,
			"name":     d.Name,
			"phone":    d.Phone,
			"plate":    plate,
		})
	}
	return roster
}

// handleWhatsAppInbound drives one bot turn.
func (s *Server) handleWhatsAppInbound(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Phone    string `json:"phone"`
		Body     string `json:"body"`
		MediaURL string `json:"mediaUrl"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", err.Error())
		return
	}
	if req.Phone == "" {
		writeError(w, http.StatusUnprocessableEntity, "phone is required", "")
		return
	}
	turn := engine.HandleInbound(s.store, req.Phone, req.Body, req.MediaURL)
	writeData(w, http.StatusOK, map[string]any{
		"session":  turn.Session,
		"replies":  turn.Replies,
		"events":   turn.Events,
		"messages": s.store.MessagesFor(store.NormalisePhone(req.Phone)),
	})
}

// handleTelemetryIngest accepts a raw vendor payload batch and returns the
// normalised pings plus the adapter that handled them.
func (s *Server) handleTelemetryIngest(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Vendor    string           `json:"vendor"`
		VehicleID string           `json:"vehicleId"`
		DeviceID  string           `json:"deviceId"`
		Pings     []map[string]any `json:"pings"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", err.Error())
		return
	}
	if len(req.Pings) == 0 {
		writeError(w, http.StatusUnprocessableEntity, "pings is required", "send at least one raw ping")
		return
	}

	vendor := domain.GpsVendorID(req.Vendor)
	ctx := engine.AdapterContext{VehicleID: req.VehicleID, DeviceID: req.DeviceID}
	pings, err := engine.IngestBatch(vendor, req.Pings, ctx)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "ingest rejected", err.Error())
		return
	}
	s.store.AppendTelemetry(pings)

	writeData(w, http.StatusAccepted, map[string]any{
		"accepted": len(pings),
		"vendor":   vendor,
		"pings":    pings,
	})
}

// handleIntegrations reports the adapter catalogue, the fuel-card networks the
// match engine can sync, and the offline queue depth.
func (s *Server) handleIntegrations(w http.ResponseWriter, r *http.Request) {
	pending, synced := s.store.QueueDepth()

	networks := []map[string]string{
		{"provider": "rubis", "label": "Rubis Card", "protocol": "SOAP / REST reconciliation feed"},
		{"provider": "total", "label": "TotalEnergies Card", "protocol": "SFTP daily settlement file"},
		{"provider": "shell", "label": "Shell Card", "protocol": "REST transaction API"},
		{"provider": "independent", "label": "Independent dealers", "protocol": "Receipt OCR via WhatsApp"},
	}

	writeData(w, http.StatusOK, map[string]any{
		"adapters":   engine.SupportedVendors(),
		"networks":   networks,
		"queueDepth": map[string]int{"pending": pending, "synced": synced},
		"devices":    s.store.Devices(),
	})
}

// postureWithoutEvaluations trims the embedded evaluation list, which the summary
// endpoint does not need and which would otherwise dominate the payload.
func postureWithoutEvaluations(posture engine.PostureSummary) engine.PostureSummary {
	posture.Evaluations = nil
	return posture
}
