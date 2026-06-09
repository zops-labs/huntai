import { inngest } from '../../inngest/client.js';
import { getAllActiveOwners } from '../../db/queries/owners.js';
import { logger } from '../../lib/logger.js';

/**
 * Schedule seasonal pool opening campaign for all active owners (April 1).
 */
export const poolOpeningCampaignJob = inngest.createFunction(
  { id: 'farmer-pool-opening' },
  { cron: '0 8 1 4 *' }, // 08:00 on April 1 every year
  async ({ step }) => {
    const owners = await step.run('get-owners', getAllActiveOwners);

    for (const owner of owners) {
      await inngest.send({
        name: 'huntai/farmer.seasonal_campaign',
        data: { owner_id: owner.id, campaign: 'pool_opening' },
      });
    }

    logger.info({ owner_count: owners.length }, 'Pool opening campaign scheduled');
    return { scheduled: owners.length };
  }
);

/**
 * Schedule seasonal pool closing campaign for all active owners (October 15).
 */
export const poolClosingCampaignJob = inngest.createFunction(
  { id: 'farmer-pool-closing' },
  { cron: '0 8 15 10 *' }, // 08:00 on October 15 every year
  async ({ step }) => {
    const owners = await step.run('get-owners', getAllActiveOwners);

    for (const owner of owners) {
      await inngest.send({
        name: 'huntai/farmer.seasonal_campaign',
        data: { owner_id: owner.id, campaign: 'pool_closing' },
      });
    }

    logger.info({ owner_count: owners.length }, 'Pool closing campaign scheduled');
    return { scheduled: owners.length };
  }
);
