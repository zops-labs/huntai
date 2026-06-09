import { callClaudeJSON } from '../integrations/anthropic.js';

export interface CSVColumnMapping {
  name?: number;
  phone?: number;
  address?: number;
  area?: number;
  service_frequency?: number;
  monthly_price?: number;
  last_service?: number;
  payment_status?: number;
  notes?: number;
}

export interface CSVCustomerRow {
  name?: string;
  phone?: string;
  address?: string;
  area?: string;
  service_frequency?: string;
  monthly_price?: string;
  last_service?: string;
  payment_status?: string;
  notes?: string;
}

/**
 * Detect CSV column mapping by sending headers + sample rows to Claude.
 * Only the first 5 rows are sent — never the full CSV (privacy + cost).
 */
export async function detectColumnMapping(
  headers: string[],
  sampleRows: string[][]
): Promise<CSVColumnMapping> {
  return callClaudeJSON<CSVColumnMapping>({
    system: `Given these CSV headers and sample rows from a pool maintenance
business customer list, return a JSON mapping of column indices to data fields.

Return JSON: { "name": 0, "phone": 1, "area": 3, ... }
Only include fields you are confident about.
Fields: name, phone, address, area, service_frequency, monthly_price, last_service, payment_status, notes

Return ONLY the JSON. No prose.`,
    messages: [
      {
        role: 'user',
        content: `Headers: ${JSON.stringify(headers)}\nSample rows: ${JSON.stringify(sampleRows.slice(0, 5))}`,
      },
    ],
    maxTokens: 256,
  });
}

/**
 * Parse all rows of a CSV using a detected column mapping.
 * No LLM used here — pure in-process transformation.
 */
export function parseCSVRows(
  rows: string[][],
  mapping: CSVColumnMapping
): CSVCustomerRow[] {
  return rows
    .filter((row) => row.some((cell) => cell.trim()))
    .map((row) => {
      const customer: CSVCustomerRow = {};
      if (mapping.name !== undefined) customer.name = row[mapping.name]?.trim();
      if (mapping.phone !== undefined)
        customer.phone = normalisePhone(row[mapping.phone]?.trim() ?? '');
      if (mapping.address !== undefined) customer.address = row[mapping.address]?.trim();
      if (mapping.area !== undefined) customer.area = row[mapping.area]?.trim();
      if (mapping.service_frequency !== undefined)
        customer.service_frequency = row[mapping.service_frequency]?.trim();
      if (mapping.monthly_price !== undefined)
        customer.monthly_price = row[mapping.monthly_price]?.trim();
      if (mapping.last_service !== undefined)
        customer.last_service = row[mapping.last_service]?.trim();
      if (mapping.payment_status !== undefined)
        customer.payment_status = row[mapping.payment_status]?.trim();
      if (mapping.notes !== undefined) customer.notes = row[mapping.notes]?.trim();
      return customer;
    })
    .filter((c) => c.name || c.phone);
}

function normalisePhone(raw: string): string {
  if (!raw) return '';
  // Strip non-digits except leading +
  const stripped = raw.replace(/[^\d+]/g, '');
  // Add +34 prefix for Spanish numbers if no country code
  if (stripped.startsWith('6') || stripped.startsWith('9')) {
    return `+34${stripped}`;
  }
  return stripped;
}

/**
 * Parse a raw CSV string into headers + rows.
 */
export function parseCSVText(csvText: string): {
  headers: string[];
  rows: string[][];
} {
  const lines = csvText.split('\n').filter((l) => l.trim());
  if (!lines.length) return { headers: [], rows: [] };

  const headers = splitCSVLine(lines[0]);
  const rows = lines.slice(1).map(splitCSVLine);
  return { headers, rows };
}

function splitCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}
