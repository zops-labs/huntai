import { inngest } from '../client.js';
import { supabase } from '../../db/supabase.js';
import { logger } from '../../lib/logger.js';

/**
 * Purge onboarding temp files older than 72 hours.
 * Runs every 6 hours (GDPR requirement — ephemeral files).
 */
export const purgeOnboardingFilesJob = inngest.createFunction(
  { id: 'purge-onboarding-files' },
  { cron: '0 */6 * * *' },
  async ({ step }) => {
    const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000);

    const { data: imports } = await step.run('find-stale-files', async () =>
      supabase
        .from('onboarding_imports')
        .select('id, storage_path')
        .lt('created_at', cutoff.toISOString())
        .is('file_deleted_at', null)
        .not('storage_path', 'is', null)
    );

    const toDelete = imports?.data ?? [];
    logger.info({ count: toDelete.length }, 'Purging stale onboarding files');

    for (const imp of toDelete) {
      await step.run(`delete-${imp.id}`, async () => {
        if (imp.storage_path) {
          await supabase.storage
            .from('onboarding-temp')
            .remove([imp.storage_path]);
        }

        await supabase
          .from('onboarding_imports')
          .update({
            file_deleted_at: new Date().toISOString(),
            storage_path: null,
          })
          .eq('id', imp.id);
      });
    }

    return { deleted: toDelete.length };
  }
);
