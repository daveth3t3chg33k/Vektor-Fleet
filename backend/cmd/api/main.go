// Command api runs the VektorFleet HTTP service.
//
// It is a single binary with no external dependencies: the seeded book of
// business is generated in-process at start-up, so the service is fully usable
// the moment it is running. Point it at Postgres by swapping the store
// implementation — nothing in the API layer changes.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/vektorfleet/backend/internal/api"
	"github.com/vektorfleet/backend/internal/store"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	cfg := loadConfig()

	// The dataset is anchored to start-up so "today" in the console means today.
	st := store.New(time.Now())
	logger.Info("dataset generated",
		"vehicles", len(st.Vehicles()),
		"trips", len(st.AllTrips()),
		"generated_at", st.GeneratedAt(),
	)

	server := api.NewServer(st, api.Config{
		AllowedOrigins: cfg.allowedOrigins,
		Version:        cfg.version,
		Now:            time.Now,
	}, logger)

	httpServer := &http.Server{
		Addr:    cfg.addr,
		Handler: server.Handler(),
		// A slow or stalled client must not be able to hold a connection open
		// indefinitely; each timeout bounds a different phase of the request.
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       90 * time.Second,
	}

	// Signal-aware context: the first Ctrl-C asks the server to drain, a second
	// one cancels this context and aborts the wait.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		logger.Info("listening", "addr", cfg.addr, "origins", cfg.allowedOrigins)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("server failed", "err", err)
			stop()
		}
	}()

	<-ctx.Done()
	logger.Info("shutdown requested, draining connections")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful shutdown failed", "err", err)
		_ = httpServer.Close()
		os.Exit(1)
	}
	logger.Info("stopped cleanly")
}

type config struct {
	addr           string
	allowedOrigins []string
	version        string
}

// loadConfig reads the handful of settings the service needs from the
// environment, defaulting to something that just works locally.
func loadConfig() config {
	addr := os.Getenv("VEKTORFLEET_ADDR")
	if addr == "" {
		port := os.Getenv("PORT")
		if port == "" {
			port = "8787"
		}
		addr = ":" + port
	}

	origins := []string{"http://localhost:3000", "http://127.0.0.1:3000"}
	if raw := os.Getenv("VEKTORFLEET_ALLOWED_ORIGINS"); raw != "" {
		origins = nil
		for _, origin := range strings.Split(raw, ",") {
			if trimmed := strings.TrimSpace(origin); trimmed != "" {
				origins = append(origins, trimmed)
			}
		}
	}

	version := os.Getenv("VEKTORFLEET_VERSION")
	if version == "" {
		version = "0.1.0"
	}

	return config{addr: addr, allowedOrigins: origins, version: version}
}
