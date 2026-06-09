import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verifyRetellSignature } from '../lib/security.js';
import { orchestrate } from '../orchestrator/index.js';
import { logger } from '../lib/logger.js';

const RetellWebhookSchema = z.object({
  event: z.enum(['call_started', 'call_ended', 'call_analyzed', 'response_required']),
  call: z.object({
    call_id: z.string(),
    from_number: z.string(),
    to_number: z.string(),
    transcript: z
      .array(
        z.object({
          role: z.enum(['agent', 'user']),
          content: z.string(),
        })
      )
      .optional()
      .default([]),
  }),
});

export async function retellRoutes(app: FastifyInstance) {
  app.post('/webhooks/retell', async (req, reply) => {
    // Verify Retell webhook signature
    const signature = req.headers['x-retell-signature'] as string;
    const secret = process.env.RETELL_WEBHOOK_SECRET;

    if (secret && signature) {
      const valid = verifyRetellSignature(
        signature,
        (req as unknown as { rawBody: Buffer }).rawBody ?? JSON.stringify(req.body),
        secret
      );
      if (!valid) {
        logger.warn('Retell webhook: invalid signature');
        return reply.code(401).send({ error: 'Invalid signature' });
      }
    }

    let payload;
    try {
      payload = RetellWebhookSchema.parse(req.body);
    } catch (err) {
      logger.warn({ err }, 'Retell webhook: invalid payload');
      return reply.code(400).send({ error: 'Invalid payload' });
    }

    const { event, call } = payload;

    if (event === 'call_started') {
      await orchestrate({
        type: 'call.inbound',
        from_phone: call.from_number,
        to_phone: call.to_number,
        retell_call_id: call.call_id,
      });
      return reply.send({ response_type: 'response', content: '' });
    }

    if (event === 'call_analyzed' || event === 'call_ended') {
      await orchestrate({
        type: 'call.ended',
        retell_call_id: call.call_id,
        transcript: call.transcript,
      });
      return reply.send({ ok: true });
    }

    if (event === 'response_required') {
      const transcript = call.transcript ?? [];
      const lastUserTurn = [...transcript].reverse().find((t) => t.role === 'user');

      const result = await orchestrate({
        type: 'call.turn',
        from_phone: call.from_number,
        to_phone: call.to_number,
        retell_call_id: call.call_id,
        transcript,
        text: lastUserTurn?.content ?? '',
      });

      return reply.send({
        response_type: 'response',
        content: result.reply_text ?? 'Un momento, por favor.',
      });
    }

    return reply.send({ ok: true });
  });
}
