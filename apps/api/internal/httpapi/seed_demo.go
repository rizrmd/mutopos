package httpapi

import (
	"context"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// dbTX is satisfied by *pgxpool.Pool and pgx.Tx.
type dbTX interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Vita daytime mockup sample data (Rubirosa-style restaurant POS).
// Prices are USD cents so $12.95 → 1295.

var demoCategories = []struct {
	Name string
	Sort int
}{
	{"Starters", 1},
	{"Oysters", 2},
	{"Hummer", 3},
	{"Grill", 4},
	{"Sides", 5},
	{"Desserts", 6},
	{"Drinks", 7},
}

var demoProducts = []struct {
	Category string
	Name     string
	SKU      string
	Price    int64 // USD cents
}{
	// Oysters (hero category from mockup)
	{"Oysters", "Oyster Belon", "OY-BEL", 1295},
	{"Oysters", "De Normandie", "OY-NOR", 1295},
	{"Oysters", "Fried oyster", "OY-FRI", 1295},
	{"Oysters", "Teriyaki Oyster", "OY-TER", 1295},
	{"Oysters", "Classic oysters", "OY-CLA", 1295},
	{"Oysters", "BLT Oyster", "OY-BLT", 1495},
	{"Oysters", "Grilled oyster", "OY-GRI", 1295},
	{"Oysters", "Oyster Rockefeller", "OY-ROC", 1595},
	// Starters
	{"Starters", "Caesar Salad", "ST-CAE", 1450},
	{"Starters", "Onion Soup", "ST-ONI", 1250},
	{"Starters", "French Toast", "ST-FRE", 1450},
	{"Starters", "BLT Sandwich", "ST-BLT", 1250},
	// Hummer / Grill
	{"Hummer", "Lobster roll", "HU-LOB", 2495},
	{"Hummer", "Garlic shrimp", "HU-SHR", 1895},
	{"Grill", "Chili cheese burger", "GR-CCB", 1850},
	{"Grill", "Ribeye steak", "GR-RIB", 3295},
	{"Grill", "Grilled salmon", "GR-SAL", 2295},
	// Sides / Desserts / Drinks
	{"Sides", "French fries", "SI-FRI", 650},
	{"Sides", "Onion rings", "SI-ONI", 750},
	{"Sides", "Coleslaw", "SI-COL", 550},
	{"Desserts", "Tiramisu", "DE-TIR", 995},
	{"Desserts", "Cheesecake", "DE-CHE", 895},
	{"Drinks", "Sparkling water", "DR-SPA", 395},
	{"Drinks", "House lemonade", "DR-LEM", 495},
	{"Drinks", "Espresso", "DR-ESP", 350},
}

var demoStaff = []struct {
	Name string
	Role string
}{
	{"Jessica S.", "cashier"},
	{"Ryan T.", "cashier"},
	{"Anna K.", "cashier"},
}

// seedVitaDemoCatalog fills categories + products when the catalog is empty.
// Idempotent: skips if any category already exists for the business.
func seedVitaDemoCatalog(ctx context.Context, q dbTX, businessID uuid.UUID) (seeded bool, err error) {
	var catCount int
	if err = q.QueryRow(ctx, `
		SELECT COUNT(*) FROM categories WHERE business_id = $1
	`, businessID).Scan(&catCount); err != nil {
		return false, err
	}
	if catCount > 0 {
		return false, nil
	}

	catIDs := make(map[string]uuid.UUID, len(demoCategories))
	for _, c := range demoCategories {
		var id uuid.UUID
		err = q.QueryRow(ctx, `
			INSERT INTO categories (business_id, name, sort_order, is_active)
			VALUES ($1, $2, $3, true)
			RETURNING id
		`, businessID, c.Name, c.Sort).Scan(&id)
		if err != nil {
			return false, err
		}
		catIDs[c.Name] = id
	}

	for _, p := range demoProducts {
		catID := catIDs[p.Category]
		var productID uuid.UUID
		sku := p.SKU
		err = q.QueryRow(ctx, `
			INSERT INTO products (business_id, category_id, sku, name, track_stock, is_active)
			VALUES ($1, $2, $3, $4, false, true)
			RETURNING id
		`, businessID, catID, sku, p.Name).Scan(&productID)
		if err != nil {
			return false, err
		}
		_, err = q.Exec(ctx, `
			INSERT INTO product_prices (business_id, product_id, amount_minor, currency_code)
			VALUES ($1, $2, $3, 'USD')
		`, businessID, productID, p.Price)
		if err != nil {
			return false, err
		}
	}
	return true, nil
}

// seedVitaDemoStaff adds Jessica / Ryan / Anna when only the owner staff row exists.
func seedVitaDemoStaff(ctx context.Context, q dbTX, businessID, outletID uuid.UUID) (added int, err error) {
	var staffCount int
	if err = q.QueryRow(ctx, `
		SELECT COUNT(*) FROM staff WHERE business_id = $1 AND status = 'active'
	`, businessID).Scan(&staffCount); err != nil {
		return 0, err
	}
	// Owner-only (or empty) → add floor staff from the mockup.
	if staffCount > 1 {
		return 0, nil
	}

	for _, s := range demoStaff {
		var id uuid.UUID
		err = q.QueryRow(ctx, `
			INSERT INTO staff (business_id, display_name, role, status)
			VALUES ($1, $2, $3, 'active')
			RETURNING id
		`, businessID, s.Name, s.Role).Scan(&id)
		if err != nil {
			return added, err
		}
		_, _ = q.Exec(ctx, `
			INSERT INTO staff_outlets (staff_id, outlet_id, business_id)
			VALUES ($1, $2, $3)
			ON CONFLICT (staff_id, outlet_id) DO NOTHING
		`, id, outletID, businessID)
		added++
	}
	return added, nil
}

// applyVitaDemoBranding renames empty/default business + outlet to match the mockup.
func applyVitaDemoBranding(ctx context.Context, q dbTX, businessID, outletID uuid.UUID) error {
	_, err := q.Exec(ctx, `
		UPDATE businesses
		SET name = CASE
			WHEN name IN ('My Business') OR name LIKE '%''s Business' THEN 'Rubirosa Ristorante'
			ELSE name
		END,
		timezone = 'America/New_York',
		currency_code = 'USD',
		updated_at = now()
		WHERE id = $1
	`, businessID)
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx, `
		UPDATE outlets
		SET name = CASE WHEN name = 'Main Outlet' THEN 'Table floor' ELSE name END,
		    updated_at = now()
		WHERE id = $1 AND business_id = $2
	`, outletID, businessID)
	return err
}

// seedFullVitaDemo runs catalog + staff + branding (idempotent pieces).
func seedFullVitaDemo(ctx context.Context, q dbTX, businessID, outletID uuid.UUID) (map[string]any, error) {
	if err := applyVitaDemoBranding(ctx, q, businessID, outletID); err != nil {
		return nil, err
	}
	catalog, err := seedVitaDemoCatalog(ctx, q, businessID)
	if err != nil {
		return nil, err
	}
	staffAdded, err := seedVitaDemoStaff(ctx, q, businessID, outletID)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"catalog_seeded": catalog,
		"staff_added":    staffAdded,
		"business":       "Rubirosa Ristorante",
	}, nil
}

// POST /v1/demo/seed — fill Vita-style sample data for the current tenant (safe for empty catalogs).
func (s *Server) handleSeedDemo(w http.ResponseWriter, r *http.Request) {
	tc := tenantFrom(r.Context())
	ctx := r.Context()

	outletID := tc.OutletID
	if outletID == nil {
		var id uuid.UUID
		err := s.pool.QueryRow(ctx, `
			SELECT id FROM outlets WHERE business_id = $1 AND is_active = true
			ORDER BY created_at LIMIT 1
		`, tc.BusinessID).Scan(&id)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "no_outlet", "create an outlet first")
			return
		}
		outletID = &id
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer tx.Rollback(ctx)

	result, err := seedFullVitaDemo(ctx, tx, tc.BusinessID, *outletID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "seed_failed", err.Error())
		return
	}
	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "demo": result})
}
