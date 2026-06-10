import { findPlaceProfile, extractMapsLink, extractWebsiteUrl } from '../integrations/places.js';
import { researchWebsite } from '../integrations/web-research.js';
import { callClaudeJSON } from '../integrations/anthropic.js';
import { logger } from '../lib/logger.js';

export interface BusinessProfileDraft {
  business_name: string | null;
  owner_name: string | null;
  service_area: string[];
  languages: string[];
  business_address: string | null;
  website: string | null;
  working_hours: string | null;
  phone: string | null;
}

export function emptyDraft(ownerNameGuess: string | null = null): BusinessProfileDraft {
  return {
    business_name: null,
    owner_name: ownerNameGuess,
    service_area: [],
    languages: ['es'],
    business_address: null,
    website: null,
    working_hours: null,
    phone: null,
  };
}

/**
 * Given the owner's first reply (business name, and/or a Google Maps /
 * website link), do a best-effort automatic lookup so we can pre-fill the
 * profile summary instead of asking 8 questions from scratch.
 *
 * Always returns a draft (possibly mostly empty) — never throws. Any field
 * we couldn't find is left null/[] so the confirmation step can ask about it.
 */
export async function researchBusiness(
  text: string,
  ownerNameGuess: string | null = null
): Promise<BusinessProfileDraft> {
  const draft = emptyDraft(ownerNameGuess);

  const mapsLink = extractMapsLink(text);
  const websiteUrl = extractWebsiteUrl(text);

  // Strip any URLs out of the text to get a cleaner "business name" guess.
  const nameGuess = text.replace(/https?:\/\/\S+/gi, '').trim();

  try {
    const place = await findPlaceProfile(mapsLink ?? nameGuess);
    if (place) {
      draft.business_name = place.name;
      draft.business_address = place.formatted_address;
      draft.phone = place.phone;
      draft.website = place.website;
      if (place.opening_hours?.length) {
        draft.working_hours = place.opening_hours.join('; ');
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Places lookup during onboarding research failed');
  }

  // Prefer an explicit link the owner pasted; otherwise fall back to
  // whatever website Places found.
  const siteToScrape = websiteUrl ?? draft.website;
  if (siteToScrape) {
    try {
      const site = await researchWebsite(siteToScrape);
      draft.business_name ??= site.business_name;
      draft.website ??= siteToScrape;
      if (site.service_area.length) draft.service_area = site.service_area;
      if (site.languages.length) draft.languages = site.languages;
      draft.business_address ??= site.address;
      draft.working_hours ??= site.opening_hours;
      draft.phone ??= site.phone;
    } catch (err) {
      logger.warn({ err, siteToScrape }, 'Website research during onboarding failed');
    }
  }

  // Nothing found at all — fall back to using whatever text the owner sent
  // as the business name, so we always have something to show/confirm.
  if (!draft.business_name && nameGuess) {
    draft.business_name = nameGuess;
  }

  return draft;
}

const FIELD_LABELS: Record<keyof BusinessProfileDraft, string> = {
  business_name: '🏢 Empresa',
  owner_name: '🙋 Tu nombre',
  service_area: '📍 Zona de trabajo',
  languages: '🗣️ Idiomas',
  business_address: '📌 Dirección',
  website: '🌐 Web',
  working_hours: '🕒 Horario',
  phone: '📞 Teléfono',
};

function formatValue(value: BusinessProfileDraft[keyof BusinessProfileDraft]): string {
  if (value === null) return '_(no lo encontré — dime cuál es)_';
  if (Array.isArray(value)) {
    return value.length ? value.join(', ') : '_(no lo encontré — dime cuál es)_';
  }
  return value;
}

/**
 * Render the draft profile as a WhatsApp message asking the owner to
 * confirm or correct it.
 */
export function formatProfileSummary(draft: BusinessProfileDraft, isFirstPass: boolean): string {
  const lines = (Object.keys(FIELD_LABELS) as Array<keyof BusinessProfileDraft>).map(
    (key) => `${FIELD_LABELS[key]}: ${formatValue(draft[key])}`
  );

  const intro = isFirstPass
    ? '🔎 Esto es lo que he encontrado sobre tu negocio:'
    : '👍 Vale, así queda ahora:';

  return (
    `${intro}\n\n${lines.join('\n')}\n\n` +
    'Si todo es correcto, responde *sí*. Si algo está mal o falta, dímelo ' +
    '(por ejemplo: "el horario es 9 a 17h" o "trabajamos también en Fuengirola").'
  );
}

interface EditResult {
  draft: BusinessProfileDraft;
  confirmed: boolean;
}

/**
 * Interpret the owner's reply to the profile summary: either a plain
 * confirmation ("sí", "correcto", "vale") or free-text corrections/additions.
 * Returns the (possibly updated) draft and whether the owner confirmed it.
 */
export async function applyProfileEdits(
  draft: BusinessProfileDraft,
  userText: string
): Promise<EditResult> {
  const trimmed = userText.trim().toLowerCase();
  const simpleYes = /^(s[ií]|si\.?|correcto|vale|perfecto|ok|👍|exacto|todo bien|todo correcto)\.?!?$/i;
  if (simpleYes.test(trimmed)) {
    return { draft, confirmed: true };
  }

  try {
    const result = await callClaudeJSON<{ draft: BusinessProfileDraft; confirmed: boolean }>({
      system:
        'You maintain a draft business profile (JSON) for a small home-services ' +
        'business owner during onboarding via WhatsApp. The user just sent a message ' +
        'in response to a summary of their profile. Apply any corrections or additions ' +
        'they mention to the draft (keep all other fields unchanged). Set "confirmed" ' +
        'to true only if the message is purely an approval with no new info or changes ' +
        '(e.g. "sí, todo bien"); set it to false if they gave any corrections/additions ' +
        '(even if they also said the rest looks fine) — they will be shown the updated ' +
        'summary and asked to confirm again. Languages must be ISO codes ("es","en"). ' +
        'Respond with ONLY JSON: {"draft": <updated draft object, same shape as input>, "confirmed": boolean}',
      messages: [
        {
          role: 'user',
          content: `Current draft:\n${JSON.stringify(draft)}\n\nUser message: "${userText}"`,
        },
      ],
      maxTokens: 512,
    });
    return result;
  } catch (err) {
    logger.warn({ err }, 'applyProfileEdits: Claude call failed, treating as unconfirmed');
    return { draft, confirmed: false };
  }
}
