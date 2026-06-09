import type { HuntAIEvent, EngineContext, Owner, Customer } from './types.js';
import {
  getOwnerByBusinessPhone,
  getOwnerByWhatsApp,
  getOwner,
} from '../db/queries/owners.js';
import { getCustomerByPhone } from '../db/queries/customers.js';
import { getActiveConversation } from '../db/queries/conversations.js';
import { getOpenQuotes } from '../db/queries/quotes.js';
import { getRecentJobs } from '../db/queries/jobs.js';
import { getRecentMessages } from '../db/queries/conversations.js';

/**
 * Resolve the owner from an event.
 * Owners are identified by the phone number the customer called (to_phone).
 */
export async function resolveOwner(event: HuntAIEvent): Promise<Owner | null> {
  if ('to_phone' in event && event.to_phone) {
    return getOwnerByBusinessPhone(event.to_phone);
  }
  if ('owner_id' in event && event.owner_id) {
    return getOwner(event.owner_id);
  }
  return null;
}

/**
 * Resolve the customer from an event using their phone number.
 */
export async function resolveCustomer(
  ownerId: string,
  fromPhone: string
): Promise<Customer | null> {
  return getCustomerByPhone(ownerId, fromPhone);
}

/**
 * Build the full EngineContext for a given event + owner + customer.
 */
export async function buildContext(
  event: HuntAIEvent,
  owner: Owner,
  customer: Customer | null
): Promise<EngineContext> {
  const [activeConversation, openQuotes, recentJobs, recentMessages] =
    await Promise.all([
      customer ? getActiveConversation(customer.id) : Promise.resolve(null),
      customer ? getOpenQuotes(customer.id) : Promise.resolve([]),
      customer ? getRecentJobs(customer.id, 3) : Promise.resolve([]),
      Promise.resolve([]), // messages loaded after conversation is known
    ]);

  const messages = activeConversation
    ? await getRecentMessages(activeConversation.id, 10)
    : [];

  return {
    owner,
    customer,
    event,
    activeConversation,
    openQuotes,
    recentJobs,
    recentMessages: messages,
  };
}
