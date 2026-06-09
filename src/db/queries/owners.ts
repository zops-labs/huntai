import { supabase } from '../supabase.js';
import type { Owner } from '../../orchestrator/types.js';

export async function getOwnerByBusinessPhone(phone: string): Promise<Owner | null> {
  const { data } = await supabase
    .from('owners')
    .select('*')
    .eq('business_phone', phone)
    .is('deleted_at', null)
    .single();
  return data ?? null;
}

export async function getOwnerByWhatsApp(whatsapp: string): Promise<Owner | null> {
  const { data } = await supabase
    .from('owners')
    .select('*')
    .eq('owner_whatsapp', whatsapp)
    .is('deleted_at', null)
    .single();
  return data ?? null;
}

export async function getOwner(id: string): Promise<Owner | null> {
  const { data } = await supabase
    .from('owners')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .single();
  return data ?? null;
}

export async function getAllActiveOwners(): Promise<Owner[]> {
  const { data } = await supabase
    .from('owners')
    .select('*')
    .is('deleted_at', null)
    .not('onboarding_completed_at', 'is', null);
  return data ?? [];
}

export async function updateOwner(id: string, updates: Partial<Owner>): Promise<void> {
  await supabase.from('owners').update(updates).eq('id', id);
}

export async function createOwner(owner: Omit<Owner, 'id' | 'created_at'>): Promise<Owner> {
  const { data, error } = await supabase
    .from('owners')
    .insert(owner)
    .select()
    .single();
  if (error) throw error;
  return data;
}
