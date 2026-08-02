package httpapi

import (
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s *Server) handleListCategories(w http.ResponseWriter, r *http.Request) {
	tc := tenantFrom(r.Context())
	rows, err := s.pool.Query(r.Context(), `
		SELECT id, parent_id, name, sort_order, is_active, created_at
		FROM categories WHERE business_id = $1
		ORDER BY sort_order, name
	`, tc.BusinessID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()
	type cat struct {
		ID        uuid.UUID  `json:"id"`
		ParentID  *uuid.UUID `json:"parent_id"`
		Name      string     `json:"name"`
		SortOrder int        `json:"sort_order"`
		IsActive  bool       `json:"is_active"`
		CreatedAt any        `json:"created_at"`
	}
	var list []cat
	for rows.Next() {
		var c cat
		if err := rows.Scan(&c.ID, &c.ParentID, &c.Name, &c.SortOrder, &c.IsActive, &c.CreatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
			return
		}
		list = append(list, c)
	}
	if list == nil {
		list = []cat{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"categories": list})
}

type createCategoryBody struct {
	Name      string     `json:"name"`
	ParentID  *uuid.UUID `json:"parent_id"`
	SortOrder int        `json:"sort_order"`
}

func (s *Server) handleCreateCategory(w http.ResponseWriter, r *http.Request) {
	tc := tenantFrom(r.Context())
	var body createCategoryBody
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
		INSERT INTO categories (business_id, parent_id, name, sort_order, is_active)
		VALUES ($1, $2, $3, $4, true)
		RETURNING id
	`, tc.BusinessID, body.ParentID, body.Name, body.SortOrder).Scan(&id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": id, "name": body.Name})
}

type patchCategoryBody struct {
	Name      *string `json:"name"`
	SortOrder *int    `json:"sort_order"`
	IsActive  *bool   `json:"is_active"`
}

func (s *Server) handlePatchCategory(w http.ResponseWriter, r *http.Request) {
	tc := tenantFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_id", "id must be UUID")
		return
	}
	var body patchCategoryBody
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_body", badRequest(err))
		return
	}
	ct, err := s.pool.Exec(r.Context(), `
		UPDATE categories SET
			name = COALESCE($3, name),
			sort_order = COALESCE($4, sort_order),
			is_active = COALESCE($5, is_active),
			updated_at = now()
		WHERE id = $1 AND business_id = $2
	`, id, tc.BusinessID, body.Name, body.SortOrder, body.IsActive)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	if ct.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "not_found", "category not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "ok": true})
}

type productDTO struct {
	ID           uuid.UUID  `json:"id"`
	CategoryID   *uuid.UUID `json:"category_id"`
	SKU          *string    `json:"sku"`
	Barcode      *string    `json:"barcode"`
	Name         string     `json:"name"`
	Description  *string    `json:"description"`
	Unit         *string    `json:"unit"`
	TrackStock   bool       `json:"track_stock"`
	IsActive     bool       `json:"is_active"`
	PriceMinor   *int64     `json:"price_minor"`
	CurrencyCode *string    `json:"currency_code"`
}

func (s *Server) handleListProducts(w http.ResponseWriter, r *http.Request) {
	tc := tenantFrom(r.Context())
	// Resolve default price; if outlet set, prefer outlet override.
	var outletID *uuid.UUID
	if tc.OutletID != nil {
		outletID = tc.OutletID
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT p.id, p.category_id, p.sku, p.barcode, p.name, p.description, p.unit,
		       p.track_stock, p.is_active,
		       COALESCE(
		         (SELECT pp.amount_minor FROM product_prices pp
		          WHERE pp.product_id = p.id AND pp.outlet_id = $2 LIMIT 1),
		         (SELECT pp.amount_minor FROM product_prices pp
		          WHERE pp.product_id = p.id AND pp.outlet_id IS NULL LIMIT 1)
		       ) AS price_minor,
		       COALESCE(
		         (SELECT pp.currency_code FROM product_prices pp
		          WHERE pp.product_id = p.id AND pp.outlet_id = $2 LIMIT 1),
		         (SELECT pp.currency_code FROM product_prices pp
		          WHERE pp.product_id = p.id AND pp.outlet_id IS NULL LIMIT 1),
		         'IDR'
		       ) AS currency_code
		FROM products p
		WHERE p.business_id = $1
		ORDER BY p.name
	`, tc.BusinessID, outletID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()
	var list []productDTO
	for rows.Next() {
		var p productDTO
		if err := rows.Scan(&p.ID, &p.CategoryID, &p.SKU, &p.Barcode, &p.Name, &p.Description, &p.Unit,
			&p.TrackStock, &p.IsActive, &p.PriceMinor, &p.CurrencyCode); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
			return
		}
		list = append(list, p)
	}
	if list == nil {
		list = []productDTO{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"products": list})
}

func (s *Server) handleGetProduct(w http.ResponseWriter, r *http.Request) {
	tc := tenantFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_id", "id must be UUID")
		return
	}
	var p productDTO
	err = s.pool.QueryRow(r.Context(), `
		SELECT p.id, p.category_id, p.sku, p.barcode, p.name, p.description, p.unit,
		       p.track_stock, p.is_active,
		       (SELECT pp.amount_minor FROM product_prices pp
		        WHERE pp.product_id = p.id AND pp.outlet_id IS NULL LIMIT 1),
		       (SELECT pp.currency_code FROM product_prices pp
		        WHERE pp.product_id = p.id AND pp.outlet_id IS NULL LIMIT 1)
		FROM products p
		WHERE p.id = $1 AND p.business_id = $2
	`, id, tc.BusinessID).Scan(&p.ID, &p.CategoryID, &p.SKU, &p.Barcode, &p.Name, &p.Description, &p.Unit,
		&p.TrackStock, &p.IsActive, &p.PriceMinor, &p.CurrencyCode)
	if err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "product not found")
		return
	}
	writeJSON(w, http.StatusOK, p)
}

type createProductBody struct {
	CategoryID  *uuid.UUID `json:"category_id"`
	SKU         *string    `json:"sku"`
	Barcode     *string    `json:"barcode"`
	Name        string     `json:"name"`
	Description *string    `json:"description"`
	Unit        *string    `json:"unit"`
	TrackStock  *bool      `json:"track_stock"`
	PriceMinor  *int64     `json:"price_minor"`
	Currency    string     `json:"currency_code"`
}

func (s *Server) handleCreateProduct(w http.ResponseWriter, r *http.Request) {
	tc := tenantFrom(r.Context())
	var body createProductBody
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_body", badRequest(err))
		return
	}
	if body.Name == "" {
		writeErr(w, http.StatusBadRequest, "invalid_name", "name is required")
		return
	}
	track := true
	if body.TrackStock != nil {
		track = *body.TrackStock
	}
	if body.Currency == "" {
		body.Currency = "IDR"
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
		INSERT INTO products (business_id, category_id, sku, barcode, name, description, unit, track_stock, is_active)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
		RETURNING id
	`, tc.BusinessID, body.CategoryID, body.SKU, body.Barcode, body.Name, body.Description, body.Unit, track).Scan(&id)
	if err != nil {
		if isUniqueViolation(err) {
			writeErr(w, http.StatusConflict, "duplicate", "sku or barcode already exists")
			return
		}
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	if body.PriceMinor != nil {
		_, err = tx.Exec(ctx, `
			INSERT INTO product_prices (business_id, product_id, outlet_id, amount_minor, currency_code)
			VALUES ($1, $2, NULL, $3, $4)
		`, tc.BusinessID, id, *body.PriceMinor, body.Currency)
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
		"id":          id,
		"name":        body.Name,
		"price_minor": body.PriceMinor,
	})
}

type patchProductBody struct {
	CategoryID  *uuid.UUID `json:"category_id"`
	SKU         *string    `json:"sku"`
	Name        *string    `json:"name"`
	Description *string    `json:"description"`
	Unit        *string    `json:"unit"`
	TrackStock  *bool      `json:"track_stock"`
	IsActive    *bool      `json:"is_active"`
	PriceMinor  *int64     `json:"price_minor"`
	Currency    *string    `json:"currency_code"`
}

func (s *Server) handlePatchProduct(w http.ResponseWriter, r *http.Request) {
	tc := tenantFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_id", "id must be UUID")
		return
	}
	var body patchProductBody
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_body", badRequest(err))
		return
	}
	ctx := r.Context()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer tx.Rollback(ctx)

	ct, err := tx.Exec(ctx, `
		UPDATE products SET
			category_id = COALESCE($3, category_id),
			sku = COALESCE($4, sku),
			name = COALESCE($5, name),
			description = COALESCE($6, description),
			unit = COALESCE($7, unit),
			track_stock = COALESCE($8, track_stock),
			is_active = COALESCE($9, is_active),
			updated_at = now()
		WHERE id = $1 AND business_id = $2
	`, id, tc.BusinessID, body.CategoryID, body.SKU, body.Name, body.Description, body.Unit, body.TrackStock, body.IsActive)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	if ct.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "not_found", "product not found")
		return
	}
	if body.PriceMinor != nil {
		cur := "IDR"
		if body.Currency != nil {
			cur = *body.Currency
		}
		// upsert default price
		var priceID uuid.UUID
		err = tx.QueryRow(ctx, `
			SELECT id FROM product_prices WHERE product_id = $1 AND outlet_id IS NULL
		`, id).Scan(&priceID)
		if err == pgx.ErrNoRows {
			_, err = tx.Exec(ctx, `
				INSERT INTO product_prices (business_id, product_id, outlet_id, amount_minor, currency_code)
				VALUES ($1, $2, NULL, $3, $4)
			`, tc.BusinessID, id, *body.PriceMinor, cur)
		} else if err == nil {
			_, err = tx.Exec(ctx, `
				UPDATE product_prices SET amount_minor = $2, currency_code = $3, updated_at = now()
				WHERE id = $1
			`, priceID, *body.PriceMinor, cur)
		}
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
			return
		}
	}
	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "ok": true})
}
