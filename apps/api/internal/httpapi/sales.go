package httpapi

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type saleLineIn struct {
	ProductID      *uuid.UUID `json:"product_id"`
	SKUSnapshot    *string    `json:"sku_snapshot"`
	NameSnapshot   string     `json:"name_snapshot"`
	Qty            float64    `json:"qty"`
	UnitPriceMinor int64      `json:"unit_price_minor"`
	DiscountMinor  int64      `json:"discount_minor"`
	LineTotalMinor int64      `json:"line_total_minor"`
}

type paymentIn struct {
	Method      string  `json:"method"`
	AmountMinor int64   `json:"amount_minor"`
	Reference   *string `json:"reference"`
}

// completeSaleBody is used by online POST /v1/sales/complete and sale.complete command.
type completeSaleBody struct {
	ClientSaleID   uuid.UUID    `json:"client_sale_id"`
	OutletID       uuid.UUID    `json:"outlet_id"`
	StaffID        *uuid.UUID   `json:"staff_id"`
	Lines          []saleLineIn `json:"lines"`
	Payments       []paymentIn  `json:"payments"`
	SubtotalMinor  int64        `json:"subtotal_minor"`
	DiscountMinor  int64        `json:"discount_minor"`
	TaxMinor       int64        `json:"tax_minor"`
	TotalMinor     int64        `json:"total_minor"`
	CurrencyCode   string       `json:"currency_code"`
	Note           *string      `json:"note"`
	ReceiptNo      *string      `json:"receipt_no"`
}

func (s *Server) handleListSales(w http.ResponseWriter, r *http.Request) {
	tc := tenantFrom(r.Context())
	q := `
		SELECT id, outlet_id, staff_id, status, client_sale_id, receipt_no,
		       subtotal_minor, discount_minor, tax_minor, total_minor, currency_code,
		       note, completed_at, created_at
		FROM sales
		WHERE business_id = $1
	`
	args := []any{tc.BusinessID}
	if tc.OutletID != nil {
		q += ` AND outlet_id = $2`
		args = append(args, *tc.OutletID)
	}
	q += ` ORDER BY COALESCE(completed_at, created_at) DESC LIMIT 100`

	rows, err := s.pool.Query(r.Context(), q, args...)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()

	type sale struct {
		ID            uuid.UUID  `json:"id"`
		OutletID      uuid.UUID  `json:"outlet_id"`
		StaffID       *uuid.UUID `json:"staff_id"`
		Status        string     `json:"status"`
		ClientSaleID  uuid.UUID  `json:"client_sale_id"`
		ReceiptNo     *string    `json:"receipt_no"`
		SubtotalMinor int64      `json:"subtotal_minor"`
		DiscountMinor int64      `json:"discount_minor"`
		TaxMinor      int64      `json:"tax_minor"`
		TotalMinor    int64      `json:"total_minor"`
		CurrencyCode  string     `json:"currency_code"`
		Note          *string    `json:"note"`
		CompletedAt   *time.Time `json:"completed_at"`
		CreatedAt     time.Time  `json:"created_at"`
	}
	var list []sale
	for rows.Next() {
		var row sale
		if err := rows.Scan(&row.ID, &row.OutletID, &row.StaffID, &row.Status, &row.ClientSaleID, &row.ReceiptNo,
			&row.SubtotalMinor, &row.DiscountMinor, &row.TaxMinor, &row.TotalMinor, &row.CurrencyCode,
			&row.Note, &row.CompletedAt, &row.CreatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
			return
		}
		list = append(list, row)
	}
	if list == nil {
		list = []sale{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"sales": list})
}

func (s *Server) handleGetSale(w http.ResponseWriter, r *http.Request) {
	tc := tenantFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_id", "id must be UUID")
		return
	}
	detail, err := loadSaleDetail(r.Context(), s.pool, tc.BusinessID, id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "sale not found")
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

func (s *Server) handleCompleteSaleOnline(w http.ResponseWriter, r *http.Request) {
	tc := tenantFrom(r.Context())
	au := userFrom(r.Context())
	var body completeSaleBody
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_body", badRequest(err))
		return
	}
	// online path uses a server-generated command id for receipt tracking
	cmdID := uuid.New()
	result, err := applyCompleteSale(r.Context(), s.pool, tc, au, cmdID, body)
	if err != nil {
		if he, ok := err.(*handlerError); ok {
			writeErr(w, he.status, he.code, he.message)
			return
		}
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

type handlerError struct {
	status  int
	code    string
	message string
}

func (e *handlerError) Error() string { return e.message }

func loadSaleDetail(ctx context.Context, pool *pgxpool.Pool, businessID, saleID uuid.UUID) (map[string]any, error) {
	var (
		id, outletID, clientSaleID                       uuid.UUID
		staffID                                          *uuid.UUID
		status, currency                                 string
		receiptNo, note                                  *string
		subtotal, discount, tax, total                   int64
		completedAt                                      *time.Time
		createdAt                                        time.Time
	)
	err := pool.QueryRow(ctx, `
		SELECT id, outlet_id, staff_id, status, client_sale_id, receipt_no,
		       subtotal_minor, discount_minor, tax_minor, total_minor, currency_code,
		       note, completed_at, created_at
		FROM sales WHERE id = $1 AND business_id = $2
	`, saleID, businessID).Scan(&id, &outletID, &staffID, &status, &clientSaleID, &receiptNo,
		&subtotal, &discount, &tax, &total, &currency, &note, &completedAt, &createdAt)
	if err != nil {
		return nil, err
	}

	lineRows, err := pool.Query(ctx, `
		SELECT id, product_id, line_no, sku_snapshot, name_snapshot, qty,
		       unit_price_minor, discount_minor, line_total_minor
		FROM sale_lines WHERE sale_id = $1 ORDER BY line_no
	`, saleID)
	if err != nil {
		return nil, err
	}
	defer lineRows.Close()
	var lines []map[string]any
	for lineRows.Next() {
		var (
			lineID                                 uuid.UUID
			productID                              *uuid.UUID
			lineNo                                 int
			sku                                    *string
			nameSnapshot                           string
			qty                                    float64
			unitPrice, disc, lineTotal             int64
		)
		if err := lineRows.Scan(&lineID, &productID, &lineNo, &sku, &nameSnapshot, &qty, &unitPrice, &disc, &lineTotal); err != nil {
			return nil, err
		}
		lines = append(lines, map[string]any{
			"id":               lineID,
			"product_id":       productID,
			"line_no":          lineNo,
			"sku_snapshot":     sku,
			"name_snapshot":    nameSnapshot,
			"qty":              qty,
			"unit_price_minor": unitPrice,
			"discount_minor":   disc,
			"line_total_minor": lineTotal,
		})
	}
	if lines == nil {
		lines = []map[string]any{}
	}

	payRows, err := pool.Query(ctx, `
		SELECT id, method, amount_minor, reference, paid_at
		FROM payments WHERE sale_id = $1 ORDER BY paid_at
	`, saleID)
	if err != nil {
		return nil, err
	}
	defer payRows.Close()
	var payments []map[string]any
	for payRows.Next() {
		var (
			pid       uuid.UUID
			method    string
			amount    int64
			ref       *string
			paidAt    time.Time
		)
		if err := payRows.Scan(&pid, &method, &amount, &ref, &paidAt); err != nil {
			return nil, err
		}
		payments = append(payments, map[string]any{
			"id":           pid,
			"method":       method,
			"amount_minor": amount,
			"reference":    ref,
			"paid_at":      paidAt,
		})
	}
	if payments == nil {
		payments = []map[string]any{}
	}

	return map[string]any{
		"id":              id,
		"outlet_id":       outletID,
		"staff_id":        staffID,
		"status":          status,
		"client_sale_id":  clientSaleID,
		"receipt_no":      receiptNo,
		"subtotal_minor":  subtotal,
		"discount_minor":  discount,
		"tax_minor":       tax,
		"total_minor":     total,
		"currency_code":   currency,
		"note":            note,
		"completed_at":    completedAt,
		"created_at":      createdAt,
		"lines":           lines,
		"payments":        payments,
	}, nil
}

// applyCompleteSale inserts a completed sale (idempotent on client_sale_id).
// Also writes a command_receipt when commandID is non-nil path for outbox.
func applyCompleteSale(
	ctx context.Context,
	pool *pgxpool.Pool,
	tc *TenantContext,
	au *AuthUser,
	commandID uuid.UUID,
	body completeSaleBody,
) (map[string]any, error) {
	if body.ClientSaleID == uuid.Nil {
		return nil, &handlerError{http.StatusBadRequest, "invalid_client_sale_id", "client_sale_id is required"}
	}
	if body.OutletID == uuid.Nil {
		if tc.OutletID != nil {
			body.OutletID = *tc.OutletID
		} else {
			return nil, &handlerError{http.StatusBadRequest, "invalid_outlet", "outlet_id is required"}
		}
	}
	if len(body.Lines) == 0 {
		return nil, &handlerError{http.StatusBadRequest, "empty_lines", "at least one line is required"}
	}
	if body.CurrencyCode == "" {
		body.CurrencyCode = "IDR"
	}
	if body.StaffID == nil && tc.StaffID != nil {
		body.StaffID = tc.StaffID
	}

	// recompute totals from lines if client sent zeros
	var sumLines int64
	for i := range body.Lines {
		ln := &body.Lines[i]
		if ln.NameSnapshot == "" {
			return nil, &handlerError{http.StatusBadRequest, "invalid_line", "name_snapshot required"}
		}
		if ln.Qty <= 0 {
			return nil, &handlerError{http.StatusBadRequest, "invalid_qty", "qty must be > 0"}
		}
		if ln.LineTotalMinor == 0 {
			ln.LineTotalMinor = int64(ln.Qty*float64(ln.UnitPriceMinor)) - ln.DiscountMinor
		}
		sumLines += ln.LineTotalMinor
	}
	if body.SubtotalMinor == 0 {
		body.SubtotalMinor = sumLines + body.DiscountMinor
	}
	if body.TotalMinor == 0 {
		body.TotalMinor = body.SubtotalMinor - body.DiscountMinor + body.TaxMinor
	}
	if len(body.Payments) == 0 {
		body.Payments = []paymentIn{{Method: "cash", AmountMinor: body.TotalMinor}}
	}
	var paySum int64
	for _, p := range body.Payments {
		if p.Method == "" {
			return nil, &handlerError{http.StatusBadRequest, "invalid_payment", "payment method required"}
		}
		paySum += p.AmountMinor
	}
	if paySum < body.TotalMinor {
		return nil, &handlerError{http.StatusBadRequest, "underpaid", "payments less than total"}
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// Idempotent: existing sale by client_sale_id
	var existing uuid.UUID
	err = tx.QueryRow(ctx, `
		SELECT id FROM sales WHERE business_id = $1 AND client_sale_id = $2
	`, tc.BusinessID, body.ClientSaleID).Scan(&existing)
	if err == nil {
		detail, err := loadSaleDetailTx(ctx, tx, tc.BusinessID, existing)
		if err != nil {
			return nil, err
		}
		detail["idempotent_replay"] = true
		return detail, tx.Commit(ctx)
	} else if err != pgx.ErrNoRows {
		return nil, err
	}

	// Validate outlet
	var outletOK bool
	_ = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM outlets WHERE id=$1 AND business_id=$2 AND is_active)`,
		body.OutletID, tc.BusinessID).Scan(&outletOK)
	if !outletOK {
		return nil, &handlerError{http.StatusBadRequest, "invalid_outlet", "outlet not found"}
	}

	receiptNo := body.ReceiptNo
	if receiptNo == nil || *receiptNo == "" {
		// simple sequential-ish receipt: timestamp-based
		n := fmt.Sprintf("R%s", time.Now().Format("20060102150405"))
		receiptNo = &n
	}

	var saleID uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO sales (
			business_id, outlet_id, staff_id, status, client_sale_id, receipt_no,
			subtotal_minor, discount_minor, tax_minor, total_minor, currency_code,
			note, completed_at
		) VALUES (
			$1, $2, $3, 'completed', $4, $5,
			$6, $7, $8, $9, $10,
			$11, now()
		) RETURNING id
	`, tc.BusinessID, body.OutletID, body.StaffID, body.ClientSaleID, receiptNo,
		body.SubtotalMinor, body.DiscountMinor, body.TaxMinor, body.TotalMinor, body.CurrencyCode,
		body.Note).Scan(&saleID)
	if err != nil {
		if isUniqueViolation(err) {
			// race: reload
			_ = tx.QueryRow(ctx, `SELECT id FROM sales WHERE business_id=$1 AND client_sale_id=$2`,
				tc.BusinessID, body.ClientSaleID).Scan(&existing)
			detail, e2 := loadSaleDetailTx(ctx, tx, tc.BusinessID, existing)
			if e2 != nil {
				return nil, err
			}
			detail["idempotent_replay"] = true
			return detail, tx.Commit(ctx)
		}
		return nil, err
	}

	for i, ln := range body.Lines {
		_, err = tx.Exec(ctx, `
			INSERT INTO sale_lines (
				business_id, sale_id, product_id, line_no, sku_snapshot, name_snapshot,
				qty, unit_price_minor, discount_minor, line_total_minor
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		`, tc.BusinessID, saleID, ln.ProductID, i+1, ln.SKUSnapshot, ln.NameSnapshot,
			ln.Qty, ln.UnitPriceMinor, ln.DiscountMinor, ln.LineTotalMinor)
		if err != nil {
			return nil, err
		}
		// decrement stock when tracking
		if ln.ProductID != nil {
			var track bool
			err = tx.QueryRow(ctx, `
				SELECT track_stock FROM products WHERE id=$1 AND business_id=$2
			`, *ln.ProductID, tc.BusinessID).Scan(&track)
			if err == nil && track {
				_, err = tx.Exec(ctx, `
					INSERT INTO stock_levels (business_id, product_id, outlet_id, qty, version)
					VALUES ($1, $2, $3, -$4::numeric, 1)
					ON CONFLICT (product_id, outlet_id) DO UPDATE SET
						qty = stock_levels.qty - $4::numeric,
						version = stock_levels.version + 1,
						updated_at = now()
				`, tc.BusinessID, *ln.ProductID, body.OutletID, ln.Qty)
				if err != nil {
					return nil, err
				}
			}
		}
	}

	for _, p := range body.Payments {
		_, err = tx.Exec(ctx, `
			INSERT INTO payments (business_id, sale_id, method, amount_minor, reference, paid_at)
			VALUES ($1, $2, $3, $4, $5, now())
		`, tc.BusinessID, saleID, p.Method, p.AmountMinor, p.Reference)
		if err != nil {
			return nil, err
		}
	}

	// Optional command receipt for online path
	if commandID != uuid.Nil {
		resp := map[string]any{"sale_id": saleID, "client_sale_id": body.ClientSaleID, "receipt_no": receiptNo}
		// store later by caller for outbox path; for online we insert light receipt
		_, _ = tx.Exec(ctx, `
			INSERT INTO command_receipts (
				command_id, business_id, device_id, user_id, staff_id,
				command_type, command_version, status, response_body, applied_at
			) VALUES ($1,$2,$3,$4,$5,'sale.complete',1,'applied',$6::jsonb, now())
			ON CONFLICT (command_id) DO NOTHING
		`, commandID, tc.BusinessID, tc.DeviceID, au.UserID, body.StaffID, mustJSON(resp))
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	detail, err := loadSaleDetail(ctx, pool, tc.BusinessID, saleID)
	if err != nil {
		return map[string]any{
			"id":             saleID,
			"client_sale_id": body.ClientSaleID,
			"receipt_no":     receiptNo,
			"status":         "completed",
			"total_minor":    body.TotalMinor,
		}, nil
	}
	return detail, nil
}

func loadSaleDetailTx(ctx context.Context, tx pgx.Tx, businessID, saleID uuid.UUID) (map[string]any, error) {
	// minimal replay payload
	var (
		id, outletID, clientSaleID uuid.UUID
		status, currency           string
		receiptNo                  *string
		total                      int64
		completedAt                *time.Time
	)
	err := tx.QueryRow(ctx, `
		SELECT id, outlet_id, status, client_sale_id, receipt_no, total_minor, currency_code, completed_at
		FROM sales WHERE id=$1 AND business_id=$2
	`, saleID, businessID).Scan(&id, &outletID, &status, &clientSaleID, &receiptNo, &total, &currency, &completedAt)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"id":             id,
		"outlet_id":      outletID,
		"status":         status,
		"client_sale_id": clientSaleID,
		"receipt_no":     receiptNo,
		"total_minor":    total,
		"currency_code":  currency,
		"completed_at":   completedAt,
	}, nil
}
