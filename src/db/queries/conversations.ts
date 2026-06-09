import { supabase } from '../supabase.js';
import type { Conversation, Message } from '../../orchestrator/types.js';

export async function getActiveConversation(customerId: string): Promise<Conversation | null> {
  const { data } = await supabase
    .from('conversations')
    .select('*')
    .eq('customer_id', customerId)
    .eq('status', 'active')
    .order('started_at', { ascending: false })
    .limit(1)
    .single();
  return data ?? null;
}

export async function getConversationByRetellCallId(
  callId: string
): Promise<Conversation | null> {
  const { data } = await supabase
    .from('conversations')
    .select('*')
    .eq('retell_call_id', callId)
    .single();
  return data ?? null;
}

export async function createConversation(
  conv: Omit<Conversation, 'id' | 'started_at'>
): Promise<Conversation> {
  const { data, error } = await supabase
    .from('conversations')
    .insert(conv)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateConversation(
  id: string,
  updates: Partial<Conversation>
): Promise<void> {
  await supabase.from('conversations').update(updates).eq('id', id);
}

export async function getRecentMessages(
  conversationId: string,
  limit = 10
): Promise<Message[]> {
  const { data } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []).reverse();
}

export async function addMessage(
  message: Omit<Message, 'id' | 'created_at'>
): Promise<Message> {
  const { data, error } = await supabase
    .from('messages')
    .insert(message)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getCallsSummary(
  ownerId: string,
  hoursBack: number
): Promise<{
  total: number;
  emergency_count: number;
  new_customer_count: number;
}> {
  const since = new Date(Date.now() - hoursBack * 3600000).toISOString();

  const { data } = await supabase
    .from('conversations')
    .select('outcome, customer_id')
    .eq('owner_id', ownerId)
    .eq('channel', 'voice')
    .gte('started_at', since);

  const rows = data ?? [];
  return {
    total: rows.length,
    emergency_count: rows.filter((r) => r.outcome === 'escalated').length,
    new_customer_count: rows.filter((r) => !r.customer_id).length,
  };
}
