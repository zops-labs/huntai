import { supabase } from '../supabase.js';
import type { Quote } from '../../orchestrator/types.js';

export async function getQuote(id: string): Promise<Quote | null> {
  const { data } = await supabase
    .from('quotes')
    .select('*')
    .eq('id', id)
    .single();
  return data ?? null;
}

export async function getOpenQuotes(customerId: string): Promise<Quote[]> {
  const { data } = await supabase
    .from('quotes')
    .select('*')
    .eq('customer_id', customerId)
    .eq('status', 'open')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  return data ?? [];
}

export async function createQuote(
  quote: Omit<Quote, 'id' | 'created_at'>
): Promise<Quote> {
  const { data, error } = await supabase
    .from('quotes')
    .insert(quote)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateQuote(id: string, updates: Partial<Quote>): Promise<void> {
  await supabase.from('quotes').update(updates).eq('id', id);
}

export async function getOpenQuotesSummary(
  ownerId: string
): Promise<{ total: number; due_today: number }> {
  const now = new Date().toISOString();
  const [{ count: total }, { count: due_today }] = await Promise.all([
    supabase
      .from('quotes')
      .select('*', { count: 'exact', head: true })
      .eq('owner_id', ownerId)
      .eq('status', 'open')
      .is('deleted_at', null),
    supabase
      .from('quotes')
      .select('*', { count: 'exact', head: true })
      .eq('owner_id', ownerId)
      .eq('status', 'open')
      .is('deleted_at', null)
      .lte('next_follow_up_at', now),
  ]);
  return { total: total ?? 0, due_today: due_today ?? 0 };
}

/** Mark a quote as responded to (stop further follow-ups). */
export async function markQuoteResponded(quoteId: string): Promise<void> {
  await supabase
    .from('quotes')
    .update({ responded_at: new Date().toISOString() })
    .eq('id', quoteId);
}
