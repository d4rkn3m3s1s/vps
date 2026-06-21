import { env } from '../../config/env';
import { logger } from '../../lib/logger';

export type MailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

// Minimal structural type for the nodemailer transport we use, so we never
// import nodemailer's types at module load (it's lazy-imported only when SMTP
// is configured — dev/unconfigured installs never touch it).
type Transport = { sendMail(opts: Record<string, unknown>): Promise<unknown> };

// A small ring buffer of recently sent emails. Useful in dev (and tests) to
// confirm an email "went out" without a real inbox. Never holds secrets.
export type SentRecord = { to: string; subject: string; at: string; via: 'smtp' | 'console' };
const recent: SentRecord[] = [];
const RECENT_MAX = 50;

function remember(rec: SentRecord): void {
  recent.unshift(rec);
  if (recent.length > RECENT_MAX) recent.length = RECENT_MAX;
}

export function recentEmails(): SentRecord[] {
  return recent;
}

export function isSmtpConfigured(): boolean {
  return Boolean(env.smtpHost);
}

let cachedTransport: Transport | null = null;
async function getTransport(): Promise<Transport> {
  if (cachedTransport) return cachedTransport;
  // Lazy import keeps boot fast and avoids requiring nodemailer when unused.
  const nodemailer = await import('nodemailer');
  cachedTransport = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort ?? 587,
    secure: env.smtpSecure ?? false,
    ...(env.smtpUser ? { auth: { user: env.smtpUser, pass: env.smtpPass } } : {})
  }) as unknown as Transport;
  return cachedTransport;
}

// Sends an email. With SMTP configured it delivers for real; otherwise it logs
// the message to the console (dev mode) so flows are fully testable offline.
// Never throws to the caller — email is best-effort and must not break the
// triggering action (invite, alert, etc.).
export async function sendMail(msg: MailMessage): Promise<{ delivered: boolean; via: 'smtp' | 'console' }> {
  try {
    if (isSmtpConfigured()) {
      const transport = await getTransport();
      await transport.sendMail({
        from: env.mailFrom,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html
      });
      remember({ to: msg.to, subject: msg.subject, at: new Date().toISOString(), via: 'smtp' });
      logger.info('Email sent', { to: msg.to, subject: msg.subject, via: 'smtp' });
      return { delivered: true, via: 'smtp' };
    }
    // Console transport: log a clear, readable block so the email is visible.
    logger.info('Email (console transport — SMTP not configured)', {
      to: msg.to,
      from: env.mailFrom,
      subject: msg.subject,
      text: msg.text
    });
    remember({ to: msg.to, subject: msg.subject, at: new Date().toISOString(), via: 'console' });
    return { delivered: false, via: 'console' };
  } catch (error) {
    logger.error('Email send failed', {
      to: msg.to,
      subject: msg.subject,
      error: error instanceof Error ? error.message : String(error)
    });
    return { delivered: false, via: isSmtpConfigured() ? 'smtp' : 'console' };
  }
}
