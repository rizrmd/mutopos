package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/rizrmd/mutopos/apps/api/internal/authutil"
)

type ctxKey int

const (
	ctxUser ctxKey = iota + 1
	ctxTenant
)

// AuthUser is the authenticated platform user for the request.
type AuthUser struct {
	UserID      uuid.UUID
	PhoneE164   string
	DisplayName *string
	SessionID   uuid.UUID
	Token       string
}

// TenantContext is the active business (and optional outlet/staff) for the request.
type TenantContext struct {
	BusinessID uuid.UUID
	MemberRole string
	OutletID   *uuid.UUID
	StaffID    *uuid.UUID
	DeviceID   *uuid.UUID
	DeviceKey  string
}

func userFrom(ctx context.Context) *AuthUser {
	v, _ := ctx.Value(ctxUser).(*AuthUser)
	return v
}

func tenantFrom(ctx context.Context) *TenantContext {
	v, _ := ctx.Value(ctxTenant).(*TenantContext)
	return v
}

func (s *Server) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := bearerToken(r)
		if token == "" {
			writeErr(w, http.StatusUnauthorized, "unauthorized", "missing bearer token")
			return
		}
		hash := authutil.HashToken(token, s.cfg.SessionSecret)
		ctx := r.Context()

		var (
			sessionID uuid.UUID
			userID    uuid.UUID
			phone     string
			display   *string
			expires   time.Time
			revoked   *time.Time
		)
		err := s.pool.QueryRow(ctx, `
			SELECT s.id, s.user_id, s.expires_at, s.revoked_at,
			       u.phone_e164, u.display_name
			FROM sessions s
			JOIN users u ON u.id = s.user_id
			WHERE s.token_hash = $1
		`, hash).Scan(&sessionID, &userID, &expires, &revoked, &phone, &display)
		if err != nil {
			writeErr(w, http.StatusUnauthorized, "unauthorized", "invalid session")
			return
		}
		if revoked != nil || time.Now().After(expires) {
			writeErr(w, http.StatusUnauthorized, "unauthorized", "session expired or revoked")
			return
		}
		// touch last_seen (best-effort)
		_, _ = s.pool.Exec(ctx, `UPDATE sessions SET last_seen_at = now() WHERE id = $1`, sessionID)

		au := &AuthUser{
			UserID:      userID,
			PhoneE164:   phone,
			DisplayName: display,
			SessionID:   sessionID,
			Token:       token,
		}
		next(w, r.WithContext(context.WithValue(ctx, ctxUser, au)))
	}
}

func (s *Server) requireTenant(next http.HandlerFunc) http.HandlerFunc {
	return s.requireAuth(func(w http.ResponseWriter, r *http.Request) {
		au := userFrom(r.Context())
		bizRaw := headerOrQuery(r, "X-Business-Id", "business_id")
		if bizRaw == "" {
			writeErr(w, http.StatusBadRequest, "missing_business", "X-Business-Id header is required")
			return
		}
		bizID, err := uuid.Parse(bizRaw)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "invalid_business", "X-Business-Id must be a UUID")
			return
		}

		var role, status string
		err = s.pool.QueryRow(r.Context(), `
			SELECT role, status FROM business_members
			WHERE business_id = $1 AND user_id = $2
		`, bizID, au.UserID).Scan(&role, &status)
		if err != nil || status != "active" {
			writeErr(w, http.StatusForbidden, "forbidden", "not a member of this business")
			return
		}

		tc := &TenantContext{
			BusinessID: bizID,
			MemberRole: role,
			DeviceKey:  headerOrQuery(r, "X-Device-Key", "device_key"),
		}

		if o := headerOrQuery(r, "X-Outlet-Id", "outlet_id"); o != "" {
			id, err := uuid.Parse(o)
			if err != nil {
				writeErr(w, http.StatusBadRequest, "invalid_outlet", "X-Outlet-Id must be a UUID")
				return
			}
			var ok bool
			_ = s.pool.QueryRow(r.Context(), `
				SELECT EXISTS(SELECT 1 FROM outlets WHERE id = $1 AND business_id = $2)
			`, id, bizID).Scan(&ok)
			if !ok {
				writeErr(w, http.StatusBadRequest, "invalid_outlet", "outlet not in this business")
				return
			}
			tc.OutletID = &id
		}

		if st := headerOrQuery(r, "X-Staff-Id", "staff_id"); st != "" {
			id, err := uuid.Parse(st)
			if err != nil {
				writeErr(w, http.StatusBadRequest, "invalid_staff", "X-Staff-Id must be a UUID")
				return
			}
			var ok bool
			_ = s.pool.QueryRow(r.Context(), `
				SELECT EXISTS(SELECT 1 FROM staff WHERE id = $1 AND business_id = $2 AND status = 'active')
			`, id, bizID).Scan(&ok)
			if !ok {
				writeErr(w, http.StatusBadRequest, "invalid_staff", "staff not in this business")
				return
			}
			tc.StaffID = &id
		}

		if tc.DeviceKey != "" {
			var devID uuid.UUID
			err := s.pool.QueryRow(r.Context(), `
				SELECT id FROM devices
				WHERE device_key = $1 AND business_id = $2 AND revoked_at IS NULL
			`, tc.DeviceKey, bizID).Scan(&devID)
			if err == nil {
				tc.DeviceID = &devID
				_, _ = s.pool.Exec(r.Context(), `UPDATE devices SET last_seen_at = now() WHERE id = $1`, devID)
			}
		}

		next(w, r.WithContext(context.WithValue(r.Context(), ctxTenant, tc)))
	})
}
