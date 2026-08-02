package httpapi

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rizrmd/mutopos/apps/api/internal/config"
)

// Server is the HTTP API surface.
type Server struct {
	pool *pgxpool.Pool
	cfg  config.Config
	mux  *http.ServeMux
}

// New constructs a Server with routes registered.
func New(pool *pgxpool.Pool, cfg config.Config) *Server {
	s := &Server{pool: pool, cfg: cfg, mux: http.NewServeMux()}
	s.routes()
	return s
}

// Handler returns the root HTTP handler.
func (s *Server) Handler() http.Handler {
	return withCORS(withLogging(s.mux))
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /healthz", s.handleHealthz)
	s.mux.HandleFunc("GET /readyz", s.handleReadyz)
	s.mux.HandleFunc("GET /v1/meta", s.handleMeta)

	// Auth (public)
	s.mux.HandleFunc("POST /v1/auth/otp/request", s.handleOTPRequest)
	s.mux.HandleFunc("POST /v1/auth/otp/verify", s.handleOTPVerify)
	s.mux.HandleFunc("POST /v1/auth/logout", s.requireAuth(s.handleLogout))
	s.mux.HandleFunc("GET /v1/me", s.requireAuth(s.handleMe))

	// Businesses (membership-scoped)
	s.mux.HandleFunc("GET /v1/businesses", s.requireAuth(s.handleListBusinesses))
	s.mux.HandleFunc("POST /v1/businesses", s.requireAuth(s.handleCreateBusiness))
	s.mux.HandleFunc("GET /v1/businesses/{id}", s.requireAuth(s.handleGetBusiness))

	// Tenant routes — require auth + X-Business-Id
	s.mux.HandleFunc("GET /v1/outlets", s.requireTenant(s.handleListOutlets))
	s.mux.HandleFunc("POST /v1/outlets", s.requireTenant(s.handleCreateOutlet))
	s.mux.HandleFunc("PATCH /v1/outlets/{id}", s.requireTenant(s.handlePatchOutlet))

	s.mux.HandleFunc("GET /v1/staff", s.requireTenant(s.handleListStaff))
	s.mux.HandleFunc("POST /v1/staff", s.requireTenant(s.handleCreateStaff))

	s.mux.HandleFunc("GET /v1/categories", s.requireTenant(s.handleListCategories))
	s.mux.HandleFunc("POST /v1/categories", s.requireTenant(s.handleCreateCategory))
	s.mux.HandleFunc("PATCH /v1/categories/{id}", s.requireTenant(s.handlePatchCategory))

	s.mux.HandleFunc("GET /v1/products", s.requireTenant(s.handleListProducts))
	s.mux.HandleFunc("POST /v1/products", s.requireTenant(s.handleCreateProduct))
	s.mux.HandleFunc("PATCH /v1/products/{id}", s.requireTenant(s.handlePatchProduct))
	s.mux.HandleFunc("GET /v1/products/{id}", s.requireTenant(s.handleGetProduct))

	s.mux.HandleFunc("GET /v1/sales", s.requireTenant(s.handleListSales))
	s.mux.HandleFunc("GET /v1/sales/{id}", s.requireTenant(s.handleGetSale))
	s.mux.HandleFunc("POST /v1/sales/complete", s.requireTenant(s.handleCompleteSaleOnline))

	// Outbox push + device registration
	s.mux.HandleFunc("POST /v1/devices", s.requireTenant(s.handleRegisterDevice))
	s.mux.HandleFunc("POST /v1/commands", s.requireTenant(s.handlePushCommand))
	s.mux.HandleFunc("GET /v1/commands/{id}", s.requireTenant(s.handleGetCommandReceipt))

	// Demo sample data (Vita daytime mockup catalog + floor staff)
	s.mux.HandleFunc("POST /v1/demo/seed", s.requireTenant(s.handleSeedDemo))
}

func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":  "ok",
		"service": "mutopos-api",
	})
}

func (s *Server) handleReadyz(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if err := s.pool.Ping(ctx); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"status": "not_ready",
			"error":  "database_unreachable",
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ready"})
}

func (s *Server) handleMeta(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"name":         "MutoPOS API",
		"version":      "0.2.0",
		"docs":         "See repository docs/ for architecture and ERD",
		"auth":         "WhatsApp E.164 + OTP stub (POST /v1/auth/otp/*)",
		"offline":      "Client RxDB + custom outbox → POST /v1/commands",
		"multi_tenant": true,
		"otp_stub":     s.cfg.OTPStubCode != "",
	})
}

func withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rw := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rw, r)
		slog.Info("http",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rw.status,
			"duration_ms", time.Since(start).Milliseconds(),
		)
	})
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Business-Id, X-Outlet-Id, X-Device-Key, X-Staff-Id")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}
