-- Development seed data — NO real PII
-- Use this to bootstrap a local dev environment

INSERT INTO owners (
  id, business_name, owner_name, owner_whatsapp, business_phone,
  service_area, ai_persona_name, onboarding_completed_at
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Test Pool Services',
  'Miguel',
  '+34600000001',
  '+34900000001',
  '{"Marbella","Estepona"}',
  'asistente',
  now()
) ON CONFLICT DO NOTHING;

INSERT INTO customers (
  id, owner_id, phone, name, area, preferred_language,
  pool_specs, service_contract, payment_status, last_service_date
) VALUES (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000001',
  '+34600000100',
  'Test Customer',
  'La Quinta',
  'es',
  '{"size_m2": 32, "type": "salt", "brand": "Hayward", "filter": "sand"}',
  '{"frequency": "fortnightly", "price_eur": 120, "active": true}',
  'current',
  CURRENT_DATE - INTERVAL '15 days'
) ON CONFLICT DO NOTHING;
