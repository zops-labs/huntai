import { google } from 'googleapis';
import { encrypt, decrypt } from '../lib/crypto.js';
import { updateOwner } from '../db/queries/owners.js';
import type { Owner } from '../orchestrator/types.js';
import { logger } from '../lib/logger.js';

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

/**
 * Generate the OAuth URL to send to the owner during onboarding.
 */
export function getAuthUrl(ownerId: string): string {
  const oauth2Client = getOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar'],
    state: ownerId,
    prompt: 'consent',
  });
}

/**
 * Exchange auth code for tokens and store encrypted in the owners table.
 */
export async function exchangeCodeForTokens(
  code: string,
  ownerId: string
): Promise<void> {
  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  const encrypted = encrypt(JSON.stringify(tokens));
  await updateOwner(ownerId, { google_tokens_enc: encrypted });
  logger.info({ owner_id: ownerId }, 'Google Calendar tokens stored');
}

/**
 * Get an authorised Google Calendar client for the owner.
 */
export async function getCalendarClient(owner: Owner) {
  if (!owner.google_tokens_enc) {
    throw new Error('Owner has not connected Google Calendar');
  }
  const tokens = JSON.parse(decrypt(owner.google_tokens_enc));
  const auth = getOAuth2Client();
  auth.setCredentials(tokens);

  // Automatically refresh token if needed
  auth.on('tokens', async (newTokens) => {
    if (newTokens.refresh_token) {
      const merged = { ...tokens, ...newTokens };
      await updateOwner(owner.id, { google_tokens_enc: encrypt(JSON.stringify(merged)) });
    }
  });

  return google.calendar({ version: 'v3', auth });
}

/**
 * Check availability on a given date and return free slots.
 */
export async function checkAvailability(
  owner: Owner,
  date: string,
  durationMinutes = 90
): Promise<{ available: boolean; slots: string[] }> {
  const cal = await getCalendarClient(owner);
  const dayStart = new Date(`${date}T08:00:00`);
  const dayEnd = new Date(`${date}T18:00:00`);

  const { data } = await cal.freebusy.query({
    requestBody: {
      timeMin: dayStart.toISOString(),
      timeMax: dayEnd.toISOString(),
      items: [{ id: owner.google_calendar_id ?? 'primary' }],
    },
  });

  const busy = data.calendars?.[owner.google_calendar_id ?? 'primary']?.busy ?? [];

  // Calculate free slots (1.5h windows)
  const slots: string[] = [];
  let cursor = dayStart.getTime();

  while (cursor + durationMinutes * 60000 <= dayEnd.getTime()) {
    const slotEnd = cursor + durationMinutes * 60000;
    const isFree = !busy.some(({ start, end }) => {
      const busyStart = new Date(start!).getTime();
      const busyEnd = new Date(end!).getTime();
      return cursor < busyEnd && slotEnd > busyStart;
    });

    if (isFree) {
      slots.push(new Date(cursor).toTimeString().slice(0, 5));
    }
    cursor += 60 * 60000; // step 1 hour
  }

  return { available: slots.length > 0, slots };
}

/**
 * Create a calendar event for a booking.
 * Returns the Google event ID.
 */
export async function createCalendarEvent(
  owner: Owner,
  params: {
    title: string;
    date: string;
    time: string;
    durationMinutes?: number;
    notes?: string;
    customerPhone?: string;
  }
): Promise<string> {
  const cal = await getCalendarClient(owner);
  const startDateTime = new Date(`${params.date}T${params.time}:00`);
  const endDateTime = new Date(
    startDateTime.getTime() + (params.durationMinutes ?? 90) * 60000
  );

  const event = await cal.events.insert({
    calendarId: owner.google_calendar_id ?? 'primary',
    requestBody: {
      summary: params.title,
      description: params.notes,
      start: { dateTime: startDateTime.toISOString(), timeZone: 'Europe/Madrid' },
      end: { dateTime: endDateTime.toISOString(), timeZone: 'Europe/Madrid' },
    },
  });

  return event.data.id ?? '';
}

/**
 * Delete a calendar event (e.g. cancellation).
 */
export async function deleteCalendarEvent(
  owner: Owner,
  eventId: string
): Promise<void> {
  const cal = await getCalendarClient(owner);
  await cal.events.delete({
    calendarId: owner.google_calendar_id ?? 'primary',
    eventId,
  });
}
