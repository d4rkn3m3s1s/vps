// Account registrar service — orchestrates the external providers used to spin
// up fresh social accounts:
//   • SMS  (sms-bus.com)        — disposable phone numbers + OTP
//   • Mail (catchmail.io)       — disposable inbox + verification mail
//   • Identity (randomuser.me)  — name / address / DOB / gender
//
// Phase 1 (this file) exposes the provider operations as thin, typed service
// methods so the dashboard can test connectivity and pull a number / read an
// OTP / fetch a verification mail / generate an identity. The on-device
// registration flow (RPA) is built on top of these later.

import * as sms from './providers/sms.provider';
import * as mail from './providers/mail.provider';
import * as identity from './providers/identity.provider';

function smsCfg(): sms.SmsProviderConfig {
  const apiKey = process.env.SMS_BUS_API_KEY || '';
  return { apiKey, ...(process.env.SMS_BUS_BASE_URL ? { baseUrl: process.env.SMS_BUS_BASE_URL } : {}) };
}

function mailCfg(): mail.MailProviderConfig {
  // Provider: 'inbucket' for a self-hosted catch-all, else default catchmail SaaS.
  const provider = (process.env.MAIL_PROVIDER ?? process.env.CATCHMAIL_PROVIDER ?? '').toLowerCase();
  return {
    ...(provider === 'inbucket' ? { provider: 'inbucket' as const } : {}),
    ...(process.env.CATCHMAIL_BASE_URL ? { baseUrl: process.env.CATCHMAIL_BASE_URL } : {}),
    ...(process.env.CATCHMAIL_DOMAIN ? { domain: process.env.CATCHMAIL_DOMAIN } : {}),
    ...(process.env.CATCHMAIL_API_KEY ? { apiKey: process.env.CATCHMAIL_API_KEY } : {})
  };
}

function identityCfg(): identity.IdentityProviderConfig {
  return { ...(process.env.IDENTITY_BASE_URL ? { baseUrl: process.env.IDENTITY_BASE_URL } : {}) };
}

export class AccountsService {
  // ── Provider health: a single call to confirm credentials/connectivity. ────
  async providerStatus(): Promise<{
    sms: { ok: boolean; detail: string };
    mail: { ok: boolean; detail: string };
    identity: { ok: boolean; detail: string };
  }> {
    const cfg = smsCfg();
    const smsStatus = cfg.apiKey
      ? await sms
          .getBalance(cfg)
          .then((b) => ({ ok: true, detail: `bakiye ${b.balance}` }))
          .catch((e: Error) => ({ ok: false, detail: e.message }))
      : { ok: false, detail: 'SMS_BUS_API_KEY tanımlı değil' };

    const mailStatus = await mail
      .listMessages(mailCfg(), mail.makeAddress(mailCfg(), 'healthcheck'))
      .then(() => ({ ok: true, detail: 'erişilebilir' }))
      .catch((e: Error) => ({ ok: false, detail: e.message }));

    // Identity is offline-first (local generator) so it is always available;
    // the detail notes whether a network source is also configured.
    const idStatus = await identity
      .generateIdentity(identityCfg())
      .then((id) => ({
        ok: true,
        detail: id.source === 'network' ? 'çevrimiçi kaynak' : 'yerel üretici (çevrimdışı)'
      }))
      .catch(() => ({ ok: true, detail: 'yerel üretici (çevrimdışı)' }));

    return { sms: smsStatus, mail: mailStatus, identity: idStatus };
  }

  // ── SMS ────────────────────────────────────────────────────────────────────
  async smsBalance() {
    return sms.getBalance(smsCfg());
  }
  async smsCountries() {
    return sms.listCountries(smsCfg());
  }
  async smsProjects() {
    return sms.listProjects(smsCfg());
  }
  async smsGetNumber(countryId: string | number, projectId: string | number, reuse?: boolean) {
    return sms.getNumber(smsCfg(), countryId, projectId, reuse ? { reuse } : {});
  }
  async smsReadOtp(requestId: string) {
    return sms.getSms(smsCfg(), requestId);
  }
  async smsCancel(requestId: string) {
    await sms.cancelNumber(smsCfg(), requestId);
    return { cancelled: true };
  }

  // ── Mail ─────────────────────────────────────────────────────────────────
  // Mint a disposable inbox. `seed` (optional) lets the caller derive a stable
  // address; otherwise a timestamp-free token must be supplied by the caller.
  makeInbox(seed: string) {
    return { address: mail.makeAddress(mailCfg(), seed) };
  }
  async mailInbox(address: string) {
    return mail.listMessages(mailCfg(), address);
  }
  async mailMessage(address: string, id: string) {
    const msg = await mail.getMessage(mailCfg(), address, id);
    const body = msg.text || msg.html;
    return { ...msg, code: mail.extractCode(body), link: mail.extractLink(body) };
  }

  // ── Identity ─────────────────────────────────────────────────────────────
  async generateIdentity(country?: string, gender?: 'male' | 'female') {
    return identity.generateIdentity(identityCfg(), {
      ...(country ? { country } : {}),
      ...(gender ? { gender } : {})
    });
  }
}

export const accountsService = new AccountsService();
