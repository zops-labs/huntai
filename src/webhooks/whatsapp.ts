import type { FastifyInstance } from 'fastify';
import path from 'path';
import { z } from 'zod';
import { verifyTwilioSignature } from '../lib/security.js';
import { orchestrate } from '../orchestrator/index.js';
import { getOwnerByWhatsApp } from '../db/queries/owners.js';
import { supabase } from '../db/supabase.js';
import { inngest } from '../inngest/client.js';
import { download360MediaFile, sendOwnerWhatsApp, sendWhatsAppMessage } from '../integrations/whatsapp.js';
import { sanitiseInput } from '../lib/security.js';
import { logger } from '../lib/logger.js';
import { handleOnboardingMessage } from '../onboarding/index.js';

// Twilio WhatsApp webhooks have the same shape as SMS webhooks,
// but From/To are prefixed with "whatsapp:" e.g. "whatsapp:+34600000001"
const TwilioWhatsAppSchema = z.object({
  From: z.string(),        // "whatsapp:+34600000001"
  To: z.string(),          // "whatsapp:+14155238886"
  Body: z.string().optional().default(''),
  MessageSid: z.string().optional(),
  NumMedia: z.string().optional().default('0'),
  MediaUrl0: z.string().optional(),      // First media file URL (if any)
  MediaContentType0: z.string().optional(),
  MediaFilename0: z.string().optional(),
  ProfileName: z.string().optional(),    // Sender's WhatsApp display name
});

// Strip "whatsapp:" prefix to get a plain E.164 number
function stripWaPrefix(phone: string): string {
  return phone.replace(/^whatsapp:/i, '');
}

// Deduplication set
const processedMessageIds = new Set<string>();

export async function whatsappRoutes(app: FastifyInstance) {
  app.post('/webhooks/whatsapp', async (req, reply) => {
    // Verify Twilio signature (same mechanism as SMS webhook)
    const signature = req.headers['x-twilio-signature'] as string;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const baseUrl = process.env.BASE_URL;

    if (authToken && signature && baseUrl) {
      const url = `${baseUrl}/webhooks/whatsapp`;
      const params = req.body as Record<string, string>;
      const valid = verifyTwilioSignature(signature, url, params, authToken);
      if (!valid) {
        logger.warn('WhatsApp webhook: invalid Twilio signature');
        return reply.code(401).send();
      }
    }

    let body;
    try {
      body = TwilioWhatsAppSchema.parse(req.body);
    } catch {
      return reply.code(400).send();
    }

    const msgSid = body.MessageSid ?? '';
    if (msgSid && processedMessageIds.has(msgSid)) {
      return reply.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }
    if (msgSid) {
      processedMessageIds.add(msgSid);
      if (processedMessageIds.size > 1000) {
        const first = processedMessageIds.values().next().value;
        if (first) processedMessageIds.delete(first);
      }
    }

    const fromPhone = stripWaPrefix(body.From);
    const toPhone = stripWaPrefix(body.To);
    const text = sanitiseInput(body.Body);
    const hasMedia = parseInt(body.NumMedia) > 0;

    // Is this from an owner?
    const owner = await getOwnerByWhatsApp(fromPhone);

    if (owner) {
      if (hasMedia && body.MediaUrl0) {
        await handleOnboardingDocument(body.MediaUrl0, body.MediaFilename0 ?? 'upload', owner);
      } else if (text) {
        await orchestrate({
          type: 'whatsapp.owner_command',
          from_phone: fromPhone,
          text,
          message_id: msgSid,
        });
      }
    } else {
      // Customer message — find their owner
      const ownerViaChannel = await findOwnerByCustomerPhone(fromPhone);
      if (ownerViaChannel && text) {
        await orchestrate({
          type: 'whatsapp.customer_message',
          from_phone: fromPhone,
          to_phone: ownerViaChannel.business_phone,
          text,
          message_id: msgSid,
        });
      } else if (text) {
        // Brand-new number, not a known owner or customer — start onboarding.
        const { reply } = await handleOnboardingMessage(fromPhone, text, body.ProfileName ?? null);
        await sendWhatsAppMessage(fromPhone, reply);
      }
    }

    // Twilio expects TwiML response (empty = no auto-reply)
    reply.header('Content-Type', 'text/xml');
    return reply.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  });
}

async function handleOnboardingDocument(
  mediaUrl: string,
  filename: string,
  owner: { id: string; onboarding_completed_at: string | null; owner_whatsapp: string; business_phone: string; business_name: string; owner_name: string; ai_persona_name: string; briefing_time: string; transcript_retention_months: number; subscription_tier: string; service_area: string[]; languages: string[]; pricing_notes: string | null; booking_rules: Record<string, unknown>; emergency_phone: string | null; google_calendar_id: string | null; google_tokens_enc: string | null; whatsapp_360_channel_id: string | null; twilio_number_sid: string; retell_agent_id: string; stripe_customer_id: string | null; created_at: string; deleted_at: string | null }
) {
  const allowed = ['.txt', '.csv', '.xlsx', '.vcf'];
  const ext = path.extname(filename).toLowerCase() || '.txt'; // WhatsApp exports often have no extension

  if (!allowed.includes(ext)) {
    await sendOwnerWhatsApp(owner, {
      text: `Solo acepto archivos .txt (WhatsApp export), .csv, .xlsx, o .vcf.`,
    });
    return;
  }

  // Download from Twilio media URL (requires Basic Auth)
  const mediaBuffer = await download360MediaFile(mediaUrl);

  if (mediaBuffer.length > 10 * 1024 * 1024) {
    await sendOwnerWhatsApp(owner, { text: `Archivo demasiado grande (max 10MB).` });
    return;
  }

  const storagePath = `${owner.id}/${Date.now()}_${filename}`;
  await supabase.storage
    .from('onboarding-temp')
    .upload(storagePath, mediaBuffer, { contentType: 'application/octet-stream' });

  const { data: importRecord } = await supabase
    .from('onboarding_imports')
    .insert({
      owner_id: owner.id,
      import_type: ext.replace('.', ''),
      storage_path: storagePath,
      status: 'pending',
    })
    .select()
    .single();

  if (importRecord) {
    await inngest.send({
      name: 'huntai/onboarding.file_received',
      data: {
        owner_id: owner.id,
        import_id: importRecord.id,
        storage_path: storagePath,
        file_type: ext,
      },
    });
  }

  await sendOwnerWhatsApp(owner, {
    text: `✓ Archivo recibido. Lo estoy procesando... Te aviso cuando esté listo.`,
  });
}

async function findOwnerByCustomerPhone(fromPhone: string) {
  const { data } = await supabase
    .from('customers')
    .select('owner_id')
    .eq('phone', fromPhone)
    .is('deleted_at', null)
    .limit(1)
    .single();

  if (!data?.owner_id) return null;

  const { data: owner } = await supabase
    .from('owners')
    .select('*')
    .eq('id', data.owner_id)
    .single();

  return owner ?? null;
}
