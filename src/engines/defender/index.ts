import type { EngineContext, EngineResult, DefenderResponse, Message } from '../../orchestrator/types.js';
import { buildDefenderSystemPrompt } from './prompt-builder.js';
import { detectEmergency } from './emergency-detector.js';
import { callClaudeJSON } from '../../integrations/anthropic.js';
import { sendOwnerWhatsApp } from '../../integrations/whatsapp.js';
import { createCalendarEvent, checkAvailability } from '../../integrations/google-calendar.js';
import {
  createConversation,
  updateConversation,
  addMessage,
  getConversationByRetellCallId,
} from '../../db/queries/conversations.js';
import {
  createCustomer,
  updateCustomer,
} from '../../db/queries/customers.js';
import { createJob } from '../../db/queries/jobs.js';
import { logger } from '../../lib/logger.js';

/**
 * Defender Engine — handles all inbound contacts (calls, customer WhatsApp/SMS).
 */
export async function defenderEngine(ctx: EngineContext): Promise<EngineResult> {
  const { owner, customer, event, activeConversation, recentMessages } = ctx;

  // ── Handle call end ────────────────────────────────────────────────────────
  if (event.type === 'call.ended') {
    if (activeConversation) {
      await updateConversation(activeConversation.id, {
        status: 'completed',
        ended_at: new Date().toISOString(),
      });
    }
    return {};
  }

  // ── Extract current text ───────────────────────────────────────────────────
  const currentText =
    event.type === 'call.turn' || event.type === 'sms.inbound'
      ? event.text
      : event.type === 'whatsapp.customer_message'
      ? event.text
      : event.type === 'call.inbound'
      ? '' // Greeting — no customer text yet
      : '';

  // ── Emergency detection (fast path — fires in parallel) ───────────────────
  if (currentText && detectEmergency(currentText)) {
    sendOwnerWhatsApp(owner, {
      text: `🚨 ALERTA: Posible emergencia detectada. Cliente dice: "${currentText.slice(0, 200)}"`,
    }).catch(() => {}); // Non-blocking
  }

  // ── Ensure conversation exists ────────────────────────────────────────────
  let conversation = activeConversation;
  if (!conversation) {
    const channel =
      event.type === 'call.inbound' || event.type === 'call.turn'
        ? 'voice'
        : event.type === 'sms.inbound'
        ? 'sms'
        : 'whatsapp';

    const retellCallId =
      event.type === 'call.inbound' || event.type === 'call.turn'
        ? event.retell_call_id
        : undefined;

    conversation = await createConversation({
      owner_id: owner.id,
      customer_id: customer?.id ?? null,
      channel,
      direction: 'inbound',
      engine: 'defender',
      status: 'active',
      retell_call_id: retellCallId ?? null,
      summary: null,
      outcome: null,
      ended_at: null,
      deleted_at: null,
    });
  }

  // ── Build message history for Claude ──────────────────────────────────────
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    ...recentMessages.map((m: Message) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  ];

  // Add current turn if there is one
  if (currentText) {
    messages.push({ role: 'user', content: currentText });
  } else {
    // Opening greeting
    messages.push({
      role: 'user',
      content: customer
        ? `[Customer ${customer.name ?? 'known'} is calling]`
        : '[New customer is calling]',
    });
  }

  // ── Call Claude ────────────────────────────────────────────────────────────
  const system = buildDefenderSystemPrompt(owner, customer ?? null);
  const claudeResponse = await callClaudeJSON<DefenderResponse>({
    system,
    messages,
    maxTokens: 512,
  });

  // ── Persist this turn ─────────────────────────────────────────────────────
  if (currentText) {
    await addMessage({
      conversation_id: conversation.id,
      owner_id: owner.id,
      role: 'user',
      content: currentText,
      language_detected: claudeResponse.language_used,
      sentiment: null,
    });
  }
  if (claudeResponse.reply_text) {
    await addMessage({
      conversation_id: conversation.id,
      owner_id: owner.id,
      role: 'assistant',
      content: claudeResponse.reply_text,
      language_detected: claudeResponse.language_used,
      sentiment: null,
    });
  }

  // ── Apply customer updates learned during call ────────────────────────────
  if (claudeResponse.customer_update) {
    if (customer) {
      await updateCustomer(customer.id, claudeResponse.customer_update);
    } else if (claudeResponse.customer_update.name && 'from_phone' in event && event.from_phone) {
      // New customer — create record
      await createCustomer({
        owner_id: owner.id,
        phone: event.from_phone,
        name: claudeResponse.customer_update.name as string,
        preferred_language: claudeResponse.language_used,
        pool_specs: claudeResponse.customer_update.pool_specs as Record<string, unknown> ?? null,
        service_contract: null,
        payment_status: 'unknown',
        last_payment_date: null,
        last_service_date: null,
        next_service_date: null,
        address: null,
        area: claudeResponse.customer_update.area as string ?? null,
        notes: null,
        tags: [],
        sms_opt_out: false,
        data_source: 'live_call',
        import_batch_id: null,
        deleted_at: null,
      });
    }
  }

  // ── Owner alert ───────────────────────────────────────────────────────────
  if (claudeResponse.owner_alert) {
    await sendOwnerWhatsApp(owner, { text: claudeResponse.owner_alert });
  }

  // ── Booking action ────────────────────────────────────────────────────────
  if (claudeResponse.action === 'book_appointment' && claudeResponse.booking_request) {
    const br = claudeResponse.booking_request;
    try {
      if (owner.google_calendar_id) {
        const eventId = await createCalendarEvent(owner, {
          title: `${claudeResponse.booking_request.job_type} — ${customer?.name ?? 'New customer'}`,
          date: br.preferred_date,
          time: br.preferred_time,
          notes: `Booked via HuntAI. Customer: ${customer?.id ?? 'new'}`,
        });

        if (customer) {
          await createJob({
            owner_id: owner.id,
            customer_id: customer.id,
            quote_id: null,
            job_type: br.job_type,
            status: 'scheduled',
            scheduled_at: `${br.preferred_date}T${br.preferred_time}:00`,
            completed_at: null,
            duration_minutes: null,
            google_event_id: eventId,
            amount_eur: null,
            payment_status: 'pending',
            review_requested_at: null,
            notes: null,
          });
        }
      }
    } catch (err) {
      logger.error({ err, owner_id: owner.id }, 'Failed to create calendar event');
    }

    await updateConversation(conversation.id, { outcome: 'booked' });
  }

  // ── Escalation action ─────────────────────────────────────────────────────
  if (claudeResponse.action === 'escalate') {
    await updateConversation(conversation.id, {
      status: 'escalated',
      outcome: 'escalated',
    });
    await sendOwnerWhatsApp(owner, {
      text: `⚠️ Llamada escalada — el cliente necesita atención directa.`,
    });
  }

  return { reply_text: claudeResponse.reply_text, action: claudeResponse.action };
}
