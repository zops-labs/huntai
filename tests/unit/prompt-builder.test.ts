import { describe, it, expect } from 'vitest';
import { buildDefenderSystemPrompt } from '../../src/engines/defender/prompt-builder.js';
import { testOwner } from '../fixtures/owners.js';

describe('buildDefenderSystemPrompt', () => {
  it('includes business name', () => {
    const prompt = buildDefenderSystemPrompt(testOwner, null);
    expect(prompt).toContain('Test Pool Services');
  });

  it('includes service area', () => {
    const prompt = buildDefenderSystemPrompt(testOwner, null);
    expect(prompt).toContain('Marbella');
    expect(prompt).toContain('Estepona');
  });

  it('includes new customer instruction when no customer', () => {
    const prompt = buildDefenderSystemPrompt(testOwner, null);
    expect(prompt).toContain('new customer');
  });

  it('includes customer context when customer provided', () => {
    const customer = {
      id: '00000000-0000-0000-0000-000000000010',
      owner_id: testOwner.id,
      phone: '+34600000100',
      name: 'Sarah',
      preferred_language: 'en',
      address: null,
      area: 'La Quinta',
      pool_specs: { size_m2: 32, type: 'salt' as const },
      service_contract: { frequency: 'fortnightly', price_eur: 120, active: true },
      payment_status: 'current' as const,
      last_payment_date: null,
      last_service_date: '2026-05-01',
      next_service_date: null,
      notes: 'Has dogs',
      tags: [],
      sms_opt_out: false,
      data_source: 'live_call',
      import_batch_id: null,
      created_at: new Date().toISOString(),
      deleted_at: null,
    };
    const prompt = buildDefenderSystemPrompt(testOwner, customer);
    expect(prompt).toContain('Sarah');
    expect(prompt).toContain('La Quinta');
  });

  it('instructs JSON-only response format', () => {
    const prompt = buildDefenderSystemPrompt(testOwner, null);
    expect(prompt).toContain('Return ONLY valid JSON');
    expect(prompt).toContain('reply_text');
    expect(prompt).toContain('action');
  });
});
