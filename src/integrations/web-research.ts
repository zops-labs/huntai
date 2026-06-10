import axios from 'axios';
import { callClaudeJSON } from './anthropic.js';
import { logger } from '../lib/logger.js';

export interface WebsiteProfile {
  business_name: string | null;
  services: string[];
  service_area: string[];
  languages: string[];
  phone: string | null;
  address: string | null;
  opening_hours: string | null;
  pricing_hints: string | null;
}

const EMPTY_PROFILE: WebsiteProfile = {
  business_name: null,
  services: [],
  service_area: [],
  languages: [],
  phone: null,
  address: null,
  opening_hours: null,
  pricing_hints: null,
};

/**
 * Fetch a business website and ask Claude to extract a structured profile
 * from it. Used during onboarding to pre-fill business details so the owner
 * only has to confirm/correct, not type everything from scratch.
 *
 * Returns an empty profile (all nulls/[]) on any failure — callers should
 * treat this as "nothing extra found", not an error.
 */
export async function researchWebsite(url: string): Promise<WebsiteProfile> {
  let html: string;
  try {
    const res = await axios.get<string>(url, {
      timeout: 8000,
      maxContentLength: 2 * 1024 * 1024,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EncargadoBot/1.0)' },
      validateStatus: (s) => s < 500,
    });
    html = String(res.data);
  } catch (err) {
    logger.warn({ err, url }, 'Website fetch failed');
    return EMPTY_PROFILE;
  }

  // Strip scripts/styles/tags down to plain text, collapse whitespace, and
  // cap length so we don't blow the context window on huge pages.
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000);

  if (!text) return EMPTY_PROFILE;

  try {
    const profile = await callClaudeJSON<WebsiteProfile>({
      system:
        'Extract business profile information from raw website text for a small ' +
        'home-services business (pool maintenance, construction, cleaning, etc). ' +
        'Respond with ONLY a JSON object matching this shape, using null/[] for ' +
        'anything not clearly stated — never guess or invent details:\n' +
        '{"business_name": string|null, "services": string[], "service_area": string[], ' +
        '"languages": string[] (ISO codes like "es","en"), "phone": string|null, ' +
        '"address": string|null, "opening_hours": string|null, "pricing_hints": string|null}',
      messages: [{ role: 'user', content: text }],
      maxTokens: 512,
    });
    return { ...EMPTY_PROFILE, ...profile };
  } catch (err) {
    logger.warn({ err, url }, 'Website profile extraction failed');
    return EMPTY_PROFILE;
  }
}
