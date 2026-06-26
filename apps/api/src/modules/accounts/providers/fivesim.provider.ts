// SMS verification provider — 5sim.net.
//
// An alternative to sms-bus with notably better WhatsApp OTP delivery (sms-bus's
// public WhatsApp numbers are burned and never receive the code). Same shape as
// sms.provider so the registrar can swap providers behind one interface.
//
// Verified against https://5sim.net/docs:
//   Base URL : https://5sim.net/v1
//   Auth     : Bearer <apiKey>
//   Buy      : GET /user/buy/activation/{country}/{operator}/{product}
//   Check    : GET /user/check/{id}  → sms[].code once delivered
//   Cancel   : GET /user/cancel/{id}
//   Balance  : GET /user/profile     → { balance }
//
// Configure via env:
//   FIVESIM_API_KEY   the API token (also accepted per-call)

import type { RentedNumber, OtpResult } from './sms.provider';

const DEFAULT_BASE = 'https://5sim.net/v1';

export type FiveSimConfig = {
  apiKey: string;
  baseUrl?: string | undefined;
};

async function api<T>(cfg: FiveSimConfig, path: string): Promise<T> {
  const base = (cfg.baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(`${base}${path}`, {
      headers: { Authorization: `Bearer ${cfg.apiKey}`, Accept: 'application/json' },
      signal: controller.signal
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`5sim ${path} -> ${res.status} ${text.slice(0, 200)}`);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`5sim ${path} non-JSON (${res.status}): ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

// Account balance, to validate the token + show funds in the dashboard panel.
export async function getBalance(cfg: FiveSimConfig): Promise<{ balance: number }> {
  const data = await api<{ balance: number }>(cfg, '/user/profile');
  return { balance: Number(data.balance) || 0 };
}

// Buy a number for a product (e.g. "whatsapp") in a country (e.g. "usa"). 5sim
// uses lowercase country slugs and "any" operator by default. Returns the rented
// number + the activation id used to poll/cancel.
export async function getNumber(
  cfg: FiveSimConfig,
  country: string,
  product: string,
  operator = 'any'
): Promise<RentedNumber> {
  const data = await api<{ id: number | string; phone: string }>(
    cfg,
    `/user/buy/activation/${encodeURIComponent(country)}/${encodeURIComponent(operator)}/${encodeURIComponent(product)}`
  );
  // 5sim returns the phone WITH a leading "+"; strip it so it matches sms-bus's
  // bare-digits format used downstream (the registrar re-adds "+").
  const number = String(data.phone || '').replace(/^\+/, '');
  return { requestId: String(data.id), number, raw: data };
}

// Poll for the OTP. 5sim returns an order object whose `sms` array fills once the
// code arrives; each entry has a parsed `code`.
export async function getSms(cfg: FiveSimConfig, requestId: string): Promise<OtpResult> {
  try {
    const data = await api<{ status: string; sms: Array<{ code?: string; text?: string }> }>(
      cfg,
      `/user/check/${encodeURIComponent(requestId)}`
    );
    const hit = (data.sms || []).find((s) => s.code || s.text);
    const code = hit?.code || (hit?.text ? (hit.text.match(/\b(\d{4,8})\b/)?.[1] ?? '') : '');
    if (code) return { status: 'received', code: String(code).trim() };
    return { status: 'waiting' };
  } catch {
    return { status: 'waiting' };
  }
}

// Release a pending activation (refunds if no SMS yet).
export async function cancelNumber(cfg: FiveSimConfig, requestId: string): Promise<void> {
  await api<unknown>(cfg, `/user/cancel/${encodeURIComponent(requestId)}`).catch(() => undefined);
}
