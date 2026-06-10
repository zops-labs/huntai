-- ─── Onboarding profile-research fields ────────────────────────────────────
-- Added to support automatic business-profile lookups (Google Places /
-- website) during onboarding, so owners can confirm/edit pre-filled info
-- instead of answering everything from scratch.

ALTER TABLE owners
  ADD COLUMN IF NOT EXISTS website          text,
  ADD COLUMN IF NOT EXISTS business_address text,
  ADD COLUMN IF NOT EXISTS working_hours    text;
