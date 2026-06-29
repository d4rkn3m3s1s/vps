// Temporary email provider — catchmail.io (SaaS) OR a self-hosted Inbucket.
//
// Provides a disposable inbox for account email verification. Any address at the
// configured domain works without pre-creation, so "creating" an address is just
// minting a random local part locally; we then poll the mailbox for the
// verification email and extract a code/link from its body.
//
// Two backends, selected by `provider`:
//   catchmail (default, SaaS):
//     Mailbox  : GET /api/v1/mailbox?address=<addr>
//     Message  : GET /api/v1/message/{id}?mailbox=<addr>
//   inbucket (self-hosted — https://github.com/inbucket/inbucket):
//     Mailbox  : GET /api/v1/mailbox/{name}            (name = local part)
//     Message  : GET /api/v1/mailbox/{name}/{id}
//   Run your own catch-all MX domain behind Inbucket → no SaaS rate limit, you
//   own the verification domain.
//
// Configure via env:
//   CATCHMAIL_PROVIDER  'catchmail' | 'inbucket'  (default catchmail; auto-set
//                       to inbucket when MAIL_PROVIDER=inbucket)
//   CATCHMAIL_BASE_URL  override base (default https://api.catchmail.io)
//   CATCHMAIL_DOMAIN    inbox domain (default catchmail.io)
//   CATCHMAIL_API_KEY   optional, for higher rate limits (sent as token)

const DEFAULT_BASE = 'https://api.catchmail.io';
const DEFAULT_DOMAIN = 'catchmail.io';

export type MailProvider = 'catchmail' | 'inbucket';

export type MailProviderConfig = {
  provider?: MailProvider | undefined;
  baseUrl?: string | undefined;
  domain?: string | undefined;
  apiKey?: string | undefined;
};

// The local part of an address (inbucket addresses inboxes by name, not full addr).
function localPart(address: string): string {
  return address.split('@')[0] || address;
}

export type MailSummary = {
  id: string;
  from: string;
  subject: string;
  date: string;
};

export type MailMessage = MailSummary & {
  to: string[];
  text: string;
  html: string;
};

// Mint a fresh disposable address. No network call needed — any local part at
// the domain is a live inbox. We avoid Math.random (unavailable here) by taking
// a caller-supplied seed (e.g. a cuid) and slugging it.
export function makeAddress(cfg: MailProviderConfig, seed: string): string {
  const domain = cfg.domain || DEFAULT_DOMAIN;
  const local = seed.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24) || 'inbox';
  return `${local}@${domain}`;
}

async function api<T>(cfg: MailProviderConfig, path: string): Promise<T> {
  const base = (cfg.baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
  const url = `${base}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      ...(cfg.apiKey ? { headers: { authorization: `Bearer ${cfg.apiKey}` } } : {})
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`mail ${path} -> ${res.status} ${text.slice(0, 200)}`);
    return (text ? JSON.parse(text) : {}) as T;
  } finally {
    clearTimeout(timer);
  }
}

// List messages currently in an inbox (newest-first by date). Branches on the
// configured provider's endpoint shape.
export async function listMessages(cfg: MailProviderConfig, address: string): Promise<MailSummary[]> {
  if (cfg.provider === 'inbucket') {
    // Inbucket returns a bare array of {id, from, subject, date, ...}.
    const arr = await api<Array<{ id: string; from?: string; subject?: string; date?: string }>>(
      cfg,
      `/api/v1/mailbox/${encodeURIComponent(localPart(address))}`
    );
    const messages = (Array.isArray(arr) ? arr : []).map((m) => ({
      id: m.id,
      from: m.from ?? '',
      subject: m.subject ?? '',
      date: m.date ?? ''
    }));
    return messages.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }
  const data = await api<{ messages?: MailSummary[] }>(
    cfg,
    `/api/v1/mailbox?address=${encodeURIComponent(address)}`
  );
  const messages = Array.isArray(data.messages) ? data.messages : [];
  return messages.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

// Read one message in full (headers + text/html body).
export async function getMessage(cfg: MailProviderConfig, address: string, id: string): Promise<MailMessage> {
  if (cfg.provider === 'inbucket') {
    // Inbucket: GET /api/v1/mailbox/{name}/{id} → {from, subject, date, to[], body:{text,html}}.
    const data = await api<{
      from?: string; subject?: string; date?: string; to?: string[];
      body?: { text?: string; html?: string };
    }>(cfg, `/api/v1/mailbox/${encodeURIComponent(localPart(address))}/${encodeURIComponent(id)}`);
    return {
      id,
      from: data.from ?? '',
      subject: data.subject ?? '',
      date: data.date ?? '',
      to: Array.isArray(data.to) ? data.to : [],
      text: data.body?.text ?? '',
      html: data.body?.html ?? ''
    };
  }
  const data = await api<{
    id: string; from: string; subject: string; date: string; to?: string[];
    body?: { text?: string; html?: string };
  }>(cfg, `/api/v1/message/${encodeURIComponent(id)}?mailbox=${encodeURIComponent(address)}`);
  return {
    id: data.id,
    from: data.from ?? '',
    subject: data.subject ?? '',
    date: data.date ?? '',
    to: Array.isArray(data.to) ? data.to : [],
    text: data.body?.text ?? '',
    html: data.body?.html ?? ''
  };
}

// Pull a numeric verification code out of an email body (common 4–8 digit OTP).
export function extractCode(body: string): string | null {
  const m = body.match(/\b(\d{4,8})\b/);
  return m ? m[1]! : null;
}

// Pull the first http(s) link out of an email body (verification links).
export function extractLink(body: string): string | null {
  const m = body.match(/https?:\/\/[^\s"'<>)]+/);
  return m ? m[0] : null;
}
