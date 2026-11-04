import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { m } from '#lib/paraglide/messages';
import { sendMail } from '#lib/server/email';
import { env } from '#lib/server/env';
import { rateLimit } from '#lib/server/rate-limit';
import { logger } from '#lib/logger';
import type { Actions, PageServerLoad } from './$types';

const log = logger('Contact');

const PER_HOUR = 3;

const contact = z.object({
  name: z
    .string()
    .trim()
    .min(2, { error: () => m.contact_name_short() })
    .max(80),
  email: z.email({ error: () => m.contact_email_invalid() }).max(200),
  subject: z.string().trim().max(120).optional(),
  message: z
    .string()
    .trim()
    .min(20, { error: () => m.too_short() })
    .max(4_000),
  // Champ piège invisible : rempli uniquement par les robots.
  website: z.string().optional(),
});

/** Adresse qui reçoit les messages : CONTACT_INBOX, sinon l'expéditeur configuré. */
function inbox(): string | undefined {
  return env().CONTACT_INBOX ?? env().SMTP_FROM;
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const load: PageServerLoad = async () => {
  const config = env();
  const smtpReady = Boolean(
    config.SMTP_HOST && config.SMTP_PORT && config.SMTP_USER && config.SMTP_PASS && inbox(),
  );
  return { available: smtpReady };
};

export const actions: Actions = {
  send: async ({ request, getClientAddress }) => {
    const form = Object.fromEntries(await request.formData());
    if (typeof form.website === 'string' && form.website.trim()) {
      // Robot : on ne fait rien, mais on répond comme si le message était parti.
      return { success: m.contact_sent() };
    }

    const parsed = contact.safeParse(form);
    if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message });

    const to = inbox();
    if (!to) return fail(503, { error: m.contact_unavailable() });

    let ip = 'unknown';
    try {
      ip = getClientAddress();
    } catch {
      // Adresse indisponible : la limite reste appliquée sous la clé partagée.
    }
    if (!rateLimit(`contact:${ip}`, PER_HOUR, 3_600_000)) {
      return fail(429, { error: m.too_fast() });
    }

    const { name, email, subject, message } = parsed.data;
    const subjectLine = (subject || 'Sans sujet').replace(/[\r\n]+/g, ' ');
    const cleanName = name.replace(/[\r\n]+/g, ' ');
    const body = `${message}\n\n— ${cleanName} <${email}>`;

    try {
      await sendMail({
        to,
        replyTo: email,
        subject: `[Contact] ${subjectLine} — ${cleanName}`,
        text: body,
        html: `<p>${escapeHtml(message).replace(/\n/g, '<br>')}</p><p>— ${escapeHtml(cleanName)} &lt;${escapeHtml(email)}&gt;</p>`,
      });
    } catch (error) {
      log.error('contact: envoi impossible', error);
      return fail(503, { error: m.contact_unavailable() });
    }

    return { success: m.contact_sent() };
  },
};
