import { inngest } from '../client.js';
import { supabase } from '../../db/supabase.js';
import { logger } from '../../lib/logger.js';

/**
 * Purge call transcripts (messages) older than each owner's configured retention period.
 * Runs monthly. GDPR Art. 5(1)(e) — storage limitation.
 */
export const purgeOldTranscriptsJob = inngest.createFunction(
  { id: 'purge-old-transcripts' },
  { cron: '0 2 1 * *' }, // 02:00 on the 1st of each month
  async ({ step }) => {
    const { data: owners } = await supabase
      .from('owners')
      .select('id, transcript_retention_months')
      .is('deleted_at', null);

    let totalDeleted = 0;

    for (const owner of owners ?? []) {
      const deleted = await step.run(`purge-${owner.id}`, async () => {
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - owner.transcript_retention_months);

        // Find conversations older than retention period
        const { data: oldConvs } = await supabase
          .from('conversations')
          .select('id')
          .eq('owner_id', owner.id)
          .lt('started_at', cutoff.toISOString());

        if (!oldConvs?.length) return 0;

        const convIds = oldConvs.map((c) => c.id);

        // Hard-delete messages
        const { count } = await supabase
          .from('messages')
          .delete({ count: 'exact' })
          .in('conversation_id', convIds);

        // Soft-delete conversations
        await supabase
          .from('conversations')
          .update({ deleted_at: new Date().toISOString() })
          .in('id', convIds);

        return count ?? 0;
      });

      totalDeleted += deleted;
    }

    logger.info({ total_deleted: totalDeleted }, 'GDPR transcript purge complete');
    return { deleted: totalDeleted };
  }
);
