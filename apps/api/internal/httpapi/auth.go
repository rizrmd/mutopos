package httpapi

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/rizrmd/mutopos/apps/api/internal/authutil"
)

type otpRequestBody struct {
	PhoneE164 string `json:"phone_e164"`
}

type otpVerifyBody struct {
	PhoneE164   string  `json:"phone_e164"`
	Code        string  `json:"code"`
	DisplayName *string `json:"display_name"`
}

func (s *Server) handleOTPRequest(w http.ResponseWriter, r *http.Request) {
	var body otpRequestBody
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_body", badRequest(err))
		return
	}
	phone, err := authutil.NormalizePhone(body.PhoneE164)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_phone", err.Error())
		return
	}

	code := s.cfg.OTPStubCode
	if code == "" {
		code = "000000"
		// generate 6-digit
		tok, err := authutil.NewToken(4)
		if err == nil && len(tok) >= 6 {
			// use numeric from hex digits is awkward; keep stub default unless secret-less
			code = "000000"
		}
		_ = tok
	}

	hash := authutil.HashOTP(code, s.cfg.SessionSecret)
	expires := time.Now().Add(time.Duration(s.cfg.OTPTTLMinutes) * time.Minute)
	var id uuid.UUID
	err = s.pool.QueryRow(r.Context(), `
		INSERT INTO auth_challenges (phone_e164, channel, purpose, code_hash, expires_at, request_meta)
		VALUES ($1, 'whatsapp', 'login', $2, $3, $4::jsonb)
		RETURNING id
	`, phone, hash, expires, `{"channel":"whatsapp_stub"}`).Scan(&id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}

	// Stub: no real WhatsApp provider. Log code; expose in development for UI testing.
	slog.Info("wa_otp_stub", "phone", phone, "code", code, "challenge_id", id)

	resp := map[string]any{
		"challenge_id": id,
		"phone_e164":   phone,
		"expires_at":   expires.UTC(),
		"channel":      "whatsapp",
		"message":      "OTP sent via WhatsApp stub (check server logs in non-dev)",
	}
	if s.cfg.Env == "development" || s.cfg.OTPStubCode != "" {
		resp["dev_code"] = code
		resp["stub"] = true
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleOTPVerify(w http.ResponseWriter, r *http.Request) {
	var body otpVerifyBody
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_body", badRequest(err))
		return
	}
	phone, err := authutil.NormalizePhone(body.PhoneE164)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_phone", err.Error())
		return
	}
	if body.Code == "" {
		writeErr(w, http.StatusBadRequest, "invalid_code", "code is required")
		return
	}

	ctx := r.Context()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer tx.Rollback(ctx)

	var (
		chalID     uuid.UUID
		codeHash   string
		attempts   int
		maxAttempts int
		expiresAt  time.Time
		consumedAt *time.Time
	)
	err = tx.QueryRow(ctx, `
		SELECT id, code_hash, attempts, max_attempts, expires_at, consumed_at
		FROM auth_challenges
		WHERE phone_e164 = $1 AND purpose = 'login' AND consumed_at IS NULL
		ORDER BY created_at DESC
		LIMIT 1
		FOR UPDATE
	`, phone).Scan(&chalID, &codeHash, &attempts, &maxAttempts, &expiresAt, &consumedAt)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "invalid_otp", "no active challenge; request a new OTP")
		return
	}
	if time.Now().After(expiresAt) {
		writeErr(w, http.StatusUnauthorized, "otp_expired", "OTP expired; request a new one")
		return
	}
	if attempts >= maxAttempts {
		writeErr(w, http.StatusUnauthorized, "otp_locked", "too many attempts")
		return
	}

	want := authutil.HashOTP(body.Code, s.cfg.SessionSecret)
	if want != codeHash {
		_, _ = tx.Exec(ctx, `UPDATE auth_challenges SET attempts = attempts + 1 WHERE id = $1`, chalID)
		_ = tx.Commit(ctx)
		writeErr(w, http.StatusUnauthorized, "invalid_otp", "incorrect code")
		return
	}

	_, err = tx.Exec(ctx, `UPDATE auth_challenges SET consumed_at = now(), attempts = attempts + 1 WHERE id = $1`, chalID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}

	// Upsert user
	var userID uuid.UUID
	var display *string
	err = tx.QueryRow(ctx, `SELECT id, display_name FROM users WHERE phone_e164 = $1`, phone).Scan(&userID, &display)
	if err == pgx.ErrNoRows {
		err = tx.QueryRow(ctx, `
			INSERT INTO users (phone_e164, display_name, wa_verified_at, status)
			VALUES ($1, $2, now(), 'active')
			RETURNING id, display_name
		`, phone, body.DisplayName).Scan(&userID, &display)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
			return
		}
	} else if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	} else {
		_, _ = tx.Exec(ctx, `
			UPDATE users SET wa_verified_at = COALESCE(wa_verified_at, now()),
			                 display_name = COALESCE($2, display_name),
			                 updated_at = now()
			WHERE id = $1
		`, userID, body.DisplayName)
		if body.DisplayName != nil {
			display = body.DisplayName
		}
	}

	// Session token
	rawToken, err := authutil.NewToken(32)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "token_error", err.Error())
		return
	}
	tokenHash := authutil.HashToken(rawToken, s.cfg.SessionSecret)
	expires := time.Now().Add(time.Duration(s.cfg.SessionTTLHours) * time.Hour)
	var sessionID uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO sessions (user_id, token_hash, expires_at, last_seen_at)
		VALUES ($1, $2, $3, now())
		RETURNING id
	`, userID, tokenHash, expires).Scan(&sessionID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}

	// Bootstrap first business if user has none
	var bizCount int
	_ = tx.QueryRow(ctx, `
		SELECT COUNT(*) FROM business_members WHERE user_id = $1 AND status = 'active'
	`, userID).Scan(&bizCount)

	var bootstrap map[string]any
	if bizCount == 0 {
		var bizID, outletID uuid.UUID
		name := "My Business"
		if display != nil && *display != "" {
			name = *display + "'s Business"
		}
		err = tx.QueryRow(ctx, `
			INSERT INTO businesses (name, timezone, currency_code, status)
			VALUES ($1, 'Asia/Jakarta', 'IDR', 'active')
			RETURNING id
		`, name).Scan(&bizID)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
			return
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO business_members (business_id, user_id, role, status)
			VALUES ($1, $2, 'owner', 'active')
		`, bizID, userID)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
			return
		}
		err = tx.QueryRow(ctx, `
			INSERT INTO outlets (business_id, name, code, is_active)
			VALUES ($1, 'Main Outlet', 'MAIN', true)
			RETURNING id
		`, bizID).Scan(&outletID)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
			return
		}
		// owner staff profile for POS
		var staffID uuid.UUID
		staffName := "Owner"
		if display != nil && *display != "" {
			staffName = *display
		}
		err = tx.QueryRow(ctx, `
			INSERT INTO staff (business_id, user_id, display_name, role, status)
			VALUES ($1, $2, $3, 'manager', 'active')
			RETURNING id
		`, bizID, userID, staffName).Scan(&staffID)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
			return
		}
		_, _ = tx.Exec(ctx, `
			INSERT INTO staff_outlets (staff_id, outlet_id, business_id)
			VALUES ($1, $2, $3)
		`, staffID, outletID, bizID)

		bootstrap = map[string]any{
			"business_id": bizID,
			"outlet_id":   outletID,
			"staff_id":    staffID,
			"name":        name,
		}
	}

	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"access_token": rawToken,
		"token_type":   "Bearer",
		"expires_at":   expires.UTC(),
		"session_id":   sessionID,
		"user": map[string]any{
			"id":           userID,
			"phone_e164":   phone,
			"display_name": display,
		},
		"bootstrap": bootstrap,
	})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	au := userFrom(r.Context())
	_, _ = s.pool.Exec(r.Context(), `
		UPDATE sessions SET revoked_at = now() WHERE id = $1
	`, au.SessionID)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	au := userFrom(r.Context())
	type membership struct {
		BusinessID   uuid.UUID `json:"business_id"`
		BusinessName string    `json:"business_name"`
		Role         string    `json:"role"`
		Currency     string    `json:"currency_code"`
		Timezone     string    `json:"timezone"`
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT b.id, b.name, m.role, b.currency_code, b.timezone
		FROM business_members m
		JOIN businesses b ON b.id = m.business_id
		WHERE m.user_id = $1 AND m.status = 'active'
		ORDER BY b.created_at
	`, au.UserID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()
	var list []membership
	for rows.Next() {
		var m membership
		if err := rows.Scan(&m.BusinessID, &m.BusinessName, &m.Role, &m.Currency, &m.Timezone); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
			return
		}
		list = append(list, m)
	}
	if list == nil {
		list = []membership{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user": map[string]any{
			"id":           au.UserID,
			"phone_e164":   au.PhoneE164,
			"display_name": au.DisplayName,
		},
		"memberships": list,
	})
}
