package httpapi

import (
	"net/http"

	"github.com/google/uuid"
)

func (s *Server) handleListBusinesses(w http.ResponseWriter, r *http.Request) {
	// Same as me.memberships — dedicated list
	s.handleMe(w, r)
}

type createBusinessBody struct {
	Name         string  `json:"name"`
	LegalName    *string `json:"legal_name"`
	Timezone     string  `json:"timezone"`
	CurrencyCode string  `json:"currency_code"`
	OutletName   string  `json:"outlet_name"`
}

func (s *Server) handleCreateBusiness(w http.ResponseWriter, r *http.Request) {
	au := userFrom(r.Context())
	var body createBusinessBody
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_body", badRequest(err))
		return
	}
	if body.Name == "" {
		writeErr(w, http.StatusBadRequest, "invalid_name", "name is required")
		return
	}
	if body.Timezone == "" {
		body.Timezone = "Asia/Jakarta"
	}
	if body.CurrencyCode == "" {
		body.CurrencyCode = "IDR"
	}
	if body.OutletName == "" {
		body.OutletName = "Main Outlet"
	}

	ctx := r.Context()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer tx.Rollback(ctx)

	var bizID uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO businesses (name, legal_name, timezone, currency_code, status)
		VALUES ($1, $2, $3, $4, 'active')
		RETURNING id
	`, body.Name, body.LegalName, body.Timezone, body.CurrencyCode).Scan(&bizID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO business_members (business_id, user_id, role, status)
		VALUES ($1, $2, 'owner', 'active')
	`, bizID, au.UserID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	var outletID uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO outlets (business_id, name, code, is_active)
		VALUES ($1, $2, 'MAIN', true)
		RETURNING id
	`, bizID, body.OutletName).Scan(&outletID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	staffName := "Owner"
	if au.DisplayName != nil && *au.DisplayName != "" {
		staffName = *au.DisplayName
	}
	var staffID uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO staff (business_id, user_id, display_name, role, status)
		VALUES ($1, $2, $3, 'manager', 'active')
		RETURNING id
	`, bizID, au.UserID, staffName).Scan(&staffID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	_, _ = tx.Exec(ctx, `
		INSERT INTO staff_outlets (staff_id, outlet_id, business_id) VALUES ($1, $2, $3)
	`, staffID, outletID, bizID)

	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"id":         bizID,
		"name":       body.Name,
		"outlet_id":  outletID,
		"staff_id":   staffID,
		"role":       "owner",
		"timezone":   body.Timezone,
		"currency":   body.CurrencyCode,
	})
}

func (s *Server) handleGetBusiness(w http.ResponseWriter, r *http.Request) {
	au := userFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_id", "id must be UUID")
		return
	}
	var (
		name, tz, currency, status, role string
	)
	err = s.pool.QueryRow(r.Context(), `
		SELECT b.name, b.timezone, b.currency_code, b.status, m.role
		FROM businesses b
		JOIN business_members m ON m.business_id = b.id
		WHERE b.id = $1 AND m.user_id = $2 AND m.status = 'active'
	`, id, au.UserID).Scan(&name, &tz, &currency, &status, &role)
	if err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "business not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id":            id,
		"name":          name,
		"timezone":      tz,
		"currency_code": currency,
		"status":        status,
		"role":          role,
	})
}
