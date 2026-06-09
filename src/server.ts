import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { serve } from 'inngest/fastify';
import { retellRoutes } from './webhooks/retell.js';
import { twilioRoutes } from './webhooks/twilio.js';
import { whatsappRoutes } from './webhooks/whatsapp.js';
import { exchangeCodeForTokens } from './integrations/google-calendar.js';
import { handleOnboardingMessage } from './onboarding/index.js';
import { getOwnerByWhatsApp } from './db/queries/owners.js';
import { inngest } from './inngest/client.js';
import {
  purgeOnboardingFilesJob,
  purgeOldTranscriptsJob,
  dailyBriefingSchedulerJob,
  hunterFollowUpJob,
  farmerSeasonalCampaignJob,
  farmerReviewRequestJob,
  dailyBriefingJob,
  sendBriefingJob,
  poolOpeningCampaignJob,
  poolClosingCampaignJob,
  processOnboardingFileJob,
} from './inngest/client.js';
import { logger } from './lib/logger.js';

const app = Fastify({
  logger: false, // Using Winston instead
  // Keep raw body for webhook signature verification
  bodyLimit: 10 * 1024 * 1024, // 10MB
});

// Add raw body parser for signature verification
app.addContentTypeParser(
  'application/json',
  { parseAs: 'buffer' },
  (req, body, done) => {
    try {
      (req as unknown as { rawBody: Buffer }).rawBody = body as Buffer;
      const json = JSON.parse((body as Buffer).toString());
      done(null, json);
    } catch (err) {
      done(err as Error);
    }
  }
);

app.addContentTypeParser(
  'application/x-www-form-urlencoded',
  { parseAs: 'buffer' },
  (req, body, done) => {
    (req as unknown as { rawBody: Buffer }).rawBody = body as Buffer;
    const parsed: Record<string, string> = {};
    const str = (body as Buffer).toString();
    for (const pair of str.split('&')) {
      const [k, v] = pair.split('=');
      if (k) parsed[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
    }
    done(null, parsed);
  }
);

await app.register(helmet, {
  contentSecurityPolicy: false, // API server — no HTML
});
await app.register(cors, { origin: false }); // No browser clients
await app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  skipOnError: true,
});

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', async () => ({
  status: 'ok',
  ts: new Date().toISOString(),
  env: process.env.NODE_ENV,
}));

// ── Webhook routes ────────────────────────────────────────────────────────────
await app.register(retellRoutes);
await app.register(twilioRoutes);
await app.register(whatsappRoutes);

// ── Google Calendar OAuth callback ────────────────────────────────────────────
app.get('/auth/google/callback', async (req, reply) => {
  const query = req.query as { code?: string; state?: string; error?: string };

  if (query.error || !query.code || !query.state) {
    return reply.code(400).send('OAuth error: ' + (query.error ?? 'missing code'));
  }

  try {
    await exchangeCodeForTokens(query.code, query.state);
    return reply.send(
      '<html><body><h2>✅ Google Calendar conectado. Puedes cerrar esta ventana.</h2></body></html>'
    );
  } catch (err) {
    logger.error({ err }, 'Google OAuth callback failed');
    return reply.code(500).send('Error connecting Google Calendar');
  }
});

// ── Inngest handler ───────────────────────────────────────────────────────────
const allJobs = [
  purgeOnboardingFilesJob,
  purgeOldTranscriptsJob,
  dailyBriefingSchedulerJob,
  hunterFollowUpJob,
  farmerSeasonalCampaignJob,
  farmerReviewRequestJob,
  dailyBriefingJob,
  sendBriefingJob,
  poolOpeningCampaignJob,
  poolClosingCampaignJob,
  processOnboardingFileJob,
];

app.route({
  method: ['GET', 'POST', 'PUT'],
  url: '/api/inngest',
  handler: serve({ client: inngest, functions: allJobs }) as never,
});

// ── Start ─────────────────────────────────────────────────────────────────────
const port = Number(process.env.PORT ?? 3000);

try {
  await app.listen({ port, host: '0.0.0.0' });
  logger.info({ port }, `HuntAI server listening`);
} catch (err) {
  logger.error({ err }, 'Server startup failed');
  process.exit(1);
}
