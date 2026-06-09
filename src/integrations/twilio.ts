import twilio from 'twilio';
import { supabase } from '../db/supabase.js';
import { logger, hashPhone } from '../lib/logger.js';

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

interface SendSMSParams {
  to: string;
  from: string;
  body: string;
}

/**
 * Send an SMS via Twilio.
 * Enforces opt-out at the dispatcher level — never sends to opted-out numbers.
 */
export async function sendSMS(params: SendSMSParams): Promise<void> {
  // Check opt-out status before sending
  const { data: customer } = await supabase
    .from('customers')
    .select('sms_opt_out')
    .eq('phone', params.to)
    .single();

  if (customer?.sms_opt_out) {
    logger.info({ phone_hash: hashPhone(params.to) }, 'SMS blocked — opted out');
    return;
  }

  await twilioClient.messages.create({
    to: params.to,
    from: params.from,
    body: params.body,
  });

  logger.info({ phone_hash: hashPhone(params.to) }, 'SMS sent');
}

/**
 * Provision a new Spanish phone number for an owner.
 * Returns the phone number SID.
 */
export async function provisionSpanishNumber(): Promise<{
  phoneNumber: string;
  sid: string;
}> {
  const numbers = await twilioClient
    .availablePhoneNumbers('ES')
    .local.list({ limit: 1 });

  if (!numbers.length) {
    throw new Error('No Spanish phone numbers available');
  }

  const purchased = await twilioClient.incomingPhoneNumbers.create({
    phoneNumber: numbers[0].phoneNumber,
    smsUrl: `${process.env.BASE_URL}/webhooks/twilio/sms`,
  });

  return { phoneNumber: purchased.phoneNumber, sid: purchased.sid };
}
