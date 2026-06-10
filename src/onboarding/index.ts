import { inngest } from '../inngest/client.js';
import { supabase } from '../db/supabase.js';
import { createCustomer, getCustomerByPhone } from '../db/queries/customers.js';
import { updateOwner } from '../db/queries/owners.js';
import { sendOwnerWhatsApp } from '../integrations/whatsapp.js';
import { createRetellAgent } from '../integrations/retell.js';
import { parseWhatsAppExport } from './whatsapp-parser.js';
import { parseCSVText, detectColumnMapping, parseCSVRows } from './csv-importer.js';
import { parseVCF } from './vcf-importer.js';
import { getAuthUrl } from '../integrations/google-calendar.js';
import { researchBusiness, formatProfileSummary, applyProfileEdits, emptyDraft } from './profile-research.js';
import type { BusinessProfileDraft } from './profile-research.js';
import { logger } from '../lib/logger.js';
import type { Owner } from '../orchestrator/types.js';

// ─── Onboarding conversation state ────────────────────────────────────────────

type OnboardingStep =
  | 'awaiting_info'
  | 'confirm_profile'
  | 'pricing'
  | 'emergency'
  | 'sundays';

interface OnboardingState {
  step: OnboardingStep;
  draft: BusinessProfileDraft;
  answers: Record<string, string>;
}

// Stored in-memory for MVP; move to Redis/Supabase for multi-instance
const onboardingState = new Map<string, OnboardingState>();

/**
 * Handle an onboarding message from a prospective owner.
 * Triggered automatically the first time a new number messages us — no
 * "SETUP" keyword required. Any message from a brand-new number starts a
 * warm introduction.
 *
 * Flow:
 *  1. Warm intro, ask for business name (and optionally a Google Maps /
 *     website link).
 *  2. Auto-research the business (Google Places + website) and present a
 *     pre-filled summary for the owner to confirm or correct.
 *  3. Once confirmed, ask only the handful of things that can't be found
 *     online (pricing, emergency line, Sundays).
 *  4. Create the owner record and Retell agent.
 *
 * `profileName` is the WhatsApp display name Twilio reports for the sender —
 * used as an initial guess for the owner's own name.
 */
export async function handleOnboardingMessage(
  ownerWhatsApp: string,
  text: string,
  profileName: string | null = null
): Promise<{ reply: string; done: boolean }> {
  let state = onboardingState.get(ownerWhatsApp);

  if (!state) {
    state = { step: 'awaiting_info', draft: emptyDraft(profileName), answers: {} };
    onboardingState.set(ownerWhatsApp, state);
    return {
      reply:
        '¡Hola! 👋 Soy *Encargado*, tu nuevo empleado de oficina con inteligencia artificial.\n\n' +
        'A partir de hoy puedo encargarme de las llamadas, los mensajes, los presupuestos y los recordatorios de tus clientes — para que tú puedas centrarte en el trabajo (y en tu familia 😊).\n\n' +
        'Para empezar, dime el *nombre de tu empresa*. Si tienes un enlace de tu ficha de Google (Maps) o de tu página web, pásamelo también — así puedo adelantar trabajo y rellenar tu perfil yo mismo.',
      done: false,
    };
  }

  switch (state.step) {
    case 'awaiting_info': {
      const draft = await researchBusiness(text, state.draft.owner_name);
      state.draft = draft;
      state.step = 'confirm_profile';
      return { reply: formatProfileSummary(draft, true), done: false };
    }

    case 'confirm_profile': {
      const { draft, confirmed } = await applyProfileEdits(state.draft, text);
      state.draft = draft;

      if (!confirmed) {
        return { reply: formatProfileSummary(draft, false), done: false };
      }

      state.step = 'pricing';
      return {
        reply:
          '👍 ¡Perfecto! Solo me quedan 3 cositas que no puedo adivinar por internet:\n\n' +
          '*1/3:* ¿Cuál es tu rango de precios habitual para un contrato mensual de mantenimiento? (por ejemplo: "100-200€/mes")',
        done: false,
      };
    }

    case 'pricing': {
      state.answers.pricing_notes = text.trim();
      state.step = 'emergency';
      return {
        reply: '*2/3:* ¿Tienes un teléfono de emergencias disponible los 7 días? Si es así, ¿cuál? Si no, escribe "no".',
        done: false,
      };
    }

    case 'emergency': {
      state.answers.emergency_phone = text.trim();
      state.step = 'sundays';
      return {
        reply: '*3/3:* ¿Trabajas los domingos? (sí/no)',
        done: false,
      };
    }

    case 'sundays': {
      state.answers.works_sundays = text.trim();

      const owner = await finaliseOwnerSetup(ownerWhatsApp, state.draft, state.answers);
      onboardingState.delete(ownerWhatsApp);

      const reply = `
✅ *¡Perfecto, ${owner.owner_name}!* Ya estoy listo para empezar a trabajar contigo. 🎉

Un último paso opcional: si quieres, puedo importar tu lista de clientes para reconocerlos automáticamente cuando llamen o escriban.

1. Abre un chat de cliente en WhatsApp
2. Pulsa los 3 puntos → "Exportar chat" → "Sin archivos"
3. Envíame el archivo .txt aquí

Puedes enviar todos los que quieras. Cuando termines, escribe *DONE*.

También acepto archivos .csv, .xlsx o .vcf de contactos.
      `.trim();

      return { reply, done: false };
    }

    default:
      return {
        reply:
          'Perdona, no entendí ese mensaje 🙏 Si quieres empezar de nuevo, escríbeme "Hola" y configuramos tu cuenta otra vez.',
        done: false,
      };
  }
}

async function finaliseOwnerSetup(
  ownerWhatsApp: string,
  draft: BusinessProfileDraft,
  answers: Record<string, string>
): Promise<Owner> {
  const worksSundays = answers.works_sundays?.toLowerCase().trim();
  const noSundays = worksSundays === 'no' || worksSundays?.startsWith('no');

  const emergency = answers.emergency_phone?.trim().toLowerCase();
  const emergencyPhone = emergency && emergency !== 'no' ? answers.emergency_phone.trim() : null;

  const { data: owner, error } = await supabase
    .from('owners')
    .insert({
      business_name: draft.business_name ?? 'Mi negocio',
      owner_name: draft.owner_name ?? draft.business_name ?? 'Encargado/a',
      owner_whatsapp: ownerWhatsApp,
      business_phone: ownerWhatsApp, // Placeholder — updated when Twilio number provisioned
      ai_persona_name: 'Encargado',
      service_area: draft.service_area,
      languages: draft.languages.length ? draft.languages : ['es'],
      business_address: draft.business_address,
      website: draft.website,
      working_hours: draft.working_hours,
      pricing_notes: answers.pricing_notes ?? null,
      emergency_phone: emergencyPhone,
      booking_rules: {
        no_sundays: noSundays,
        max_advance_days: 14,
      },
    })
    .select()
    .single();

  if (error || !owner) throw new Error('Failed to create owner: ' + error?.message);

  // Create Retell agent
  const agentId = await createRetellAgent(owner as Owner);
  await updateOwner(owner.id, { retell_agent_id: agentId });

  // Send Google Calendar auth link
  const calendarUrl = getAuthUrl(owner.id);
  await sendOwnerWhatsApp(owner as Owner, {
    text: `Para conectar tu Google Calendar (para las citas), abre este enlace:\n${calendarUrl}`,
  });

  logger.info({ owner_id: owner.id }, 'Owner onboarding: business setup complete');

  return owner as Owner;
}

// ─── Inngest job: process uploaded onboarding file ─────────────────────────

export const processOnboardingFileJob = inngest.createFunction(
  { id: 'process-onboarding-file' },
  { event: 'huntai/onboarding.file_received' },
  async ({ event, step }) => {
    const { owner_id, import_id, storage_path, file_type } = event.data as {
      owner_id: string;
      import_id: string;
      storage_path: string;
      file_type: string;
    };

    // Update status to processing
    await step.run('mark-processing', async () => {
      await supabase
        .from('onboarding_imports')
        .update({ status: 'processing' })
        .eq('id', import_id);
    });

    // Download file from Supabase Storage
    // Inngest serializes Buffer as { type: "Buffer", data: number[] } across steps,
    // so we return a plain base64 string and reconstruct on the other side.
    const fileBase64 = await step.run('download-file', async () => {
      const { data, error } = await supabase.storage
        .from('onboarding-temp')
        .download(storage_path);
      if (error || !data) throw new Error('Failed to download file');
      return Buffer.from(await data.arrayBuffer()).toString('base64');
    }) as string;
    const fileBuffer = Buffer.from(fileBase64, 'base64');

    // Get owner info
    const { data: owner } = await supabase
      .from('owners')
      .select('*')
      .eq('id', owner_id)
      .single();

    if (!owner) return;

    let created = 0;
    let errors: unknown[] = [];

    if (file_type === '.txt') {
      // WhatsApp export
      const result = await step.run('parse-whatsapp', async () => {
        const chatText = fileBuffer.toString('utf8');
        const parsed = await parseWhatsAppExport(chatText, owner.owner_name);

        if (parsed.confidence < 0.3) {
          return { created: 0, errors: ['Low confidence extraction'] };
        }

        // Check if customer already exists
        const existing = parsed.phone
          ? await getCustomerByPhone(owner_id, parsed.phone)
          : null;

        if (!existing) {
          await createCustomer({
            owner_id,
            phone: parsed.phone ?? '',
            name: parsed.name,
            preferred_language: 'es',
            address: null,
            area: parsed.area ?? null,
            pool_specs: parsed.pool_specs ?? null,
            service_contract: parsed.service_contract ?? null,
            payment_status: (parsed.payment_status as 'current' | 'overdue' | 'unknown') ?? 'unknown',
            last_payment_date: null,
            last_service_date: parsed.last_service_date ?? null,
            next_service_date: null,
            notes: parsed.notes ?? null,
            tags: parsed.confidence < 0.7 ? ['needs_review'] : [],
            sms_opt_out: false,
            data_source: 'whatsapp_import',
            import_batch_id: import_id,
            deleted_at: null,
          });
          return { created: 1, errors: [] };
        }
        return { created: 0, errors: [] };
      });

      created = result.created;
      errors = result.errors;
    } else if (file_type === '.csv') {
      const result = await step.run('parse-csv', async () => {
        const csvText = fileBuffer.toString('utf8');
        const { headers, rows } = parseCSVText(csvText);
        const mapping = await detectColumnMapping(headers, rows.slice(0, 5));
        const customers = parseCSVRows(rows, mapping);

        let c = 0;
        for (const customer of customers) {
          if (!customer.phone) continue;
          const existing = await getCustomerByPhone(owner_id, customer.phone);
          if (!existing) {
            await createCustomer({
              owner_id,
              phone: customer.phone,
              name: customer.name ?? null,
              preferred_language: 'es',
              address: customer.address ?? null,
              area: customer.area ?? null,
              pool_specs: null,
              service_contract: customer.service_frequency
                ? {
                    frequency: customer.service_frequency,
                    price_eur: customer.monthly_price
                      ? parseFloat(customer.monthly_price)
                      : undefined,
                    active: true,
                  }
                : null,
              payment_status:
                (customer.payment_status as 'current' | 'overdue' | 'unknown') ?? 'unknown',
              last_payment_date: null,
              last_service_date: customer.last_service ?? null,
              next_service_date: null,
              notes: customer.notes ?? null,
              tags: [],
              sms_opt_out: false,
              data_source: 'csv_import',
              import_batch_id: import_id,
              deleted_at: null,
            });
            c++;
          }
        }
        return { created: c, errors: [] };
      });

      created = result.created;
    } else if (file_type === '.vcf') {
      const result = await step.run('parse-vcf', async () => {
        const vcfText = fileBuffer.toString('utf8');
        const contacts = parseVCF(vcfText);
        let c = 0;
        for (const contact of contacts) {
          if (!contact.phone) continue;
          const existing = await getCustomerByPhone(owner_id, contact.phone);
          if (!existing) {
            await createCustomer({
              owner_id,
              phone: contact.phone,
              name: contact.name,
              preferred_language: 'es',
              address: null,
              area: null,
              pool_specs: null,
              service_contract: null,
              payment_status: 'unknown',
              last_payment_date: null,
              last_service_date: null,
              next_service_date: null,
              notes: contact.note ?? null,
              tags: [],
              sms_opt_out: false,
              data_source: 'csv_import',
              import_batch_id: import_id,
              deleted_at: null,
            });
            c++;
          }
        }
        return { created: c, errors: [] };
      });
      created = result.created;
    }

    // Update import record
    await step.run('update-import', async () => {
      await supabase.from('onboarding_imports').update({
        status: 'completed',
        customers_created: created,
        parse_errors: errors.length ? errors : null,
      }).eq('id', import_id);
    });

    // Notify owner
    await step.run('notify-owner', async () => {
      const ownerFull = await supabase.from('owners').select('*').eq('id', owner_id).single();
      if (!ownerFull.data) return;

      await sendOwnerWhatsApp(ownerFull.data as Owner, {
        text: `✅ Archivo procesado: ${created} cliente(s) importado(s).${
          errors.length ? ` (${errors.length} error(es) — revisa la lista)` : ''
        }`,
      });
    });

    return { created, errors: errors.length };
  }
);
