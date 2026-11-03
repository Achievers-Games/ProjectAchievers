import nodemailer, { type Transporter } from 'nodemailer';
import { env as getEnv } from './env';

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  const env = getEnv();
  if (transporter) return transporter;

  if (!env.SMTP_HOST || !env.SMTP_PORT || !env.SMTP_USER || !env.SMTP_PASS || !env.SMTP_FROM) {
    throw new Error(
      'SMTP non configuré : SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS et SMTP_FROM requis dans .env',
    );
  }

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  });

  return transporter;
}

export interface SendMailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  from?: string;
  replyTo?: string;
}

/** Envoie un email. Retourne l'info de transport nodemailer. */
export async function sendMail(options: SendMailOptions) {
  const transporter = getTransporter();
  const env = getEnv();
  return transporter.sendMail({
    from: options.from ?? `${env.SMTP_FROM_NAME ?? 'Project Achievers'} <${env.SMTP_FROM}>`,
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: options.html,
    replyTo: options.replyTo,
  });
}

/** Vérifie que la connexion SMTP fonctionne (utile au démarrage ou pour un test). */
export async function verifySmtpConnection() {
  const transporter = getTransporter();
  await transporter.verify();
}
