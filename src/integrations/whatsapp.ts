import twilio from 'twilio';
import axios from 'axios';
import type { Owner } from '../orchestrator/types.js';
import { logger } from '../lib/logger.js';

// Twilio WhatsApp sender format: "whatsapp:+14155238886"
// Numbers must be prefixed with "whatsapp:"
function waNumber(phone: string): string {
  return phone.startsWith('whatsapp:') ? phone : `whatsapp:${phone}`;
}

function getTwilioClient() {
  return twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
}

/**
 * The Twilio WhatsApp sender number — set in .env as TWILIO_WHATSAPP_NUMBER.
 * This is either the Sandbox number (+14155238886) during dev,
 * or your approved WhatsApp Business number in production.
 */
function getWhatsAppFrom(): string {
  const num = process.env.TWILIO_WHATSAPP_NUMBER;
  if (!num) throw new Error('TWILIO_WHATSAPP_NUMBER is not set');
  return waNumber(num);
}

/**
 * Send a WhatsApp text message to the owner via Twilio.
 */
export async function sendOwnerWhatsApp(
  owner: Owner,
  message: { text: string }
): Promise<void> {
  const client = getTwilioClient();
  await client.messages.create({
    from: getWhatsAppFrom(),
    to: waNumber(owner.owner_whatsapp),
    body: message.text,
  });
  logger.debug({ owner_id: owner.id }, 'WhatsApp sent to owner');
}

/**
 * Send a WhatsApp text message to an arbitrary phone number.
 * Used for prospective-owner onboarding, before an Owner record exists.
 */
export async function sendWhatsAppMessage(to: string, text: string): Promise<void> {
  const client = getTwilioClient();
  await client.messages.create({
    from: getWhatsAppFrom(),
    to: waNumber(to),
    body: text,
  });
}

/**
 * Send a WhatsApp message with a media attachment (e.g. GDPR export file).
 */
export async function sendOwnerWhatsAppDocument(
  owner: Owner,
  params: { link: string; filename: string; caption?: string }
): Promise<void> {
  const client = getTwilioClient();
  await client.messages.create({
    from: getWhatsAppFrom(),
    to: waNumber(owner.owner_whatsapp),
    body: params.caption ?? params.filename,
    mediaUrl: [params.link],
  });
}

/**
 * Download a media file sent to the Twilio WhatsApp number.
 * Used during onboarding to retrieve uploaded WhatsApp export files.
 * Twilio stores media at a URL accessible with Basic Auth (SID + token).
 */
export async function download360MediaFile(mediaUrl: string): Promise<Buffer> {
  const { data } = await axios.get<ArrayBuffer>(mediaUrl, {
    responseType: 'arraybuffer',
    auth: {
      username: process.env.TWILIO_ACCOUNT_SID ?? '',
      password: process.env.TWILIO_AUTH_TOKEN ?? '',
    },
  });
  return Buffer.from(data);
}

/**
 * No-op — Twilio handles read receipts automatically.
 */
export async function markMessageRead(_messageId: string): Promise<void> {
  // Twilio WhatsApp does not require a separate read-receipt API call
}
