import { callClaudeJSON } from '../integrations/anthropic.js';
import { sendOwnerWhatsApp } from '../integrations/whatsapp.js';
import {
  getCustomerByName,
  updateCustomer,
} from '../db/queries/customers.js';
import { updateJob, getTodayJobs } from '../db/queries/jobs.js';
import { getOwner } from '../db/queries/owners.js';
import { eraseCustomer, exportOwnerData, handleSmsOptOut } from '../lib/gdpr.js';
import { createCalendarEvent, deleteCalendarEvent } from '../integrations/google-calendar.js';
import { inngest } from '../inngest/client.js';
import { logger } from '../lib/logger.js';
import type { Owner } from './types.js';

interface OwnerCommandResult {
  action: string;
  reply: string;
  customer_name?: string;
  date?: string;
  time?: string;
}

/**
 * Parse a free-text owner WhatsApp command using Claude,
 * then execute the appropriate action.
 */
export async function handleOwnerCommand(
  text: string,
  owner: Owner
): Promise<void> {
  logger.info({ owner_id: owner.id }, 'Owner command received');

  const result = await callClaudeJSON<OwnerCommandResult>({
    system: `You are a command parser for a pool maintenance business WhatsApp assistant.
Parse the owner's message and return the action and relevant data.

Available actions:
- book: book/confirm an appointment
- cancel: cancel a job for a customer
- note: add a note or update customer info
- paid: mark last job as paid
- follow_up: trigger manual follow-up for a customer
- forget: GDPR erasure for a customer (soft delete)
- export: GDPR data export for the owner
- pause: pause AI contact with a customer
- done: mark last scheduled job as complete
- unknown: command not recognised

Return JSON only: { "action": "...", "reply": "confirmation text", "customer_name": "...", "date": "YYYY-MM-DD", "time": "HH:MM" }`,
    messages: [{ role: 'user', content: text }],
    maxTokens: 256,
  });

  await executeOwnerCommand(result, owner, text);
}

async function executeOwnerCommand(
  cmd: OwnerCommandResult,
  owner: Owner,
  rawText: string
): Promise<void> {
  switch (cmd.action) {
    case 'done': {
      const jobs = await getTodayJobs(owner.id);
      const scheduledJob = jobs.find((j) => j.status === 'scheduled');
      if (scheduledJob) {
        await updateJob(scheduledJob.id, {
          status: 'completed',
          completed_at: new Date().toISOString(),
        });
        // Trigger Farmer review request
        await inngest.send({
          name: 'huntai/job.completed',
          data: { job_id: scheduledJob.id, owner_id: owner.id },
        });
        await sendOwnerWhatsApp(owner, {
          text: `✓ Marcado como completado. El seguimiento de valoración se enviará en 3 días.`,
        });
      } else {
        await sendOwnerWhatsApp(owner, { text: 'No hay trabajos programados para hoy.' });
      }
      break;
    }

    case 'paid': {
      const jobs = await getTodayJobs(owner.id);
      const completedJob = jobs.find((j) => j.status === 'completed');
      if (completedJob) {
        await updateJob(completedJob.id, { payment_status: 'paid' });
        await sendOwnerWhatsApp(owner, { text: `✓ Pago registrado.` });
      }
      break;
    }

    case 'forget': {
      if (cmd.customer_name) {
        const customer = await getCustomerByName(owner.id, cmd.customer_name);
        if (customer) {
          await eraseCustomer(customer.id, owner.id);
          await sendOwnerWhatsApp(owner, {
            text: `✓ Datos de ${cmd.customer_name} eliminados (GDPR Art. 17).`,
          });
        } else {
          await sendOwnerWhatsApp(owner, {
            text: `No encontré un cliente con ese nombre.`,
          });
        }
      }
      break;
    }

    case 'export': {
      const data = await exportOwnerData(owner.id);
      const json = JSON.stringify(data, null, 2);
      // For MVP: send as a text summary; Phase 2: upload to storage and send link
      await sendOwnerWhatsApp(owner, {
        text: `Tu exportación de datos GDPR está lista. ${
          Object.keys(data).length
        } categorías exportadas. Contacta soporte para recibir el archivo completo.`,
      });
      logger.info({ owner_id: owner.id, bytes: json.length }, 'GDPR export generated');
      break;
    }

    case 'pause': {
      if (cmd.customer_name) {
        const customer = await getCustomerByName(owner.id, cmd.customer_name);
        if (customer) {
          await updateCustomer(customer.id, { sms_opt_out: true });
          await sendOwnerWhatsApp(owner, {
            text: `✓ Contacto AI pausado para ${cmd.customer_name}.`,
          });
        }
      }
      break;
    }

    case 'follow_up': {
      if (cmd.customer_name) {
        const customer = await getCustomerByName(owner.id, cmd.customer_name);
        if (customer) {
          await inngest.send({
            name: 'huntai/manual.follow_up',
            data: { customer_id: customer.id, owner_id: owner.id },
          });
          await sendOwnerWhatsApp(owner, {
            text: `✓ Follow-up manual programado para ${cmd.customer_name}.`,
          });
        }
      }
      break;
    }

    case 'unknown':
    default: {
      await sendOwnerWhatsApp(owner, {
        text: `No entendí ese comando. Comandos disponibles: "done", "paid", "cancel [nombre]", "forget [nombre]", "pause [nombre]", "export my data", "follow up [nombre]".`,
      });
    }
  }
}
