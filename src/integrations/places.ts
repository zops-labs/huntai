import axios from 'axios';
import { logger } from '../lib/logger.js';

const PLACES_BASE = 'https://maps.googleapis.com/maps/api/place';

export interface PlaceProfile {
  name: string;
  formatted_address: string | null;
  phone: string | null;
  website: string | null;
  opening_hours: string[] | null; // e.g. ["Monday: 8:00 AM – 6:00 PM", ...]
  maps_url: string | null;
  types: string[] | null;
}

/**
 * Look up a business on Google Places by free-text query (business name,
 * optionally with city/area, or a Google Maps link/text the owner pasted).
 *
 * Returns null if GOOGLE_PLACES_API_KEY isn't configured, or no confident
 * match is found — callers should treat this as "no auto-fill available"
 * rather than an error.
 */
export async function findPlaceProfile(query: string): Promise<PlaceProfile | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    logger.warn('GOOGLE_PLACES_API_KEY not set — skipping business lookup');
    return null;
  }

  if (!query.trim()) return null;

  try {
    const findRes = await axios.get(`${PLACES_BASE}/findplacefromtext/json`, {
      params: {
        input: query,
        inputtype: 'textquery',
        fields: 'place_id,name,formatted_address',
        key: apiKey,
      },
      timeout: 8000,
    });

    const candidate = findRes.data?.candidates?.[0];
    if (!candidate?.place_id) {
      logger.debug({ query }, 'Places: no candidate found');
      return null;
    }

    const detailsRes = await axios.get(`${PLACES_BASE}/details/json`, {
      params: {
        place_id: candidate.place_id,
        fields:
          'name,formatted_address,formatted_phone_number,international_phone_number,website,opening_hours,types,url',
        key: apiKey,
      },
      timeout: 8000,
    });

    const result = detailsRes.data?.result;
    if (!result?.name) return null;

    return {
      name: result.name,
      formatted_address: result.formatted_address ?? null,
      phone: result.international_phone_number ?? result.formatted_phone_number ?? null,
      website: result.website ?? null,
      opening_hours: result.opening_hours?.weekday_text ?? null,
      maps_url: result.url ?? null,
      types: result.types ?? null,
    };
  } catch (err) {
    logger.error({ err, query }, 'Google Places lookup failed');
    return null;
  }
}

/**
 * Pull out a Google Maps share link from free text, if present.
 * The full URL (including any place name encoded in the path) is returned
 * as-is so it can be used as a search query — Places' "find place from text"
 * endpoint handles long messy strings reasonably well.
 */
export function extractMapsLink(text: string): string | null {
  const match = text.match(
    /https?:\/\/(?:www\.)?(?:maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google\.[a-z.]+|google\.[a-z.]+\/maps)\/\S+/i
  );
  return match ? match[0] : null;
}

/**
 * Pull out a generic website URL (not a maps/social link) from free text.
 */
export function extractWebsiteUrl(text: string): string | null {
  const urls = text.match(/https?:\/\/\S+/gi) ?? [];
  return (
    urls.find(
      (u) =>
        !/maps\.|wa\.me|whatsapp|instagram\.com|facebook\.com|wa\.link/i.test(u)
    ) ?? null
  );
}
