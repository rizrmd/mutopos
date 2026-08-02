-- MutoPOS initial schema (aligned with docs/erd.md)
-- Multi-tenant Business, WA E.164 owner login, outlet/staff, catalog, sales, outbox support.
-- Money: amount_minor BIGINT (IDR default, zero decimals).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Platform identity (no business_id)
-- ---------------------------------------------------------------------------

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_e164      TEXT NOT NULL,
    display_name    TEXT,
    wa_verified_at  TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'disabled')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT users_phone_e164_unique UNIQUE (phone_e164)
);

CREATE TABLE auth_challenges (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_e164      TEXT NOT NULL,
    channel         TEXT NOT NULL DEFAULT 'whatsapp'
                    CHECK (channel IN ('whatsapp')),
    purpose         TEXT NOT NULL DEFAULT 'login'
                    CHECK (purpose IN ('login', 'link_phone')),
    code_hash       TEXT NOT NULL,
    attempts        INT NOT NULL DEFAULT 0,
    max_attempts    INT NOT NULL DEFAULT 5,
    expires_at      TIMESTAMPTZ NOT NULL,
    consumed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    request_meta    JSONB
);

CREATE INDEX auth_challenges_phone_created_idx
    ON auth_challenges (phone_e164, created_at DESC);

-- sessions.device_id added after devices table exists (FK below)
CREATE TABLE sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users (id),
    token_hash      TEXT NOT NULL,
    device_id       UUID,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);

-- ---------------------------------------------------------------------------
-- Tenant: businesses, members, outlets, staff
-- ---------------------------------------------------------------------------

CREATE TABLE businesses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    legal_name      TEXT,
    timezone        TEXT NOT NULL DEFAULT 'Asia/Jakarta',
    currency_code   CHAR(3) NOT NULL DEFAULT 'IDR',
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'suspended', 'closed')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE business_members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     UUID NOT NULL REFERENCES businesses (id),
    user_id         UUID NOT NULL REFERENCES users (id),
    role            TEXT NOT NULL
                    CHECK (role IN ('owner', 'admin', 'manager', 'cashier')),
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'invited', 'revoked')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT business_members_business_user_unique UNIQUE (business_id, user_id)
);

CREATE INDEX business_members_user_id_idx ON business_members (user_id);

CREATE TABLE outlets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     UUID NOT NULL REFERENCES businesses (id),
    name            TEXT NOT NULL,
    code            TEXT,
    address         TEXT,
    timezone        TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX outlets_business_code_unique
    ON outlets (business_id, code)
    WHERE code IS NOT NULL;

CREATE INDEX outlets_business_id_idx ON outlets (business_id);

CREATE TABLE staff (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     UUID NOT NULL REFERENCES businesses (id),
    user_id         UUID REFERENCES users (id),
    display_name    TEXT NOT NULL,
    role            TEXT NOT NULL
                    CHECK (role IN ('manager', 'cashier')),
    pin_hash        TEXT,
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'disabled')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX staff_business_user_unique
    ON staff (business_id, user_id)
    WHERE user_id IS NOT NULL;

CREATE INDEX staff_business_status_idx ON staff (business_id, status);

CREATE TABLE staff_outlets (
    staff_id        UUID NOT NULL REFERENCES staff (id),
    outlet_id       UUID NOT NULL REFERENCES outlets (id),
    business_id     UUID NOT NULL REFERENCES businesses (id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (staff_id, outlet_id)
);

CREATE INDEX staff_outlets_outlet_id_idx ON staff_outlets (outlet_id);

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------

CREATE TABLE categories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     UUID NOT NULL REFERENCES businesses (id),
    parent_id       UUID REFERENCES categories (id),
    name            TEXT NOT NULL,
    sort_order      INT NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX categories_business_id_idx ON categories (business_id);

CREATE TABLE products (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     UUID NOT NULL REFERENCES businesses (id),
    category_id     UUID REFERENCES categories (id),
    sku             TEXT,
    barcode         TEXT,
    name            TEXT NOT NULL,
    description     TEXT,
    unit            TEXT,
    track_stock     BOOLEAN NOT NULL DEFAULT true,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX products_business_sku_unique
    ON products (business_id, sku)
    WHERE sku IS NOT NULL;

CREATE UNIQUE INDEX products_business_barcode_unique
    ON products (business_id, barcode)
    WHERE barcode IS NOT NULL;

CREATE INDEX products_business_active_idx ON products (business_id, is_active);

CREATE TABLE product_prices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     UUID NOT NULL REFERENCES businesses (id),
    product_id      UUID NOT NULL REFERENCES products (id),
    outlet_id       UUID REFERENCES outlets (id),
    amount_minor    BIGINT NOT NULL CHECK (amount_minor >= 0),
    currency_code   CHAR(3) NOT NULL DEFAULT 'IDR',
    effective_from  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One default price (outlet_id IS NULL) and one override per outlet per product
CREATE UNIQUE INDEX product_prices_default_unique
    ON product_prices (product_id)
    WHERE outlet_id IS NULL;

CREATE UNIQUE INDEX product_prices_outlet_unique
    ON product_prices (product_id, outlet_id)
    WHERE outlet_id IS NOT NULL;

CREATE TABLE stock_levels (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     UUID NOT NULL REFERENCES businesses (id),
    product_id      UUID NOT NULL REFERENCES products (id),
    outlet_id       UUID NOT NULL REFERENCES outlets (id),
    qty             NUMERIC(18, 3) NOT NULL DEFAULT 0,
    version         BIGINT NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT stock_levels_product_outlet_unique UNIQUE (product_id, outlet_id)
);

CREATE INDEX stock_levels_business_outlet_idx
    ON stock_levels (business_id, outlet_id);

-- ---------------------------------------------------------------------------
-- Sales (transaksi)
-- ---------------------------------------------------------------------------

CREATE TABLE sales (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     UUID NOT NULL REFERENCES businesses (id),
    outlet_id       UUID NOT NULL REFERENCES outlets (id),
    staff_id        UUID REFERENCES staff (id),
    status          TEXT NOT NULL
                    CHECK (status IN ('draft', 'completed', 'voided', 'refunded')),
    client_sale_id  UUID NOT NULL,
    receipt_no      TEXT,
    subtotal_minor  BIGINT NOT NULL DEFAULT 0,
    discount_minor  BIGINT NOT NULL DEFAULT 0,
    tax_minor       BIGINT NOT NULL DEFAULT 0,
    total_minor     BIGINT NOT NULL DEFAULT 0,
    currency_code   CHAR(3) NOT NULL DEFAULT 'IDR',
    note            TEXT,
    completed_at    TIMESTAMPTZ,
    voided_at       TIMESTAMPTZ,
    void_reason     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT sales_business_client_sale_unique UNIQUE (business_id, client_sale_id)
);

CREATE UNIQUE INDEX sales_receipt_no_unique
    ON sales (business_id, outlet_id, receipt_no)
    WHERE receipt_no IS NOT NULL;

CREATE INDEX sales_outlet_completed_idx
    ON sales (business_id, outlet_id, completed_at DESC);

CREATE INDEX sales_status_updated_idx
    ON sales (business_id, status, updated_at);

CREATE TABLE sale_lines (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id         UUID NOT NULL REFERENCES businesses (id),
    sale_id             UUID NOT NULL REFERENCES sales (id) ON DELETE CASCADE,
    product_id          UUID REFERENCES products (id),
    line_no             INT NOT NULL,
    sku_snapshot        TEXT,
    name_snapshot       TEXT NOT NULL,
    qty                 NUMERIC(18, 3) NOT NULL,
    unit_price_minor    BIGINT NOT NULL,
    discount_minor      BIGINT NOT NULL DEFAULT 0,
    line_total_minor    BIGINT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT sale_lines_sale_line_no_unique UNIQUE (sale_id, line_no)
);

CREATE INDEX sale_lines_sale_id_idx ON sale_lines (sale_id);

CREATE TABLE payments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     UUID NOT NULL REFERENCES businesses (id),
    sale_id         UUID NOT NULL REFERENCES sales (id) ON DELETE CASCADE,
    method          TEXT NOT NULL
                    CHECK (method IN ('cash', 'qris', 'transfer', 'card', 'other')),
    amount_minor    BIGINT NOT NULL,
    reference       TEXT,
    paid_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX payments_sale_id_idx ON payments (sale_id);

-- ---------------------------------------------------------------------------
-- Devices + custom outbox support (server-side)
-- ---------------------------------------------------------------------------

CREATE TABLE devices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     UUID NOT NULL REFERENCES businesses (id),
    outlet_id       UUID REFERENCES outlets (id),
    device_key      TEXT NOT NULL,
    label           TEXT,
    last_seen_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at      TIMESTAMPTZ,
    CONSTRAINT devices_device_key_unique UNIQUE (device_key)
);

CREATE INDEX devices_business_id_idx ON devices (business_id);

ALTER TABLE sessions
    ADD CONSTRAINT sessions_device_id_fkey
    FOREIGN KEY (device_id) REFERENCES devices (id);

CREATE TABLE command_receipts (
    command_id      UUID PRIMARY KEY,
    business_id     UUID NOT NULL REFERENCES businesses (id),
    device_id       UUID REFERENCES devices (id),
    user_id         UUID REFERENCES users (id),
    staff_id        UUID REFERENCES staff (id),
    command_type    TEXT NOT NULL,
    command_version INT NOT NULL DEFAULT 1,
    request_hash    TEXT,
    status          TEXT NOT NULL
                    CHECK (status IN ('applied', 'rejected')),
    response_body   JSONB,
    error_code      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_at      TIMESTAMPTZ
);

CREATE INDEX command_receipts_business_created_idx
    ON command_receipts (business_id, created_at);

CREATE TABLE sync_pull_cursors (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     UUID NOT NULL REFERENCES businesses (id),
    device_id       UUID NOT NULL REFERENCES devices (id),
    stream          TEXT NOT NULL,
    cursor          TEXT NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT sync_pull_cursors_device_stream_unique UNIQUE (device_id, stream)
);

-- ---------------------------------------------------------------------------
-- Schema migrations bookkeeping is handled by the API migrate runner
-- (schema_migrations table), not defined here.
-- ---------------------------------------------------------------------------
