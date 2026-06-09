import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verifyTwilioSignature } from '../lib/security.js';
import { orchestrate } from '../orchestrator/index.js';
import { logger } from '../lib/logger.js';

const TwilioSMSSchema = z.object({
  From: z.string(),
  To: z.string(),
  Body: z.string(),
  MessageSid: z.string().optional(),
});

export async function twilioRoutes(app: FastifyInstance) {
  app.post('/webhooks/twilio/sms', async (req, reply) => {
    // Verify Twilio webhook signature
    const signature = req.headers['x-twilio-signature'] as string;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const baseUrl = process.env.BASE_URL;

    if (authToken && signature && baseUrl) {
      const url = `${baseUrl}/webhooks/twilio/sms`;
      const params = req.body as Record<string, string>;
      const valid = verifyTwilioSignature(signature, url, params, authToken);
      if (!valid) {
        logger.warn('Twilio webhook: invalid signature');
        return reply.code(401).send();
      }
    }

    let body;
    try {
      body = TwilioSMSSchema.parse(req.body);
    } catch (err) {
      return reply.code(400).send();
    }

    await orchestrate({
      type: 'sms.inbound',
      from_phone: body.From,
      to_phone: body.To,
      text: body.Body,
    });

    // Twilio expects a TwiML response (empty = no auto-reply)
    reply.header('Content-Type', 'text/xml');
    return reply.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  });
}
