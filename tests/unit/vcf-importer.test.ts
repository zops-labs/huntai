import { describe, it, expect } from 'vitest';
import { parseVCF } from '../../src/onboarding/vcf-importer.js';

const SAMPLE_VCF = `
BEGIN:VCARD
VERSION:3.0
FN:Sarah Thompson
N:Thompson;Sarah;;;
TEL;TYPE=CELL:+34600000123
NOTE:Has dogs
END:VCARD
BEGIN:VCARD
VERSION:3.0
FN:Carlos Ruiz
TEL;TYPE=CELL:+34611222333
END:VCARD
BEGIN:VCARD
VERSION:3.0
FN:No Phone
END:VCARD
`.trim();

describe('parseVCF', () => {
  it('parses contacts with full name', () => {
    const contacts = parseVCF(SAMPLE_VCF);
    expect(contacts[0].name).toBe('Sarah Thompson');
    expect(contacts[0].phone).toBe('+34600000123');
    expect(contacts[0].note).toBe('Has dogs');
  });

  it('parses contact without note', () => {
    const contacts = parseVCF(SAMPLE_VCF);
    expect(contacts[1].name).toBe('Carlos Ruiz');
    expect(contacts[1].note).toBeNull();
  });

  it('includes contact with no phone (name only)', () => {
    const contacts = parseVCF(SAMPLE_VCF);
    const noPhone = contacts.find((c) => c.name === 'No Phone');
    expect(noPhone).toBeDefined();
  });
});
