import { inngest } from '../../inngest/client.js';
import { callClaude } from '../../integrations/anthropic.js';
import { sendSMS } from '../../integrations/twilio.js';
import { sendOwnerWhatsApp } from '../../integrations/whatsapp.js';
import { getQuote, updateQuote } from '../../db/queries/quotes.js';
import { getCustomer } from '../../db/queries/customers.js';
import { getOwner } from '../../db/queries/owners.js';
import { buildHunterPrompt } from './prompt-builder.js';
import { logger } from '../../lib/logger.js';
import type { EngineContext, EngineResult } from '../../orchestrator/types.js';

// ─── Inngest function for scheduled follow-ups ─────────────────────────────

export const hunterFollowUpJob = inngest.createFunction(
  { id: 'hunter-follow-up', concurrency: { limit: 10 } },
  { event: 'huntai/quote.follow_up_due' },
  async ({ event, step }) => {
    const { quote_id, owner_id } = event.data as { quote_id: string; owner_id: string };

    // Fetch all context inside step (IDs only in payload)
    const context = await step.run('fetch-context', async () => {
      const quote = await getQuote(quote_id);
      if (!quote || quote.status !== 'open') return null;
      if (quote.follow_up_stage >= 3) return null;

      const customer = await getCustomer(quote.customer_id);
      if (!customer || customer.sms_opt_out) return null;

      const owner = await getOwner(owner_id);
      if (!owner) return null;

      return { quote, customer, owner };
    });

    if (!context) return { skipped: true };
    const { quote, customer, owner } = context;

    // Generate follow-up message
    const message = await step.run('generate-message', async () => {
      return callClaude({
        system: buildHunterPrompt({
          stage: quote.follow_up_stage + 1,
          quote_description: quote.description,
          owner_name: owner.owner_name,
          business_name: owner.business_name,
          preferred_language: customer.preferred_language,
          previous_contact_count: quote.follow_up_stage,
        }),
        messages: [{ role: 'user', content: 'Generate the follow-up message.' }],
        maxTokens: 200,
      });
    });

    // Send SMS (never WhatsApp for outbound — GDPR requires opt-in)
    await step.run('send-sms', async () => {
      await sendSMS({
        to: customer.phone,
        from: owner.business_phone,
        body: message + '\n\nResponde STOP para no recibir más mensajes.',
      });
    });

    // Update quote stage and schedule next follow-up
    await step.run('update-quote', async () => {
      const nextStage = quote.follow_up_stage + 1;
      const delaysDays = [null, 3, 7, 14]; // indexed by next stage
      const nextDelay = nextStage < 3 ? delaysDays[nextStage + 1] : null;

      await updateQuote(quote_id, {
        follow_up_stage: nextStage,
        next_follow_up_at: nextDelay
          ? new Date(Date.now() + nextDelay * 86400000).toISOString()
          : null,
      });

      // Schedule next follow-up if applicable
      if (nextDelay) {
        await inngest.send({
          name: 'huntai/quote.follow_up_due',
          data: { quote_id, owner_id },
          ts: Date.now() + nextDelay * 86400000,
        });
      }
    });

    // Notify owner
    await step.run('notify-owner', async () => {
      await sendOwnerWhatsApp(owner, {
        text: `Follow-up #${quote.follow_up_stage + 1} enviado a ${customer.name ?? 'cliente'} re: ${quote.description}`,
      });
    });

    return { sent: true };
  }
);

// ─── Engine entry point (called by orchestrator for scheduled events) ──────

export async function hunterEngine(ctx: EngineContext): Promise<EngineResult> {
  const { event } = ctx;
  if (event.type !== 'scheduled.quote_follow_up') return {};

  await inngest.send({
    name: 'huntai/quote.follow_up_due',
    data: { quote_id: event.quote_id, owner_id: event.owner_id },
  });

  return {};
}
