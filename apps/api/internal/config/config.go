package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

// Config holds process configuration loaded from the environment.
type Config struct {
	// HTTPAddr is the listen address, e.g. ":8080".
	HTTPAddr string
	// DatabaseURL is a Postgres connection string (required for migrate/serve).
	DatabaseURL string
	// AutoMigrate runs embedded SQL migrations on process start when true.
	AutoMigrate bool
	// Env is a free-form environment label (development, production, …).
	Env string
	// SessionSecret salts session token hashing (any long string).
	SessionSecret string
	// OTPStubCode is the fixed OTP accepted in development when non-empty.
	// When empty, a random code is generated (still logged; WA send is stubbed).
	OTPStubCode string
	// OTPTTLMinutes is challenge lifetime.
	OTPTTLMinutes int
	// SessionTTLHours is bearer session lifetime.
	SessionTTLHours int
}

// Load reads optional .env files then environment variables.
// Search order for dotenv: apps/api/.env, then cwd .env (non-fatal if missing).
func Load() (Config, error) {
	// Best-effort local dotenv; production should inject env vars.
	_ = godotenv.Load(".env")
	_ = godotenv.Load()

	cfg := Config{
		HTTPAddr:        getEnv("HTTP_ADDR", ":8080"),
		DatabaseURL:     strings.TrimSpace(os.Getenv("DATABASE_URL")),
		AutoMigrate:     getEnvBool("AUTO_MIGRATE", true),
		Env:             getEnv("APP_ENV", "development"),
		SessionSecret:   getEnv("SESSION_SECRET", "mutopos-dev-session-secret"),
		OTPStubCode:     getEnv("OTP_STUB_CODE", "000000"),
		OTPTTLMinutes:   getEnvInt("OTP_TTL_MINUTES", 10),
		SessionTTLHours: getEnvInt("SESSION_TTL_HOURS", 24*14),
	}

	if cfg.DatabaseURL == "" {
		return cfg, fmt.Errorf("DATABASE_URL is required (Postgres connection string)")
	}

	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func getEnvBool(key string, fallback bool) bool {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return fallback
	}
	return b
}

func getEnvInt(key string, fallback int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}
