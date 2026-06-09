-- ─── Enable extensions ──────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── owners ─────────────────────────────────────────────────────────────────
CREATE TABLE owners (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name               text NOT NULL,
  owner_name                  text NOT NULL,
  owner_whatsapp              text NOT NULL UNIQUE,
  business_phone              text NOT NULL UNIQUE,
  twilio_number_sid           text NOT NULL DEFAULT '',
  retell_agent_id             text NOT NULL DEFAULT '',
  service_area                text[] NOT NULL DEFAULT '{}',
  languages                   text[] NOT NULL DEFAULT '{es,en}',
  ai_persona_name             text NOT NULL DEFAULT 'asistente',
  pricing_notes               text,
  booking_rules               jsonb NOT NULL DEFAULT '{}',
  emergency_phone             text,
  google_calendar_id          text,
  google_tokens_enc           text,
  whatsapp_360_channel_id     text,
  briefing_time               time NOT NULL DEFAULT '07:00',
  transcript_retention_months int NOT NULL DEFAULT 24,
  onboarding_completed_at     timestamptz,
  subscription_tier           text NOT NULL DEFAULT 'growth',
  stripe_customer_id          text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  deleted_at                  timestamptz
);

ALTER TABLE owners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_self_access" ON owners FOR ALL USING (id = auth.uid());

-- ─── customers ──────────────────────────────────────────────────────────────
CREATE TABLE customers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id           uuid NOT NULL REFERENCES owners(id),
  phone              text NOT NULL,
  name               text,
  preferred_language text NOT NULL DEFAULT 'es',
  address            text,
  area               text,
  pool_specs         jsonb,
  service_contract   jsonb,
  payment_status     text NOT NULL DEFAULT 'unknown',
  last_payment_date  date,
  last_service_date  date,
  next_service_date  date,
  notes              text,
  tags               text[] NOT NULL DEFAULT '{}',
  sms_opt_out        boolean NOT NULL DEFAULT false,
  data_source        text NOT NULL DEFAULT 'live_call',
  import_batch_id    uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  UNIQUE(owner_id, phone)
);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_isolation" ON customers FOR ALL USING (owner_id = auth.uid());

-- ─── quotes ──────────────────────────────────────────────────────────────────
CREATE TABLE quotes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          uuid NOT NULL REFERENCES owners(id),
  customer_id       uuid NOT NULL REFERENCES customers(id),
  description       text NOT NULL,
  amount_eur        numeric(10,2),
  status            text NOT NULL DEFAULT 'open',
  follow_up_stage   int NOT NULL DEFAULT 0,
  next_follow_up_at timestamptz,
  sent_at           timestamptz,
  responded_at      timestamptz,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);

ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_isolation" ON quotes FOR ALL USING (owner_id = auth.uid());

-- ─── jobs ────────────────────────────────────────────────────────────────────
CREATE TABLE jobs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id             uuid NOT NULL REFERENCES owners(id),
  customer_id          uuid NOT NULL REFERENCES customers(id),
  quote_id             uuid REFERENCES quotes(id),
  job_type             text NOT NULL,
  status               text NOT NULL DEFAULT 'scheduled',
  scheduled_at         timestamptz NOT NULL,
  completed_at         timestamptz,
  duration_minutes     int,
  google_event_id      text,
  amount_eur           numeric(10,2),
  payment_status       text NOT NULL DEFAULT 'pending',
  review_requested_at  timestamptz,
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_isolation" ON jobs FOR ALL USING (owner_id = auth.uid());

-- ─── conversations ───────────────────────────────────────────────────────────
CREATE TABLE conversations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       uuid NOT NULL REFERENCES owners(id),
  customer_id    uuid REFERENCES customers(id),
  channel        text NOT NULL,
  direction      text NOT NULL,
  engine         text,
  status         text NOT NULL DEFAULT 'active',
  retell_call_id text,
  summary        text,
  outcome        text,
  started_at     timestamptz NOT NULL DEFAULT now(),
  ended_at       timestamptz,
  deleted_at     timestamptz
);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_isolation" ON conversations FOR ALL USING (owner_id = auth.uid());

-- ─── messages ────────────────────────────────────────────────────────────────
CREATE TABLE messages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   uuid NOT NULL REFERENCES conversations(id),
  owner_id          uuid NOT NULL REFERENCES owners(id),
  role              text NOT NULL,
  content           text NOT NULL,
  language_detected text,
  sentiment         text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_isolation" ON messages FOR ALL USING (owner_id = auth.uid());

-- ─── onboarding_imports ──────────────────────────────────────────────────────
CREATE TABLE onboarding_imports (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id           uuid NOT NULL REFERENCES owners(id),
  import_type        text NOT NULL,
  storage_path       text,
  status             text NOT NULL DEFAULT 'pending',
  customers_created  int NOT NULL DEFAULT 0,
  customers_updated  int NOT NULL DEFAULT 0,
  parse_errors       jsonb,
  file_deleted_at    timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE onboarding_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_isolation" ON onboarding_imports FOR ALL USING (owner_id = auth.uid());

-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX idx_customers_phone_owner ON customers(owner_id, phone)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_quotes_follow_up ON quotes(next_follow_up_at)
  WHERE status = 'open' AND deleted_at IS NULL;

CREATE INDEX idx_jobs_scheduled ON jobs(owner_id, scheduled_at)
  WHERE status = 'scheduled';

CREATE INDEX idx_conversations_active ON conversations(customer_id, status)
  WHERE status = 'active';

CREATE INDEX idx_messages_created ON messages(owner_id, created_at);

CREATE INDEX idx_imports_cleanup ON onboarding_imports(created_at)
  WHERE file_deleted_at IS NULL;
