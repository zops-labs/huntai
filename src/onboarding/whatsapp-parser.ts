import { callClaudeJSON } from '../integrations/anthropic.js';

export interface ParsedCustomer {
  name: string;
  phone?: string;
  area?: string;
  pool_specs?: {
    size_m2?: number;
    type?: 'salt' | 'chlorine' | 'unknown';
    brand?: string;
    filter?: string;
  };
  service_contract?: {
    frequency?: string;
    price_eur?: number;
    active?: boolean;
  };
  payment_status?: string;
  last_service_date?: string;
  notes?: string;
  raw_chat_excerpt?: string;
  confidence: number;
}

/**
 * Parse a WhatsApp chat export text file and extract structured customer data.
 * Uses Claude for extraction. Sends only the first 8,000 chars (privacy + cost).
 */
export async function parseWhatsAppExport(
  chatText: string,
  ownerName: string
): Promise<ParsedCustomer> {
  // Truncate to 8000 chars — most relevant info is in early messages
  const truncated = chatText.slice(0, 8000);

  const result = await callClaudeJSON<ParsedCustomer>({
    system: `You are a data extraction assistant. Extract structured customer data
from a WhatsApp chat export between a pool maintenance business owner named
"${ownerName}" and one of their customers.

Return ONLY a JSON object. No prose. No markdown. No code fences.

Extract:
- name: customer's full name or display name
- area: neighbourhood/town if mentioned (e.g. "La Quinta", "Marbella")
- pool_specs: object with size_m2 (number), type (salt/chlorine/unknown),
  brand (pump/equipment brand if mentioned), filter (sand/cartridge/unknown)
- service_contract: object with frequency (weekly/fortnightly/monthly/unknown),
  price_eur (number or null), active (boolean)
- payment_status: "current" if payment confirmed recently, "unknown" otherwise
- last_service_date: ISO date string if a service date is clearly mentioned
- notes: any important notes (pets, access issues, language preference, etc.)
- confidence: number 0–1 reflecting how confident you are in the extracted data

If a field cannot be determined, omit it entirely. Do not guess.`,
    messages: [
      {
        role: 'user',
        content: `Extract customer data from this WhatsApp chat:\n\n${truncated}`,
      },
    ],
    maxTokens: 1024,
  });

  // Include raw excerpt for audit trail
  result.raw_chat_excerpt = truncated.slice(0, 500);

  return result;
}

/**
 * Detect Android vs iPhone WhatsApp export format.
 * Android: "01/03/2024, 10:23 - Name: message"
 * iPhone:  "[01/03/2024, 10:23:15] Name: message"
 */
export function detectExportFormat(text: string): 'android' | 'iphone' | 'unknown' {
  if (/^\[\d{2}\/\d{2}\/\d{4}/.test(text)) return 'iphone';
  if (/^\d{2}\/\d{2}\/\d{4},/.test(text)) return 'android';
  return 'unknown';
}
