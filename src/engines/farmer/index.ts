import { inngest } from '../../inngest/client.js';
import { sendSMS } from '../../integrations/twilio.js';
import {
  getCustomersForSeasonalCampaign,
  getCustomer,
} from '../../db/queries/customers.js';
import { getOwner } from '../../db/queries/owners.js';
import { getJobsCompletedWithoutReview, updateJob } from '../../db/queries/jobs.js';
import { logger } from '../../lib/logger.js';
import type { EngineContext, EngineResult } from '../../orchestrator/types.js';

// ─── Review request message ────────────────────────────────────────────────

function buildReviewRequestMessage(
  customerName: string,
  businessName: string,
  reviewUrl: string
): string {
  return `Hola ${customerName}, es ${businessName}. Esperamos que todo quedara perfecto con la piscina. Si tienes un momento, nos ayudaría mucho una valoración: ${reviewUrl} ¡Muchas gracias!`.slice(
    0,
    300
  );
}

// ─── Inngest: seasonal campaign ────────────────────────────────────────────

export const farmerSeasonalCampaignJob = inngest.createFunction(
  { id: 'farmer-seasonal-campaign', concurrency: { limit: 5 } },
  { event: 'huntai/farmer.seasonal_campaign' },
  async ({ event, step }) => {
    const { owner_id, campaign } = event.data as {
      owner_id: string;
      campaign: 'pool_opening' | 'pool_closing';
    };

    const owner = await step.run('get-owner', () => getOwner(owner_id));
    if (!owner) return;

    const customers = await step.run('get-customers', () =>
      getCustomersForSeasonalCampaign(owner_id)
    );

    logger.info(
      { owner_id, campaign, customer_count: customers.length },
      'Farmer seasonal campaign'
    );

    for (const customer of customers) {
      if (!customer.phone) continue;

      const message =
        campaign === 'pool_opening'
          ? `Hola ${customer.name ?? ''}, es ${owner.business_name}. La temporada de piscinas está llegando. ¿Quieres que te preparemos la piscina antes del verano?`
          : `Hola ${customer.name ?? ''}, es ${owner.business_name}. Con el otoño llegando, es el momento de proteger tu piscina. ¿Te gestionamos el cierre?`;

      await step.run(`sms-${customer.id}`, () =>
        sendSMS({
          to: customer.phone,
          from: owner.business_phone,
          body: message + '\n\nResponde STOP para no recibir más mensajes.',
        })
      );
    }

    return { sent: customers.length };
  }
);

// ─── Inngest: post-job review request (fires 3 days after completion) ──────

export const farmerReviewRequestJob = inngest.createFunction(
  { id: 'farmer-review-request' },
  { event: 'huntai/job.completed' },
  async ({ event, step }) => {
    // Wait 3 days before sending
    await step.sleep('wait-3-days', '3d');

    const { job_id, owner_id } = event.data as { job_id: string; owner_id: string };

    const owner = await step.run('get-owner', () => getOwner(owner_id));
    if (!owner) return;

    const reviewUrl = (owner.booking_rules as Record<string, unknown>)
      ?.google_review_url as string | undefined;
    if (!reviewUrl) return; // Not configured

    const { data: job } = await step.run('get-job', async () => {
      const { data } = await import('../../db/supabase.js').then((m) =>
        m.supabase
          .from('jobs')
          .select('*, customers(name, phone, sms_opt_out)')
          .eq('id', job_id)
          .single()
      );
      return { data };
    });

    if (!job) return;

    const customer = (job as Record<string, unknown>).customers as {
      name: string | null;
      phone: string;
      sms_opt_out: boolean;
    } | null;

    if (!customer || customer.sms_opt_out) return;

    const message = buildReviewRequestMessage(
      customer.name ?? '',
      owner.business_name,
      reviewUrl
    );

    await step.run('send-review-sms', () =>
      sendSMS({
        to: customer.phone,
        from: owner.business_phone,
        body: message + '\n\nResponde STOP para no recibir más mensajes.',
      })
    );

    await step.run('mark-review-requested', () =>
      updateJob(job_id, { review_requested_at: new Date().toISOString() })
    );
  }
);

// ─── Engine entry point ────────────────────────────────────────────────────

export async function farmerEngine(ctx: EngineContext): Promise<EngineResult> {
  const { event } = ctx;

  if (event.type === 'scheduled.seasonal_campaign') {
    await inngest.send({
      name: 'huntai/farmer.seasonal_campaign',
      data: { owner_id: event.owner_id, campaign: event.campaign },
    });
  }

  if (event.type === 'scheduled.service_reminder') {
    const customer = await getCustomer(event.customer_id);
    if (!customer || customer.sms_opt_out) return {};
    const owner = await getOwner(event.owner_id);
    if (!owner) return {};

    await sendSMS({
      to: customer.phone,
      from: owner.business_phone,
      body:
        `Hola ${customer.name ?? ''}, es casi un año desde que revisamos tu piscina por última vez. ¿Quieres que te la dejemos a punto?` +
        '\n\nResponde STOP para no recibir más mensajes.',
    });
  }

  return {};
}
