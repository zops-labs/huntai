import { supabase } from '../supabase.js';
import type { Job } from '../../orchestrator/types.js';

export async function getJob(id: string): Promise<Job | null> {
  const { data } = await supabase.from('jobs').select('*').eq('id', id).single();
  return data ?? null;
}

export async function getRecentJobs(customerId: string, limit = 3): Promise<Job[]> {
  const { data } = await supabase
    .from('jobs')
    .select('*')
    .eq('customer_id', customerId)
    .order('scheduled_at', { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function getTodayJobs(
  ownerId: string
): Promise<(Job & { customer_name: string | null })[]> {
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  const { data } = await supabase
    .from('jobs')
    .select('*, customers(name)')
    .eq('owner_id', ownerId)
    .eq('status', 'scheduled')
    .gte('scheduled_at', today + 'T00:00:00')
    .lt('scheduled_at', tomorrow + 'T00:00:00')
    .order('scheduled_at', { ascending: true });

  return (data ?? []).map((j: Record<string, unknown>) => ({
    ...(j as Job),
    customer_name: (j.customers as { name: string } | null)?.name ?? null,
  }));
}

export async function createJob(job: Omit<Job, 'id' | 'created_at'>): Promise<Job> {
  const { data, error } = await supabase.from('jobs').insert(job).select().single();
  if (error) throw error;
  return data;
}

export async function updateJob(id: string, updates: Partial<Job>): Promise<void> {
  await supabase.from('jobs').update(updates).eq('id', id);
}

export async function getJobsCompletedWithoutReview(ownerId: string): Promise<Job[]> {
  const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
  const fourDaysAgo = new Date(Date.now() - 4 * 86400000).toISOString();

  const { data } = await supabase
    .from('jobs')
    .select('*')
    .eq('owner_id', ownerId)
    .eq('status', 'completed')
    .is('review_requested_at', null)
    .lte('completed_at', threeDaysAgo)
    .gte('completed_at', fourDaysAgo);

  return data ?? [];
}

export async function getOverduePayments(ownerId: string): Promise<Job[]> {
  const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString();

  const { data } = await supabase
    .from('jobs')
    .select('*')
    .eq('owner_id', ownerId)
    .eq('payment_status', 'overdue')
    .lte('completed_at', tenDaysAgo);

  return data ?? [];
}
