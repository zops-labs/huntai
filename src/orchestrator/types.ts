// ─── Domain types ─────────────────────────────────────────────────────────────

export interface Owner {
  id: string;
  business_name: string;
  owner_name: string;
  owner_whatsapp: string;
  business_phone: string;
  twilio_number_sid: string;
  retell_agent_id: string;
  service_area: string[];
  languages: string[];
  ai_persona_name: string;
  pricing_notes: string | null;
  booking_rules: Record<string, unknown>;
  emergency_phone: string | null;
  google_calendar_id: string | null;
  google_tokens_enc: string | null;
  whatsapp_360_channel_id: string | null;
  briefing_time: string;
  transcript_retention_months: number;
  onboarding_completed_at: string | null;
  subscription_tier: string;
  stripe_customer_id: string | null;
  created_at: string;
  deleted_at: string | null;
}

export interface Customer {
  id: string;
  owner_id: string;
  phone: string;
  name: string | null;
  preferred_language: string;
  address: string | null;
  area: string | null;
  pool_specs: {
    size_m2?: number;
    type?: 'salt' | 'chlorine' | 'unknown';
    brand?: string;
    filter?: string;
  } | null;
  service_contract: {
    frequency?: string;
    price_eur?: number;
    active?: boolean;
  } | null;
  payment_status: 'current' | 'overdue' | 'unknown';
  last_payment_date: string | null;
  last_service_date: string | null;
  next_service_date: string | null;
  notes: string | null;
  tags: string[];
  sms_opt_out: boolean;
  data_source: string;
  import_batch_id: string | null;
  created_at: string;
  deleted_at: string | null;
}

export interface Quote {
  id: string;
  owner_id: string;
  customer_id: string;
  description: string;
  amount_eur: number | null;
  status: 'open' | 'accepted' | 'rejected' | 'expired' | 'converted';
  follow_up_stage: number;
  next_follow_up_at: string | null;
  sent_at: string | null;
  responded_at: string | null;
  notes: string | null;
  created_at: string;
  deleted_at: string | null;
}

export interface Job {
  id: string;
  owner_id: string;
  customer_id: string;
  quote_id: string | null;
  job_type: 'maintenance' | 'repair' | 'installation' | 'emergency' | 'inspection';
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';
  scheduled_at: string;
  completed_at: string | null;
  duration_minutes: number | null;
  google_event_id: string | null;
  amount_eur: number | null;
  payment_status: 'pending' | 'paid' | 'overdue';
  review_requested_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  owner_id: string;
  customer_id: string | null;
  channel: 'voice' | 'sms' | 'whatsapp';
  direction: 'inbound' | 'outbound';
  engine: 'defender' | 'hunter' | 'farmer' | 'briefer' | null;
  status: 'active' | 'completed' | 'escalated';
  retell_call_id: string | null;
  summary: string | null;
  outcome: 'booked' | 'quote_sent' | 'escalated' | 'no_action' | 'opted_out' | null;
  started_at: string;
  ended_at: string | null;
  deleted_at: string | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  owner_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  language_detected: string | null;
  sentiment: 'positive' | 'neutral' | 'negative' | 'urgent' | null;
  created_at: string;
}

// ─── Event types ──────────────────────────────────────────────────────────────

export type HuntAIEvent =
  | {
      type: 'call.inbound';
      from_phone: string;
      to_phone: string;
      retell_call_id: string;
    }
  | {
      type: 'call.turn';
      from_phone: string;
      to_phone: string;
      retell_call_id: string;
      transcript: RetellTranscriptTurn[];
      text: string;
    }
  | {
      type: 'call.ended';
      retell_call_id: string;
      transcript: RetellTranscriptTurn[];
    }
  | {
      type: 'sms.inbound';
      from_phone: string;
      to_phone: string;
      text: string;
    }
  | {
      type: 'whatsapp.customer_message';
      from_phone: string;
      to_phone: string;
      text: string;
      message_id: string;
    }
  | {
      type: 'whatsapp.owner_command';
      from_phone: string;
      text: string;
      message_id: string;
    }
  | {
      type: 'whatsapp.stop_received';
      from_phone: string;
    }
  | {
      type: 'scheduled.quote_follow_up';
      quote_id: string;
      owner_id: string;
    }
  | {
      type: 'scheduled.daily_briefing';
      owner_id: string;
    }
  | {
      type: 'scheduled.seasonal_campaign';
      owner_id: string;
      campaign: 'pool_opening' | 'pool_closing';
    }
  | {
      type: 'scheduled.service_reminder';
      owner_id: string;
      customer_id: string;
    };

export interface RetellTranscriptTurn {
  role: 'agent' | 'user';
  content: string;
}

// ─── Engine context ───────────────────────────────────────────────────────────

export interface EngineContext {
  owner: Owner;
  customer: Customer | null;
  event: HuntAIEvent;
  activeConversation: Conversation | null;
  openQuotes: Quote[];
  recentJobs: Job[];
  recentMessages: Message[];
}

// ─── Claude response shapes ───────────────────────────────────────────────────

export interface DefenderResponse {
  reply_text: string;
  action: 'book_appointment' | 'take_message' | 'escalate' | 'end_call' | 'continue';
  booking_request: {
    preferred_date: string;
    preferred_time: string;
    job_type: 'maintenance' | 'repair' | 'emergency' | 'inspection';
  } | null;
  customer_update: Partial<Customer> | null;
  owner_alert: string | null;
  language_used: 'es' | 'en';
}

export interface EngineResult {
  reply_text?: string;
  action?: string;
}
