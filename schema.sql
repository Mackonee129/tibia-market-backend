-- ============================================================
--  TIBIA MARKET — Schema PostgreSQL
--  Ejecutar: psql $DATABASE_URL -f src/db/schema.sql
-- ============================================================

-- Extensión para UUIDs
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── USUARIOS ─────────────────────────────────────────────────
-- Un usuario es una cuenta, puede tener varios personajes
CREATE TABLE IF NOT EXISTS users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reputation    NUMERIC(3,1) NOT NULL DEFAULT 5.0,
  total_trades  INT          NOT NULL DEFAULT 0,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE
);

-- ── PERSONAJES ───────────────────────────────────────────────
-- Cada personaje verificado contra TibiaData API
CREATE TABLE IF NOT EXISTS characters (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          VARCHAR(50) NOT NULL UNIQUE,          -- nombre exacto de Tibia
  name_lower    VARCHAR(50) NOT NULL UNIQUE,          -- para búsquedas case-insensitive
  world         VARCHAR(30) NOT NULL,
  vocation      VARCHAR(30) NOT NULL,
  level         INT         NOT NULL DEFAULT 1,
  guild         VARCHAR(60),
  is_primary    BOOLEAN     NOT NULL DEFAULT FALSE,
  verified_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sync     TIMESTAMPTZ NOT NULL DEFAULT NOW(),   -- última vez que se sincronizó con TibiaData
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Solo puede haber un personaje principal por usuario
CREATE UNIQUE INDEX IF NOT EXISTS idx_characters_primary
  ON characters(user_id) WHERE is_primary = TRUE;

-- Índice para búsquedas por mundo
CREATE INDEX IF NOT EXISTS idx_characters_world ON characters(world);

-- ── SESIONES / TOKENS ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id  UUID        NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  token_hash    VARCHAR(64) NOT NULL UNIQUE,          -- hash del JWT para invalidar sesiones
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ── LISTINGS DE ITEMS ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS item_listings (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id  UUID        NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  -- datos del item
  item_name     VARCHAR(100) NOT NULL,
  item_category VARCHAR(30)  NOT NULL,    -- Espadas, Armaduras, Cascos...
  item_type     VARCHAR(30)  NOT NULL,    -- Sword 1H, Armor, etc.
  item_level    INT          NOT NULL DEFAULT 0,
  item_atk      INT,
  item_def      INT,
  item_arm      INT,
  item_tier     INT          NOT NULL DEFAULT 0,  -- 0-4
  item_vocation VARCHAR(30)  NOT NULL DEFAULT 'Todos',
  -- precio y detalles de venta
  price         BIGINT       NOT NULL,            -- en gold pieces
  negotiable    BOOLEAN      NOT NULL DEFAULT FALSE,
  server        VARCHAR(30)  NOT NULL,
  description   TEXT,
  images        TEXT[],                            -- URLs de imágenes
  -- estado
  status        VARCHAR(20)  NOT NULL DEFAULT 'active',  -- active, sold, expired, deleted
  views         INT          NOT NULL DEFAULT 0,
  expires_at    TIMESTAMPTZ  NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_item_listings_server   ON item_listings(server) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_item_listings_category ON item_listings(item_category) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_item_listings_char     ON item_listings(character_id);
CREATE INDEX IF NOT EXISTS idx_item_listings_name     ON item_listings(item_name);

-- ── LISTINGS DE TIBIA COINS ──────────────────────────────────
CREATE TABLE IF NOT EXISTS tc_listings (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id  UUID        NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  -- cantidad y precio
  amount        INT         NOT NULL CHECK (amount > 0),
  price_usd     NUMERIC(8,4) NOT NULL CHECK (price_usd > 0),  -- precio por TC en USD (base)
  currency      VARCHAR(5)  NOT NULL DEFAULT 'MXN',            -- MXN | USD | BRL
  price_local   NUMERIC(10,4) NOT NULL,                        -- precio por TC en moneda local
  min_buy       INT         NOT NULL DEFAULT 1,
  -- detalles
  server        VARCHAR(30) NOT NULL,
  negotiable    BOOLEAN     NOT NULL DEFAULT FALSE,
  notes         TEXT,
  -- estado
  status        VARCHAR(20) NOT NULL DEFAULT 'active',
  views         INT         NOT NULL DEFAULT 0,
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tc_listings_server ON tc_listings(server) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_tc_listings_price  ON tc_listings(price_usd) WHERE status = 'active';

-- ── CONVERSACIONES ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  char_a_id       UUID        NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  char_b_id       UUID        NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  -- listing al que pertenece (puede ser item o TC)
  item_listing_id UUID        REFERENCES item_listings(id) ON DELETE SET NULL,
  tc_listing_id   UUID        REFERENCES tc_listings(id)   ON DELETE SET NULL,
  -- resumen
  last_message    TEXT,
  last_message_at TIMESTAMPTZ,
  unread_a        INT         NOT NULL DEFAULT 0,   -- mensajes no leídos para char_a
  unread_b        INT         NOT NULL DEFAULT 0,   -- mensajes no leídos para char_b
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- No puede haber dos conversaciones del mismo par sobre el mismo listing
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_unique
  ON conversations(LEAST(char_a_id::text, char_b_id::text), GREATEST(char_a_id::text, char_b_id::text), COALESCE(item_listing_id::text,''), COALESCE(tc_listing_id::text,''));

CREATE INDEX IF NOT EXISTS idx_conversations_char_a ON conversations(char_a_id);
CREATE INDEX IF NOT EXISTS idx_conversations_char_b ON conversations(char_b_id);

-- ── MENSAJES ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       UUID        NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  content         TEXT        NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
  read            BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_sender       ON messages(sender_id);

-- ── RESEÑAS / RATINGS ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewer_id     UUID        NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  reviewed_id     UUID        NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  conversation_id UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  rating          INT         NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(reviewer_id, conversation_id)  -- solo una reseña por trade
);

CREATE INDEX IF NOT EXISTS idx_reviews_reviewed ON reviews(reviewed_id);

-- ── FUNCIÓN: actualizar reputación automáticamente ───────────
CREATE OR REPLACE FUNCTION update_user_reputation()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE users
  SET
    reputation    = (SELECT ROUND(AVG(rating)::numeric, 1) FROM reviews WHERE reviewed_id = NEW.reviewed_id),
    total_trades  = (SELECT COUNT(*) FROM reviews WHERE reviewed_id = NEW.reviewed_id),
    updated_at    = NOW()
  WHERE id = NEW.reviewed_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_reputation
  AFTER INSERT OR UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION update_user_reputation();

-- ── FUNCIÓN: incrementar vistas ──────────────────────────────
CREATE OR REPLACE FUNCTION increment_views(listing_id UUID, listing_type TEXT)
RETURNS VOID AS $$
BEGIN
  IF listing_type = 'item' THEN
    UPDATE item_listings SET views = views + 1 WHERE id = listing_id;
  ELSIF listing_type = 'tc' THEN
    UPDATE tc_listings SET views = views + 1 WHERE id = listing_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
--  VISTAS ÚTILES
-- ============================================================

-- Vista de listings de items con datos del personaje
CREATE OR REPLACE VIEW v_item_listings AS
SELECT
  il.*,
  c.name        AS seller_name,
  c.world       AS seller_world,
  c.vocation    AS seller_vocation,
  c.level       AS seller_level,
  u.reputation  AS seller_reputation,
  u.total_trades AS seller_trades
FROM item_listings il
JOIN characters c ON c.id = il.character_id
JOIN users u      ON u.id = c.user_id
WHERE il.status = 'active'
  AND il.expires_at > NOW();

-- Vista de listings de TCs con datos del personaje
CREATE OR REPLACE VIEW v_tc_listings AS
SELECT
  tl.*,
  c.name        AS seller_name,
  c.world       AS seller_world,
  c.vocation    AS seller_vocation,
  c.level       AS seller_level,
  u.reputation  AS seller_reputation,
  u.total_trades AS seller_trades
FROM tc_listings tl
JOIN characters c ON c.id = tl.character_id
JOIN users u      ON u.id = c.user_id
WHERE tl.status = 'active'
  AND tl.expires_at > NOW();

-- ============================================================
RAISE NOTICE 'Schema de Tibia Market creado correctamente ✓';
-- ============================================================
