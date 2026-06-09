import { supabase } from '../db/supabase.js';
import { logger } from './logger.js';

/**
 * Hard-delete all data for a customer (GDPR Art. 17 erasure).
 * Called after the 30-day soft-delete grace period, or immediately on owner request.
 */
export async function eraseCustomer(customerId: string, ownerId: string): Promise<void> {
  logger.info({ customer_id: customerId, owner_id: ownerId }, 'GDPR: erasing customer');

  // Soft-delete first (30-day grace period)
  await supabase
    .from('customers')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', customerId)
    .eq('owner_id', ownerId);

  // Hard-delete messages in conversations belonging to this customer
  const { data: convs } = await supabase
    .from('conversations')
    .select('id')
    .eq('customer_id', customerId)
    .eq('owner_id', ownerId);

  if (convs?.length) {
    const convIds = convs.map((c) => c.id);
    await supabase.from('messages').delete().in('conversation_id', convIds);
  }

  // Hard-delete conversations
  await supabase.from('conversations').delete().eq('customer_id', customerId);

  // Hard-delete quotes
  await supabase.from('quotes').delete().eq('customer_id', customerId);

  // Hard-delete jobs
  await supabase.from('jobs').delete().eq('customer_id', customerId);

  // Hard-delete the customer row
  await supabase.from('customers').delete().eq('id', customerId);

  logger.info({ customer_id: customerId }, 'GDPR: erasure complete');
}

/**
 * Hard-delete all data for an owner (account deletion, GDPR Art. 17).
 * Soft-deletes owner row first, then schedules hard purge via Inngest.
 */
export async function eraseOwner(ownerId: string): Promise<void> {
  logger.info({ owner_id: ownerId }, 'GDPR: erasing owner account');

  await supabase
    .from('owners')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', ownerId);

  // Full purge happens in a scheduled Inngest job after 30 days
}

/**
 * Generate a full data export for an owner (GDPR Art. 15).
 * Returns a JSON blob containing all owner + customer data.
 */
export async function exportOwnerData(ownerId: string): Promise<Record<string, unknown>> {
  const [{ data: owner }, { data: customers }, { data: quotes }, { data: jobs }] =
    await Promise.all([
      supabase.from('owners').select('*').eq('id', ownerId).single(),
      supabase.from('customers').select('*').eq('owner_id', ownerId).is('deleted_at', null),
      supabase.from('quotes').select('*').eq('owner_id', ownerId).is('deleted_at', null),
      supabase.from('jobs').select('*').eq('owner_id', ownerId),
    ]);

  return {
    exported_at: new Date().toISOString(),
    owner,
    customers: customers ?? [],
    quotes: quotes ?? [],
    jobs: jobs ?? [],
  };
}

/**
 * Handle an SMS STOP opt-out — immediately set sms_opt_out = true.
 */
export async function handleSmsOptOut(ownerId: string, phone: string): Promise<void> {
  logger.info({ owner_id: ownerId }, 'GDPR: SMS opt-out received');

  await supabase
    .from('customers')
    .update({ sms_opt_out: true })
    .eq('owner_id', ownerId)
    .eq('phone', phone);
}
