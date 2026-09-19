package api

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/vektorfleet/backend/internal/store"
)

// Config is everything the API needs that is not itself a dependency.
type Config struct {
	// AllowedOrigins is the explicit CORS allow-list for the console.
	AllowedOrigins []string
	// Version is surfaced on /api/health so deployments are identifiable.
	Version string
	// Now lets tests pin the clock; production passes time.Now.
	Now func() time.Time
}

// Server holds the route table and its dependencies.
type Server struct {
	store *store.Store
	cfg   Config
	log   *slog.Logger
}

// NewServer constructs a Server over an already-generated store.
func NewServer(st *store.Store, cfg Config, logger *slog.Logger) *Server {
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.Version == "" {
		cfg.Version = "dev"
	}
	return &Server{store: st, cfg: cfg, log: logger}
}

// Handler returns the fully-decorated HTTP handler.
//
// Layer order matters: recovery sits outermost so a panic anywhere inside still
// produces a logged 500, and logging sits above CORS so preflights are recorded.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", s.handleHealth)
	mux.HandleFunc("GET /api/fleet/summary", s.handleFleetSummary)
	mux.HandleFunc("GET /api/vehicles", s.handleVehicles)
	mux.HandleFunc("GET /api/vehicles/{id}", s.handleVehicle)
	mux.HandleFunc("GET /api/vehicles/{id}/track", s.handleVehicleTrack)
	mux.HandleFunc("GET /api/fuel/audit", s.handleFuelAudit)
	mux.HandleFunc("GET /api/compliance", s.handleCompliance)
	mux.HandleFunc("GET /api/whatsapp/thread", s.handleWhatsAppThread)
	mux.HandleFunc("POST /api/whatsapp/inbound", s.handleWhatsAppInbound)
	mux.HandleFunc("POST /api/telemetry/ingest", s.handleTelemetryIngest)
	mux.HandleFunc("GET /api/integrations", s.handleIntegrations)

	return Chain(mux,
		WithRecovery(s.log),
		WithLogging(s.log),
		WithRequestID,
		WithCORS(s.cfg.AllowedOrigins),
	)
}
