import { supabase } from '../supabase.js';
import type { Customer } from '../../orchestrator/types.js';

export async function getCustomerByPhone(
  ownerId: string,
  phone: string
): Promise<Customer | null> {
  const { data } = await supabase
    .from('customers')
    .select('*')
    .eq('owner_id', ownerId)
    .eq('phone', phone)
    .is('deleted_at', null)
    .single();
  return data ?? null;
}

export async function getCustomer(id: string): Promise<Customer | null> {
  const { data } = await supabase
    .from('customers')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .single();
  return data ?? null;
}

export async function getCustomerByName(
  ownerId: string,
  name: string
): Promise<Customer | null> {
  const { data } = await supabase
    .from('customers')
    .select('*')
    .eq('owner_id', ownerId)
    .ilike('name', `%${name}%`)
    .is('deleted_at', null)
    .limit(1)
    .single();
  return data ?? null;
}

export async function createCustomer(
  customer: Omit<Customer, 'id' | 'created_at'>
): Promise<Customer> {
  const { data, error } = await supabase
    .from('customers')
    .insert(customer)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateCustomer(
  id: string,
  updates: Partial<Customer>
): Promise<void> {
  await supabase.from('customers').update(updates).eq('id', id);
}

export async function getCustomersForSeasonalCampaign(
  ownerId: string
): Promise<Customer[]> {
  // Only customers served in the last 18 months, not opted out
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 18);

  const { data } = await supabase
    .from('customers')
    .select('*')
    .eq('owner_id', ownerId)
    .eq('sms_opt_out', false)
    .is('deleted_at', null)
    .gte('last_service_date', cutoff.toISOString().split('T')[0]);

  return data ?? [];
}

export async function getCustomersDueForAnnualReminder(
  ownerId: string
): Promise<Customer[]> {
  const elevenMonthsAgo = new Date();
  elevenMonthsAgo.setMonth(elevenMonthsAgo.getMonth() - 11);
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

  const { data } = await supabase
    .from('customers')
    .select('*')
    .eq('owner_id', ownerId)
    .eq('sms_opt_out', false)
    .is('deleted_at', null)
    .lte('last_service_date', elevenMonthsAgo.toISOString().split('T')[0])
    .gte('last_service_date', twelveMonthsAgo.toISOString().split('T')[0]);

  return data ?? [];
}
