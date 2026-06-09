import { inngest } from '../../inngest/client.js';
import { callClaude } from '../../integrations/anthropic.js';
import { sendOwnerWhatsApp } from '../../integrations/whatsapp.js';
import { getCallsSummary } from '../../db/queries/conversations.js';
import { getOpenQuotesSummary } from '../../db/queries/quotes.js';
import { getTodayJobs, getOverduePayments } from '../../db/queries/jobs.js';
import { getAllActiveOwners } from '../../db/queries/owners.js';
import { buildBrieferPrompt, buildActionList } from './prompt-builder.js';
import { logger } from '../../lib/logger.js';
import type { EngineContext, EngineResult } from '../../orchestrator/types.js';

/**
 * Send the daily briefing for a single owner.
 */
export async function brieferEngine(ctx: EngineContext): Promise<EngineResult> {
  const { owner } = ctx;

  const [calls, quotes, jobs, overduePayments] = await Promise.all([
    getCallsSummary(owner.id, 24),
    getOpenQuotesSummary(owner.id),
    getTodayJobs(owner.id),
    getOverduePayments(owner.id),
  ]);

  const briefingData = {
    calls_handled: calls.total,
    calls_emergency: calls.emergency_count,
    new_customers: calls.new_customer_count,
    open_quotes: quotes.total,
    quotes_awaiting_follow_up: quotes.due_today,
    // Customer names are first-name only for privacy in Claude prompt
    jobs_today: jobs.map((j) => ({
      customer_name: j.customer_name?.split(' ')[0] ?? null,
      time: new Date(j.scheduled_at).toTimeString().slice(0, 5),
      job_type: j.job_type,
    })),
    overdue_payments_count: overduePayments.length,
    action_required: buildActionList(calls, quotes, jobs, overduePayments),
  };

  const briefingText = await callClaude({
    system: buildBrieferPrompt(briefingData, owner),
    messages: [{ role: 'user', content: 'Generate the daily briefing.' }],
    maxTokens: 600,
  });

  await sendOwnerWhatsApp(owner, { text: briefingText });
  logger.info({ owner_id: owner.id }, 'Daily briefing sent');

  return {};
}

// ─── Inngest: daily briefing scheduler (fires once per owner at their time) ─

export const dailyBriefingJob = inngest.createFunction(
  { id: 'daily-briefing-dispatcher' },
  { cron: '0 5 * * *' }, // Run at 05:00 UTC daily; per-owner time handled inside
  async ({ step }) => {
    const owners = await step.run('get-owners', getAllActiveOwners);

    for (const owner of owners) {
      // Schedule per-owner briefing at their configured time (Spain = UTC+1/2)
      await inngest.send({
        name: 'huntai/briefing.send',
        data: { owner_id: owner.id },
      });
    }

    return { dispatched: owners.length };
  }
);

export const sendBriefingJob = inngest.createFunction(
  { id: 'daily-briefing-send' },
  { event: 'huntai/briefing.send' },
  async ({ event, step }) => {
    const { owner_id } = event.data as { owner_id: string };

    await step.run('send-briefing', async () => {
      const { getOwner } = await import('../../db/queries/owners.js');
      const owner = await getOwner(owner_id);
      if (!owner) return;

      const ctx: EngineContext = {
        owner,
        customer: null,
        event: { type: 'scheduled.daily_briefing', owner_id },
        activeConversation: null,
        openQuotes: [],
        recentJobs: [],
        recentMessages: [],
      };

      await brieferEngine(ctx);
    });
  }
);
