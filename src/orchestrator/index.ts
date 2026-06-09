import type { HuntAIEvent, EngineResult } from './types.js';
import { resolveOwner, resolveCustomer, buildContext } from './context-builder.js';
import { handleOwnerCommand } from './command-parser.js';
import { defenderEngine } from '../engines/defender/index.js';
import { hunterEngine } from '../engines/hunter/index.js';
import { farmerEngine } from '../engines/farmer/index.js';
import { brieferEngine } from '../engines/briefer/index.js';
import { handleSmsOptOut } from '../lib/gdpr.js';
import { logger } from '../lib/logger.js';

/**
 * Central routing layer. Every event enters here.
 * Identifies owner + customer, builds context, dispatches to the correct engine.
 */
export async function orchestrate(event: HuntAIEvent): Promise<EngineResult> {
  // 1. Identify owner from event metadata
  const owner = await resolveOwner(event);
  if (!owner) {
    logger.warn({ event_type: event.type }, 'orchestrate: unknown owner');
    return {};
  }

  // 2. Check for STOP opt-out (must happen before any other SMS handling)
  if (
    event.type === 'sms.inbound' &&
    event.text?.trim().toUpperCase() === 'STOP'
  ) {
    await handleSmsOptOut(owner.id, event.from_phone);
    return {};
  }

  // 3. Check if this is an owner command
  if (
    event.type === 'whatsapp.owner_command' ||
    (event.type === 'whatsapp.customer_message' &&
      'from_phone' in event &&
      event.from_phone === owner.owner_whatsapp)
  ) {
    const text = 'text' in event ? (event.text ?? '') : '';
    await handleOwnerCommand(text, owner);
    return {};
  }

  // 4. Identify customer (if inbound from known number)
  const customer =
    'from_phone' in event && event.from_phone
      ? await resolveCustomer(owner.id, event.from_phone)
      : null;

  // 5. Build full context
  const ctx = await buildContext(event, owner, customer);

  // 6. Route to the correct engine
  switch (event.type) {
    case 'call.inbound':
    case 'call.turn':
    case 'whatsapp.customer_message':
    case 'sms.inbound':
      return defenderEngine(ctx);

    case 'scheduled.quote_follow_up':
      return hunterEngine(ctx);

    case 'scheduled.seasonal_campaign':
    case 'scheduled.service_reminder':
      return farmerEngine(ctx);

    case 'scheduled.daily_briefing':
      return brieferEngine(ctx);

    case 'call.ended':
      // Logging + summary handled inside defender
      return defenderEngine(ctx);

    default:
      logger.warn({ event_type: (event as HuntAIEvent).type }, 'orchestrate: unhandled event');
      return {};
  }
}
