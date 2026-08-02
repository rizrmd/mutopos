package httpapi

import (
	"net/http"

	"github.com/google/uuid"

	"github.com/rizrmd/mutopos/apps/api/internal/authutil"
)

func (s *Server) handleListOutlets(w http.ResponseWriter, r *http.Request) {
	tc := tenantFrom(r.Context())
	rows, err := s.pool.Query(r.Context(), `
		SELECT id, name, code, address, timezone, is_active, created_at
		FROM outlets WHERE business_id = $1
		ORDER BY name
	`, tc.BusinessID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()
	type outlet struct {
		ID        uuid.UUID `json:"id"`
		Name      string    `json:"name"`
		Code      *string   `json:"code"`
		Address   *string   `json:"address"`
		Timezone  *string   `json:"timezone"`
		IsActive  bool      `json:"is_active"`
		CreatedAt any       `json:"created_at"`
	}
	var list []outlet
	for rows.Next() {
		var o outlet
		if err := rows.Scan(&o.ID, &o.Name, &o.Code, &o.Address, &o.Timezone, &o.IsActive, &o.CreatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
			return
		}
		list = append(list, o)
	}
	if list == nil {
		list = []outlet{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"outlets": list})
}

type createOutletBody struct {
	Name    string  `json:"name"`
	Code    *string `json:"code"`
	Address *string `json:"address"`
}

func (s *Server) handleCreateOutlet(w http.ResponseWriter, r *http.Request) {
	tc := tenantFrom(r.Context())
	var body createOutletBody
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_body", badRequest(err))
		return
	}
	if body.Name == "" {
		writeErr(w, http.StatusBadRequest, "invalid_name", "name is required")
		return
	}
	var id uuid.UUID
	err := s.pool.QueryRow(r.Context(), `
		INSERT INTO outlets (business_id, name, code, address, is_active)
		VALUES ($1, $2, $3, $4, true)
		RETURNING id
	`, tc.BusinessID, body.Name, body.Code, body.Address).Scan(&id)
	if err != nil {
		if isUniqueViolation(err) {
			writeErr(w, http.StatusConflict, "duplicate_code", "outlet code already exists")
			return
		}
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"id":   id,
		"name": body.Name,
		"code": body.Code,
	})
}

type patchOutletBody struct {
	Name     *string `json:"name"`
	Code     *string `json:"code"`
	Address  *string `json:"address"`
	IsActive *bool   `json:"is_active"`
}

func (s *Server) handlePatchOutlet(w http.ResponseWriter, r *http.Request) {
	tc := tenantFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_id", "id must be UUID")
		return
	}
	var body patchOutletBody
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_body", badRequest(err))
		return
	}
	_, err = s.pool.Exec(r.Context(), `
		UPDATE outlets SET
			name = COALESCE($3, name),
			code = COALESCE($4, code),
			address = COALESCE($5, address),
			is_active = COALESCE($6, is_active),
			updated_at = now()
		WHERE id = $1 AND business_id = $2
	`, id, tc.BusinessID, body.Name, body.Code, body.Address, body.IsActive)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "ok": true})
}

func (s *Server) handleListStaff(w http.ResponseWriter, r *http.Request) {
	tc := tenantFrom(r.Context())
	rows, err := s.pool.Query(r.Context(), `
		SELECT id, user_id, display_name, role, status,
		       (pin_hash IS NOT NULL AND pin_hash <> '') AS has_pin,
		       created_at
		FROM staff WHERE business_id = $1
		ORDER BY display_name
	`, tc.BusinessID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()
	type staff struct {
		ID          uuid.UUID  `json:"id"`
		UserID      *uuid.UUID `json:"user_id"`
		DisplayName string     `json:"display_name"`
		Role        string     `json:"role"`
		Status      string     `json:"status"`
		HasPIN      bool       `json:"has_pin"`
		CreatedAt   any        `json:"created_at"`
	}
	var list []staff
	for rows.Next() {
		var st staff
		if err := rows.Scan(&st.ID, &st.UserID, &st.DisplayName, &st.Role, &st.Status, &st.HasPIN, &st.CreatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
			return
		}
		list = append(list, st)
	}
	if list == nil {
		list = []staff{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"staff": list})
}

type createStaffBody struct {
	DisplayName string      `json:"display_name"`
	Role        string      `json:"role"`
	UserID      *uuid.UUID  `json:"user_id"`
	OutletIDs   []uuid.UUID `json:"outlet_ids"`
	PIN         *string     `json:"pin"`
}

func (s *Server) handleCreateStaff(w http.ResponseWriter, r *http.Request) {
	tc := tenantFrom(r.Context())
	var body createStaffBody
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_body", badRequest(err))
		return
	}
	if body.DisplayName == "" {
		writeErr(w, http.StatusBadRequest, "invalid_name", "display_name is required")
		return
	}
	if body.Role == "" {
		body.Role = "cashier"
	}
	if body.Role != "manager" && body.Role != "cashier" {
		writeErr(w, http.StatusBadRequest, "invalid_role", "role must be manager or cashier")
		return
	}

	var pinHash *string
	if body.PIN != nil && *body.PIN != "" {
		h, err := authutil.HashStaffPIN(*body.PIN)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "invalid_pin", err.Error())
			return
		}
		pinHash = &h
	}

	ctx := r.Context()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer tx.Rollback(ctx)

	var id uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO staff (business_id, user_id, display_name, role, status, pin_hash)
		VALUES ($1, $2, $3, $4, 'active', $5)
		RETURNING id
	`, tc.BusinessID, body.UserID, body.DisplayName, body.Role, pinHash).Scan(&id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	for _, oid := range body.OutletIDs {
		_, err = tx.Exec(ctx, `
			INSERT INTO staff_outlets (staff_id, outlet_id, business_id)
			VALUES ($1, $2, $3)
			ON CONFLICT DO NOTHING
		`, id, oid, tc.BusinessID)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
			return
		}
	}
	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"id":           id,
		"display_name": body.DisplayName,
		"role":         body.Role,
		"has_pin":      pinHash != nil,
	})
}

type staffLoginBody struct {
	StaffID uuid.UUID `json:"staff_id"`
	PIN     string    `json:"pin"`
}

// POST /v1/staff/login — verify passcode and return staff identity (Square-style clock-in).
func (s *Server) handleStaffLogin(w http.ResponseWriter, r *http.Request) {
	tc := tenantFrom(r.Context())
	var body staffLoginBody
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_body", badRequest(err))
		return
	}
	if body.StaffID == uuid.Nil {
		writeErr(w, http.StatusBadRequest, "invalid_staff", "staff_id is required")
		return
	}
	if body.PIN == "" {
		writeErr(w, http.StatusBadRequest, "invalid_pin", "pin is required")
		return
	}

	var (
		id          uuid.UUID
		displayName string
		role        string
		status      string
		pinHash     *string
	)
	err := s.pool.QueryRow(r.Context(), `
		SELECT id, display_name, role, status, pin_hash
		FROM staff
		WHERE id = $1 AND business_id = $2
	`, body.StaffID, tc.BusinessID).Scan(&id, &displayName, &role, &status, &pinHash)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "invalid_credentials", "incorrect passcode")
		return
	}
	if status != "active" {
		writeErr(w, http.StatusForbidden, "staff_disabled", "staff is disabled")
		return
	}
	if pinHash == nil || *pinHash == "" {
		writeErr(w, http.StatusForbidden, "pin_not_set", "this team member has no passcode yet — set one first")
		return
	}
	if !authutil.CheckStaffPIN(*pinHash, body.PIN) {
		writeErr(w, http.StatusUnauthorized, "invalid_credentials", "incorrect passcode")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":           true,
		"staff_id":     id,
		"display_name": displayName,
		"role":         role,
	})
}

type setStaffPINBody struct {
	PIN        string  `json:"pin"`
	CurrentPIN *string `json:"current_pin"`
}

// POST /v1/staff/{id}/pin — set or change a team member passcode.
// Allowed when: no PIN yet (bootstrap), or current_pin matches, or member is owner/admin/manager.
func (s *Server) handleSetStaffPIN(w http.ResponseWriter, r *http.Request) {
	tc := tenantFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_id", "id must be UUID")
		return
	}
	var body setStaffPINBody
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_body", badRequest(err))
		return
	}
	hash, err := authutil.HashStaffPIN(body.PIN)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_pin", err.Error())
		return
	}

	var (
		existing *string
		status   string
	)
	err = s.pool.QueryRow(r.Context(), `
		SELECT pin_hash, status FROM staff WHERE id = $1 AND business_id = $2
	`, id, tc.BusinessID).Scan(&existing, &status)
	if err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "staff not found")
		return
	}
	if status != "active" {
		writeErr(w, http.StatusForbidden, "staff_disabled", "staff is disabled")
		return
	}

	hasPIN := existing != nil && *existing != ""
	isElevated := tc.MemberRole == "owner" || tc.MemberRole == "admin" || tc.MemberRole == "manager"
	if hasPIN {
		ok := false
		if body.CurrentPIN != nil && authutil.CheckStaffPIN(*existing, *body.CurrentPIN) {
			ok = true
		}
		if isElevated {
			ok = true
		}
		if !ok {
			writeErr(w, http.StatusForbidden, "forbidden", "current_pin required to change passcode")
			return
		}
	}

	_, err = s.pool.Exec(r.Context(), `
		UPDATE staff SET pin_hash = $3, updated_at = now()
		WHERE id = $1 AND business_id = $2
	`, id, tc.BusinessID, hash)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": id, "has_pin": true})
}
