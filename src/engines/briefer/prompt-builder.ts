import type { Owner } from '../../orchestrator/types.js';

interface BriefingData {
  calls_handled: number;
  calls_emergency: number;
  new_customers: number;
  open_quotes: number;
  quotes_awaiting_follow_up: number;
  jobs_today: Array<{ customer_name: string | null; time: string; job_type: string }>;
  overdue_payments_count: number;
  action_required: string[];
}

export function buildBrieferPrompt(data: BriefingData, owner: Owner): string {
  return `
Generate a concise WhatsApp briefing message in Spanish for ${owner.owner_name} from ${owner.business_name}.

Data from the last 24 hours:
- Calls handled: ${data.calls_handled}
- Emergency calls: ${data.calls_emergency}
- New potential customers: ${data.new_customers}
- Open quotes total: ${data.open_quotes}
- Quotes needing follow-up today: ${data.quotes_awaiting_follow_up}
- Today's scheduled jobs: ${JSON.stringify(data.jobs_today)}
- Overdue payments: ${data.overdue_payments_count}
- Action items: ${JSON.stringify(data.action_required)}

Rules:
- Start with "Buenos días ${owner.owner_name}."
- Be concise and actionable
- Highlight anything urgent first
- Use natural Spanish, not corporate language
- Maximum 300 words
- Do NOT include customer phone numbers or full addresses
- Return the message text only. No JSON.
`.trim();
}

export function buildActionList(
  calls: { total: number; emergency_count: number; new_customer_count: number },
  quotes: { total: number; due_today: number },
  jobs: unknown[],
  overduePayments: unknown[]
): string[] {
  const actions: string[] = [];

  if (calls.emergency_count > 0) {
    actions.push(`${calls.emergency_count} llamada(s) de emergencia — revisar`);
  }
  if (calls.new_customer_count > 0) {
    actions.push(`${calls.new_customer_count} nuevo(s) cliente(s) potenciales`);
  }
  if (quotes.due_today > 0) {
    actions.push(`${quotes.due_today} presupuesto(s) pendiente(s) de seguimiento hoy`);
  }
  if (overduePayments.length > 0) {
    actions.push(`${overduePayments.length} pago(s) atrasado(s) — ¿enviar recordatorio?`);
  }

  return actions;
}
