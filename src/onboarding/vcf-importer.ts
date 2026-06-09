/**
 * VCF (vCard) importer — pure Node.js, no LLM needed.
 * Parses Google Contacts / iPhone exports and extracts names + phones.
 */

export interface VCardContact {
  name: string | null;
  phone: string | null;
  note: string | null;
}

/**
 * Parse a VCF file string into an array of contacts.
 */
export function parseVCF(vcfText: string): VCardContact[] {
  const contacts: VCardContact[] = [];
  const cards = vcfText.split(/BEGIN:VCARD/i).filter((c) => c.includes('END:VCARD'));

  for (const card of cards) {
    const lines = card.split('\n').map((l) => l.trim()).filter(Boolean);

    let name: string | null = null;
    let phone: string | null = null;
    let note: string | null = null;

    for (const line of lines) {
      if (line.startsWith('FN:') || line.startsWith('FN;')) {
        name = line.replace(/^FN[;:].*?:/, '').trim() || null;
      } else if (line.startsWith('N:') && !name) {
        // N: LastName;FirstName;MiddleName;Prefix;Suffix
        const parts = line.replace(/^N[;:]/, '').split(';');
        const lastName = parts[0]?.trim();
        const firstName = parts[1]?.trim();
        name = [firstName, lastName].filter(Boolean).join(' ') || null;
      } else if (line.match(/^TEL/i)) {
        const rawPhone = line.replace(/^TEL[^:]*:/i, '').trim();
        if (!phone && rawPhone) {
          phone = normalisePhone(rawPhone);
        }
      } else if (line.startsWith('NOTE:')) {
        note = line.replace(/^NOTE:/, '').trim() || null;
      }
    }

    if (name || phone) {
      contacts.push({ name, phone, note });
    }
  }

  return contacts;
}

function normalisePhone(raw: string): string {
  const stripped = raw.replace(/[^\d+]/g, '');
  if (stripped.startsWith('6') || stripped.startsWith('9')) {
    return `+34${stripped}`;
  }
  return stripped || null!;
}
