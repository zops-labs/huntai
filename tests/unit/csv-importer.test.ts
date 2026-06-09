import { describe, it, expect } from 'vitest';
import { parseCSVText, parseCSVRows } from '../../src/onboarding/csv-importer.js';

const SAMPLE_CSV = `
Nombre,Teléfono,Zona,Frecuencia,Precio
Sarah Thompson,+34600000123,La Quinta,quincenal,120
Carlos Ruiz,600111222,Marbella,mensual,80
`.trim();

describe('parseCSVText', () => {
  it('extracts headers', () => {
    const { headers } = parseCSVText(SAMPLE_CSV);
    expect(headers).toEqual(['Nombre', 'Teléfono', 'Zona', 'Frecuencia', 'Precio']);
  });

  it('extracts rows', () => {
    const { rows } = parseCSVText(SAMPLE_CSV);
    expect(rows).toHaveLength(2);
    expect(rows[0][0]).toBe('Sarah Thompson');
  });
});

describe('parseCSVRows', () => {
  it('maps columns to fields', () => {
    const { rows } = parseCSVText(SAMPLE_CSV);
    const mapping = { name: 0, phone: 1, area: 2, service_frequency: 3, monthly_price: 4 };
    const customers = parseCSVRows(rows, mapping);
    expect(customers[0].name).toBe('Sarah Thompson');
    expect(customers[0].area).toBe('La Quinta');
    expect(customers[0].service_frequency).toBe('quincenal');
  });

  it('normalises Spanish mobile numbers', () => {
    const { rows } = parseCSVText(SAMPLE_CSV);
    const mapping = { name: 0, phone: 1 };
    const customers = parseCSVRows(rows, mapping);
    // Carlos has number without +34 prefix
    expect(customers[1].phone).toBe('+34600111222');
  });

  it('filters empty rows', () => {
    const csv = 'name,phone\n,\nJohn,+34600000001';
    const { rows } = parseCSVText(csv);
    const customers = parseCSVRows(rows, { name: 0, phone: 1 });
    expect(customers).toHaveLength(1);
  });
});
