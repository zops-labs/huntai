import { inngest } from '../inngest/client.js';
import { supabase } from '../db/supabase.js';
import { createCustomer, updateCustomer, getCustomerByPhone } from '../db/queries/customers.js';
import { updateOwner } from '../db/queries/owners.js';
import { sendOwnerWhatsApp } from '../integrations/whatsapp.js';
import { createRetellAgent } from '../integrations/retell.js';
import { parseWhatsAppExport } from './whatsapp-parser.js';
import { parseCSVText, detectColumnMapping, parseCSVRows } from './csv-importer.js';
import { parseVCF } from './vcf-importer.js';
import { getAuthUrl } from '../integrations/google-calendar.js';
import { logger } from '../lib/logger.js';
import type { Owner } from '../orchestrator/types.js';

// ─── Onboarding conversation state ────────────────────────────────────────────

// Stored in-memory for MVP; move to Redis/Supabase for multi-instance
const onboardingState = new Map<
  string,
  { step: number; answers: Record<string, string> }
>();

/**
 * Handle an onboarding message from a prospective owner.
 * Triggered when owner texts "SETUP" or is mid-onboarding flow.
 */
export async function handleOnboardingMessage(
  ownerWhatsApp: string,
  text: string
): Promise<{ reply: string; done: boolean }> {
  let state = onboardingState.get(ownerWhatsApp);

  if (!state || text.trim().toUpperCase() === 'SETUP') {
    state = { step: 0, answers: {} };
    onboardingState.set(ownerWhatsApp, state);
    return {
      reply:
        '¡Hola! Soy HuntAI, tu asistente comercial de piscinas. Voy a configurar tu cuenta en unos minutos.\n\n*Paso 1/8:* ¿Cuál es el nombre de tu empresa?',
      done: false,
    };
  }

  const { step, answers } = state;

  // Collect answers step by step
  const questions = [
    {
      key: 'business_name',
      next: '¿Cuál es tu nombre (solo el nombre)? Por ejemplo: "Miguel"',
    },
    {
      key: 'owner_name',
      next: '¿Qué zonas cubres? (separa con comas: "Marbella, Estepona, San Pedro")',
    },
    {
      key: 'service_area',
      next: '¿En qué idiomas atiendes a los clientes? (por ejemplo: "español e inglés")',
    },
    {
      key: 'languages',
      next: '¿Cuál es tu horario de trabajo? (por ejemplo: "Lunes a Viernes 8:00-18:00")',
    },
    {
      key: 'working_hours',
      next: '¿Tienes número de emergencias disponible los 7 días? Si es así, ¿cuál?',
    },
    {
      key: 'emergency_phone',
      next: '¿Trabajas los domingos? (sí/no)',
    },
    {
      key: 'works_sundays',
      next: '¿Cuál es tu rango de precios habitual para un contrato mensual de mantenimiento? (por ejemplo: "100-200€/mes")',
    },
    {
      key: 'pricing_notes',
      next: null, // Last question
    },
  ];

  if (step < questions.length) {
    answers[questions[step].key] = text.trim();
    state.step++;

    if (state.step < questions.length) {
      return { reply: questions[state.step].next!, done: false };
    }

    // All questions answered — create the owner record
    const owner = await finaliseOwnerSetup(ownerWhatsApp, answers);

    onboardingState.delete(ownerWhatsApp);

    const reply = `
✅ *Perfecto, ${answers.owner_name}!* Tu cuenta está casi lista.

Ahora quiero importar tu lista de clientes. Si tienes chats de WhatsApp con clientes:

1. Abre un chat de cliente en WhatsApp
2. Pulsa los 3 puntos → "Exportar chat" → "Sin archivos"
3. Envíame el archivo .txt aquí

Puedes enviar todos los que quieras. Cuando termines, escribe *DONE*.

También acepto archivos .csv, .xlsx o .vcf de contactos.
    `.trim();

    return { reply, done: false };
  }

  return { reply: 'No entendí ese mensaje. Escribe SETUP para empezar de nuevo.', done: false };
}

async function finaliseOwnerSetup(
  ownerWhatsApp: string,
  answers: Record<string, string>
): Promise<Owner> {
  const serviceArea = answers.service_area
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean) ?? [];

  const languages = answers.languages?.toLowerCase().includes('ingl')
    ? ['es', 'en']
    : ['es'];

  const { data: owner, error } = await supabase
    .from('owners')
    .insert({
      business_name: answers.business_name,
      owner_name: answers.owner_name,
      owner_whatsapp: ownerWhatsApp,
      business_phone: ownerWhatsApp, // Placeholder — updated when Twilio number provisioned
      service_area: serviceArea,
      languages,
      pricing_notes: answers.pricing_notes,
      emergency_phone: answers.emergency_phone || null,
      booking_rules: {
        no_sundays: answers.works_sundays?.toLowerCase().startsWith('no'),
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
    const fileBuffer = await step.run('download-file', async () => {
      const { data, error } = await supabase.storage
        .from('onboarding-temp')
        .download(storage_path);
      if (error || !data) throw new Error('Failed to download file');
      return Buffer.from(await data.arrayBuffer());
    });

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
        const chatText = (fileBuffer as Buffer).toString('utf8');
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
        const csvText = (fileBuffer as Buffer).toString('utf8');
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
        const vcfText = (fileBuffer as Buffer).toString('utf8');
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
