import Retell from 'retell-sdk';
import type { Owner } from '../orchestrator/types.js';
import { logger } from '../lib/logger.js';

const retell = new Retell({ apiKey: process.env.RETELL_API_KEY ?? '' });

/**
 * Create a new Retell agent for an owner during onboarding.
 */
export async function createRetellAgent(owner: Owner): Promise<string> {
  const agent = await retell.agent.create({
    // @ts-expect-error — SDK typings may lag behind API
    llm_websocket_url: `${process.env.BASE_URL}/webhooks/retell`,
    agent_name: owner.business_name,
    voice_id: owner.languages.includes('es')
      ? 'eleven_multilingual_v2_spanish'
      : 'eleven_multilingual_v2',
    language: 'multi',
    responsiveness: 1,
    enable_backchannel: true,
    interruption_sensitivity: 0.8,
  });

  logger.info({ agent_id: agent.agent_id, owner_id: owner.id }, 'Retell agent created');
  return agent.agent_id;
}

/**
 * Delete a Retell agent (e.g. on account deletion).
 */
export async function deleteRetellAgent(agentId: string): Promise<void> {
  await retell.agent.delete(agentId);
}
