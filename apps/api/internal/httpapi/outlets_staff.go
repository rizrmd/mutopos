package httpapi

import (
	"net/http"

	"github.com/google/uuid"
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
		SELECT id, user_id, display_name, role, status, created_at
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
		CreatedAt   any        `json:"created_at"`
	}
	var list []staff
	for rows.Next() {
		var st staff
		if err := rows.Scan(&st.ID, &st.UserID, &st.DisplayName, &st.Role, &st.Status, &st.CreatedAt); err != nil {
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
	DisplayName string       `json:"display_name"`
	Role        string       `json:"role"`
	UserID      *uuid.UUID   `json:"user_id"`
	OutletIDs   []uuid.UUID  `json:"outlet_ids"`
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
	ctx := r.Context()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer tx.Rollback(ctx)

	var id uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO staff (business_id, user_id, display_name, role, status)
		VALUES ($1, $2, $3, $4, 'active')
		RETURNING id
	`, tc.BusinessID, body.UserID, body.DisplayName, body.Role).Scan(&id)
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
	})
}
