// VektorFleet backend.
//
// Deliberately dependency-free: the standard library covers routing (net/http
// 1.22 patterns), structured logging (log/slog), JSON and concurrency, so the
// service builds and runs with no supply chain to audit.
module github.com/vektorfleet/backend

go 1.24
