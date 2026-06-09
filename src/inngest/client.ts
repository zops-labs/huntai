import { Inngest } from 'inngest';

export const inngest = new Inngest({
  id: 'huntai',
  eventKey: process.env.INNGEST_EVENT_KEY,
  signingKey: process.env.INNGEST_SIGNING_KEY,
});

// All registered Inngest functions — exported for server registration
export { purgeOnboardingFilesJob } from './jobs/purge-onboarding-files.js';
export { purgeOldTranscriptsJob } from './jobs/purge-old-transcripts.js';
export { dailyBriefingSchedulerJob } from './jobs/daily-briefing-scheduler.js';
export { hunterFollowUpJob } from '../engines/hunter/index.js';
export { farmerSeasonalCampaignJob, farmerReviewRequestJob } from '../engines/farmer/index.js';
export { dailyBriefingJob, sendBriefingJob } from '../engines/briefer/index.js';
export { poolOpeningCampaignJob, poolClosingCampaignJob } from '../engines/farmer/campaign-scheduler.js';
export { processOnboardingFileJob } from '../onboarding/index.js';
