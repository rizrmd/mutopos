package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type registerDeviceBody struct {
	DeviceKey string     `json:"device_key"`
	Label     *string    `json:"label"`
	OutletID  *uuid.UUID `json:"outlet_id"`
}

func (s *Server) handleRegisterDevice(w http.ResponseWriter, r *http.Request) {
	tc := tenantFrom(r.Context())
	var body registerDeviceBody
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_body", badRequest(err))
		return
	}
	if body.DeviceKey == "" {
		writeErr(w, http.StatusBadRequest, "invalid_device_key", "device_key is required")
		return
	}
	outlet := body.OutletID
	if outlet == nil {
		outlet = tc.OutletID
	}
	var id uuid.UUID
	err := s.pool.QueryRow(r.Context(), `
		INSERT INTO devices (business_id, outlet_id, device_key, label, last_seen_at)
		VALUES ($1, $2, $3, $4, now())
		ON CONFLICT (device_key) DO UPDATE SET
			last_seen_at = now(),
			label = COALESCE(EXCLUDED.label, devices.label),
			outlet_id = COALESCE(EXCLUDED.outlet_id, devices.outlet_id),
			revoked_at = NULL
		RETURNING id
	`, tc.BusinessID, outlet, body.DeviceKey, body.Label).Scan(&id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id":         id,
		"device_key": body.DeviceKey,
		"outlet_id":  outlet,
	})
}

// pushCommandBody is the client outbox push payload.
type pushCommandBody struct {
	CommandID      uuid.UUID       `json:"command_id"`
	CommandType    string          `json:"command_type"`
	CommandVersion int             `json:"command_version"`
	Payload        json.RawMessage `json:"payload"`
}

func (s *Server) handlePushCommand(w http.ResponseWriter, r *http.Request) {
	tc := tenantFrom(r.Context())
	au := userFrom(r.Context())
	var body pushCommandBody
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_body", badRequest(err))
		return
	}
	if body.CommandID == uuid.Nil {
		writeErr(w, http.StatusBadRequest, "invalid_command_id", "command_id is required (outbox id)")
		return
	}
	if body.CommandType == "" {
		writeErr(w, http.StatusBadRequest, "invalid_type", "command_type is required")
		return
	}
	if body.CommandVersion == 0 {
		body.CommandVersion = 1
	}

	ctx := r.Context()
	// Idempotent lookup
	var (
		status   string
		respBody []byte
		errCode  *string
	)
	err := s.pool.QueryRow(ctx, `
		SELECT status, response_body, error_code
		FROM command_receipts WHERE command_id = $1
	`, body.CommandID).Scan(&status, &respBody, &errCode)
	if err == nil {
		var parsed any
		_ = json.Unmarshal(respBody, &parsed)
		writeJSON(w, http.StatusOK, map[string]any{
			"command_id":         body.CommandID,
			"status":             status,
			"idempotent_replay":  true,
			"result":             parsed,
			"error_code":         errCode,
		})
		return
	} else if err != pgx.ErrNoRows {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}

	reqHash := hashBytes(body.Payload)
	var result map[string]any
	var applyErr error
	receiptStatus := "applied"
	var errorCode *string

	switch body.CommandType {
	case "sale.complete":
		var sale completeSaleBody
		if err := json.Unmarshal(body.Payload, &sale); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid_payload", "sale.complete payload invalid")
			return
		}
		result, applyErr = applyCompleteSale(ctx, s.pool, tc, au, body.CommandID, sale)
		if applyErr != nil {
			if he, ok := applyErr.(*handlerError); ok {
				receiptStatus = "rejected"
				code := he.code
				errorCode = &code
				result = map[string]any{"error": he.code, "message": he.message}
				// still store receipt for permanent rejects so client stops retrying on 4xx domain
				_, _ = s.pool.Exec(ctx, `
					INSERT INTO command_receipts (
						command_id, business_id, device_id, user_id, staff_id,
						command_type, command_version, request_hash, status, response_body, error_code, applied_at
					) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'rejected',$9::jsonb,$10, now())
					ON CONFLICT (command_id) DO NOTHING
				`, body.CommandID, tc.BusinessID, tc.DeviceID, au.UserID, tc.StaffID,
					body.CommandType, body.CommandVersion, reqHash, mustJSON(result), errorCode)
				writeJSON(w, he.status, map[string]any{
					"command_id": body.CommandID,
					"status":     "rejected",
					"error":      he.code,
					"message":    he.message,
					"result":     result,
				})
				return
			}
			writeErr(w, http.StatusInternalServerError, "apply_failed", applyErr.Error())
			return
		}
	case "catalog.product.upsert":
		result, applyErr = applyProductUpsert(ctx, s, tc, body.Payload)
		if applyErr != nil {
			if he, ok := applyErr.(*handlerError); ok {
				writeErr(w, he.status, he.code, he.message)
				return
			}
			writeErr(w, http.StatusInternalServerError, "apply_failed", applyErr.Error())
			return
		}
	default:
		writeErr(w, http.StatusBadRequest, "unknown_command", "unsupported command_type: "+body.CommandType)
		return
	}

	// sale.complete already may have written receipt inside apply; ensure present
	_, err = s.pool.Exec(ctx, `
		INSERT INTO command_receipts (
			command_id, business_id, device_id, user_id, staff_id,
			command_type, command_version, request_hash, status, response_body, applied_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb, now())
		ON CONFLICT (command_id) DO NOTHING
	`, body.CommandID, tc.BusinessID, tc.DeviceID, au.UserID, tc.StaffID,
		body.CommandType, body.CommandVersion, reqHash, receiptStatus, mustJSON(result))
	if err != nil {
		// non-fatal if apply already wrote
		_ = err
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"command_id": body.CommandID,
		"status":     receiptStatus,
		"result":     result,
	})
}

func (s *Server) handleGetCommandReceipt(w http.ResponseWriter, r *http.Request) {
	tc := tenantFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_id", "id must be UUID")
		return
	}
	var (
		cmdType, status string
		version         int
		respBody        []byte
		errCode         *string
		createdAt       time.Time
		appliedAt       *time.Time
	)
	err = s.pool.QueryRow(r.Context(), `
		SELECT command_type, command_version, status, response_body, error_code, created_at, applied_at
		FROM command_receipts
		WHERE command_id = $1 AND business_id = $2
	`, id, tc.BusinessID).Scan(&cmdType, &version, &status, &respBody, &errCode, &createdAt, &appliedAt)
	if err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "command receipt not found")
		return
	}
	var parsed any
	_ = json.Unmarshal(respBody, &parsed)
	writeJSON(w, http.StatusOK, map[string]any{
		"command_id":      id,
		"command_type":    cmdType,
		"command_version": version,
		"status":          status,
		"result":          parsed,
		"error_code":      errCode,
		"created_at":      createdAt,
		"applied_at":      appliedAt,
	})
}

func applyProductUpsert(ctx context.Context, s *Server, tc *TenantContext, payload json.RawMessage) (map[string]any, error) {
	var body struct {
		ID         *uuid.UUID `json:"id"`
		Name       string     `json:"name"`
		SKU        *string    `json:"sku"`
		PriceMinor *int64     `json:"price_minor"`
		CategoryID *uuid.UUID `json:"category_id"`
		IsActive   *bool      `json:"is_active"`
	}
	if err := json.Unmarshal(payload, &body); err != nil {
		return nil, &handlerError{http.StatusBadRequest, "invalid_payload", err.Error()}
	}
	if body.Name == "" {
		return nil, &handlerError{http.StatusBadRequest, "invalid_name", "name required"}
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var id uuid.UUID
	if body.ID != nil {
		id = *body.ID
		ct, err := tx.Exec(ctx, `
			UPDATE products SET name=$3, sku=COALESCE($4, sku), category_id=COALESCE($5, category_id),
			                   is_active=COALESCE($6, is_active), updated_at=now()
			WHERE id=$1 AND business_id=$2
		`, id, tc.BusinessID, body.Name, body.SKU, body.CategoryID, body.IsActive)
		if err != nil {
			return nil, err
		}
		if ct.RowsAffected() == 0 {
			_, err = tx.Exec(ctx, `
				INSERT INTO products (id, business_id, category_id, sku, name, track_stock, is_active)
				VALUES ($1, $2, $3, $4, $5, true, COALESCE($6, true))
			`, id, tc.BusinessID, body.CategoryID, body.SKU, body.Name, body.IsActive)
			if err != nil {
				return nil, err
			}
		}
	} else {
		err = tx.QueryRow(ctx, `
			INSERT INTO products (business_id, category_id, sku, name, track_stock, is_active)
			VALUES ($1, $2, $3, $4, true, true)
			RETURNING id
		`, tc.BusinessID, body.CategoryID, body.SKU, body.Name).Scan(&id)
		if err != nil {
			return nil, err
		}
	}
	if body.PriceMinor != nil {
		var priceID uuid.UUID
		err = tx.QueryRow(ctx, `SELECT id FROM product_prices WHERE product_id=$1 AND outlet_id IS NULL`, id).Scan(&priceID)
		if err == pgx.ErrNoRows {
			_, err = tx.Exec(ctx, `
				INSERT INTO product_prices (business_id, product_id, amount_minor, currency_code)
				VALUES ($1,$2,$3,'IDR')
			`, tc.BusinessID, id, *body.PriceMinor)
		} else if err == nil {
			_, err = tx.Exec(ctx, `UPDATE product_prices SET amount_minor=$2, updated_at=now() WHERE id=$1`, priceID, *body.PriceMinor)
		}
		if err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return map[string]any{"id": id, "name": body.Name}, nil
}

func mustJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return "{}"
	}
	return string(b)
}

func hashBytes(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}
