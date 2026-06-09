import crypto from 'crypto';

/**
 * Verify Retell webhook HMAC-SHA256 signature.
 */
export function verifyRetellSignature(
  signature: string,
  rawBody: Buffer | string,
  secret: string
): boolean {
  try {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expected, 'hex')
    );
  } catch {
    return false;
  }
}

/**
 * Verify Twilio webhook signature.
 * Twilio uses HMAC-SHA1 over the full URL + sorted params.
 */
export function verifyTwilioSignature(
  signature: string,
  url: string,
  params: Record<string, string>,
  authToken: string
): boolean {
  try {
    const sortedKeys = Object.keys(params).sort();
    const str = url + sortedKeys.map((k) => k + params[k]).join('');
    const expected = crypto
      .createHmac('sha1', authToken)
      .update(str)
      .digest('base64');
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

/**
 * Verify 360dialog webhook HMAC-SHA256 signature.
 */
export function verify360dialogSignature(
  signature: string,
  rawBody: Buffer | string,
  secret: string
): boolean {
  try {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');
    return crypto.timingSafeEqual(
      Buffer.from(signature.replace('sha256=', ''), 'hex'),
      Buffer.from(expected, 'hex')
    );
  } catch {
    return false;
  }
}

/**
 * Sanitise a string from user input — strip HTML/script injection, enforce max length.
 */
export function sanitiseInput(input: string, maxLength = 4000): string {
  return input
    .replace(/<[^>]*>/g, '') // strip HTML tags
    .replace(/javascript:/gi, '') // strip JS URIs
    .slice(0, maxLength)
    .trim();
}
