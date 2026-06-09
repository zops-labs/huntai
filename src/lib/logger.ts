import winston from 'winston';

// PII fields that must never appear in logs
const PII_FIELDS = ['phone', 'name', 'address', 'email', 'owner_whatsapp', 'business_phone'];

function stripPII(obj: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (PII_FIELDS.includes(key)) {
      clean[key] = '[REDACTED]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      clean[key] = stripPII(value as Record<string, unknown>);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

const piiSafeFormat = winston.format((info) => {
  return stripPII(info as Record<string, unknown>) as winston.Logform.TransformableInfo;
});

export const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    piiSafeFormat(),
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    process.env.NODE_ENV === 'production'
      ? winston.format.json()
      : winston.format.prettyPrint()
  ),
  transports: [new winston.transports.Console()],
});

/**
 * Hash a phone number for safe logging (first 6 chars + ***).
 * Never log the full phone number.
 */
export function hashPhone(phone: string): string {
  if (!phone) return 'unknown';
  return phone.slice(0, 6) + '***';
}
