-- Upgrade preserves existing accounts, payments and physical-order history.
ALTER TABLE products RENAME TO events;
ALTER TABLE variants RENAME TO lots;
ALTER TABLE lots RENAME COLUMN product_id TO event_id;
ALTER TABLE lots RENAME COLUMN size TO lot_name;
ALTER TABLE lots RENAME COLUMN color TO ticket_type;
ALTER TABLE images RENAME COLUMN product_id TO event_id;
ALTER TABLE order_items RENAME COLUMN variant_id TO lot_id;
ALTER TABLE order_items RENAME COLUMN size TO lot_name;
ALTER TABLE order_items RENAME COLUMN color TO ticket_type;
ALTER TABLE reservations RENAME COLUMN variant_id TO lot_id;
ALTER TABLE inventory_movements RENAME COLUMN variant_id TO lot_id;
ALTER TABLE events ADD COLUMN starts_at timestamptz;
ALTER TABLE events ADD COLUMN ends_at timestamptz;
ALTER TABLE events ADD COLUMN venue text NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN city text NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN address text NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN organizer text NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN rules text NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','published','cancelled'));
ALTER TABLE events ADD COLUMN checkin_opens_at timestamptz;
ALTER TABLE events ADD CONSTRAINT event_dates CHECK(ends_at IS NULL OR starts_at<ends_at);
ALTER TABLE lots ADD COLUMN sales_start timestamptz;
ALTER TABLE lots ADD COLUMN sales_end timestamptz;
ALTER TABLE lots ADD COLUMN max_per_order int NOT NULL DEFAULT 10 CHECK(max_per_order BETWEEN 1 AND 20);
ALTER TABLE lots ADD CONSTRAINT sales_dates CHECK(sales_start IS NULL OR sales_end IS NULL OR sales_start<sales_end);
-- Clothes are never silently published as events. Admin may archive/reconfigure them.
UPDATE events SET active=false,status='draft';
ALTER TABLE orders ADD COLUMN order_kind text NOT NULL DEFAULT 'legacy_physical' CHECK(order_kind IN('legacy_physical','tickets'));
ALTER TABLE order_items ADD COLUMN event_snapshot jsonb;
ALTER TABLE order_items ADD COLUMN attendees jsonb NOT NULL DEFAULT '[]';
CREATE TABLE tickets(
 id uuid PRIMARY KEY,
 order_id uuid NOT NULL REFERENCES orders(id),
 order_item_id uuid NOT NULL REFERENCES order_items(id),
 event_id uuid NOT NULL REFERENCES events(id),
 lot_id uuid NOT NULL REFERENCES lots(id),
 ordinal int NOT NULL CHECK(ordinal>0),
 code text NOT NULL UNIQUE,
 attendee_name text NOT NULL,
 status text NOT NULL DEFAULT 'valid' CHECK(status IN('valid','used','revoked')),
 issued_at timestamptz NOT NULL DEFAULT now(),
 used_at timestamptz,
 checked_by uuid REFERENCES users(id),
 UNIQUE(order_item_id,ordinal)
);
CREATE INDEX tickets_event ON tickets(event_id,status);
CREATE INDEX tickets_order ON tickets(order_id);
UPDATE settings SET data=(data - 'pickup_enabled' - 'pickup_address' - 'shipping_ranges') ||
 jsonb_build_object('name',CASE WHEN data->>'name'='Minha Loja' THEN 'Seu Ingresso' ELSE data->>'name' END,
 'tagline','Seu próximo momento começa aqui.',
 'accent','#b7f45b',
 'policies','Plataforma em configuração. Eventos, datas e preços demonstrativos. Confira as regras e os dados reais com o organizador antes de vender.') WHERE id=1;
ALTER TABLE events ADD COLUMN capacity int CHECK(capacity>0);
