// SMS verification provider — sms-bus.com.
//
// Rents a disposable phone number for a target service (whatsapp / instagram /
// facebook / ...) and polls for the OTP the service texts to it. Used by the
// account registrar.
//
// Verified against https://sms-bus.com/docs:
//   Base URL : https://sms-bus.com/api/control
//   Auth     : query param `token`
//   Responses: JSON  { code: 200, message: "...", data: ... }
//
// Configure via env:
//   SMS_BUS_API_KEY   the API token (also accepted per-call)
//   SMS_BUS_BASE_URL  override base (default https://sms-bus.com/api/control)

const DEFAULT_BASE = 'https://sms-bus.com/api/control';

export type SmsProviderConfig = {
  apiKey: string;
  baseUrl?: string | undefined;
};

export type SmsCountry = { id: number | string; title: string; code: string };
export type SmsProject = { id: number | string; title: string; code: string };

export type RentedNumber = {
  requestId: string; // request_id used to poll + cancel + reuse
  number: string; // the rented phone number
  raw?: unknown;
};

export type OtpResult =
  | { status: 'waiting' }
  | { status: 'received'; code: string };

type ApiEnvelope<T> = { code: number; message: string; data: T };

async function api<T>(cfg: SmsProviderConfig, path: string, params: Record<string, string> = {}): Promise<T> {
  const base = (cfg.baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
  const qs = new URLSearchParams({ token: cfg.apiKey, ...params }).toString();
  const url = `${base}${path}?${qs}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();
    let body: ApiEnvelope<T>;
    try {
      body = JSON.parse(text) as ApiEnvelope<T>;
    } catch {
      throw new Error(`sms-bus ${path} non-JSON (${res.status}): ${text.slice(0, 200)}`);
    }
    if (!res.ok || body.code !== 200) {
      throw new Error(`sms-bus ${path} -> ${body.code} ${body.message || text.slice(0, 200)}`);
    }
    return body.data;
  } finally {
    clearTimeout(timer);
  }
}

// Cheap call to validate the token works. Returns { balance, frozen }.
export async function getBalance(cfg: SmsProviderConfig): Promise<{ balance: number; frozen: number }> {
  return api<{ balance: number; frozen: number }>(cfg, '/get/balance');
}

// List available countries (id + code like "us") and services/projects (id +
// code like "tg"/"pp"). The registrar resolves a friendly service name to a
// project_id via these listings — sms-bus uses numeric ids, not short codes,
// in /get/number.
//
// NOTE: sms-bus returns these as an OBJECT keyed by id ({"5":{...},"13":{...}}),
// NOT a JSON array — so we normalise to an array here.
function toArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object') return Object.values(data as Record<string, T>);
  return [];
}

export async function listCountries(cfg: SmsProviderConfig): Promise<SmsCountry[]> {
  const data = await api<unknown>(cfg, '/list/countries');
  return toArray<SmsCountry>(data).sort((a, b) => String(a.title).localeCompare(String(b.title)));
}

export async function listProjects(cfg: SmsProviderConfig): Promise<SmsProject[]> {
  const data = await api<unknown>(cfg, '/list/projects');
  return toArray<SmsProject>(data).sort((a, b) => String(a.title).localeCompare(String(b.title)));
}

// Rent a number for a service in a country. Both ids come from the listings
// above (numeric). `reuse` keeps the number eligible for re-renting later.
export async function getNumber(
  cfg: SmsProviderConfig,
  countryId: string | number,
  projectId: string | number,
  opts?: { reuse?: boolean; referId?: string }
): Promise<RentedNumber> {
  const data = await api<{ request_id: number | string; number: string }>(cfg, '/get/number', {
    country_id: String(countryId),
    project_id: String(projectId),
    ...(opts?.reuse ? { reuse: 'true' } : {}),
    ...(opts?.referId ? { refer_id: opts.referId } : {})
  });
  return { requestId: String(data.request_id), number: String(data.number), raw: data };
}

// Poll for the OTP. data is the code string once it arrives; until then the API
// returns a non-200 / empty data which we surface as "waiting".
export async function getSms(cfg: SmsProviderConfig, requestId: string): Promise<OtpResult> {
  try {
    const data = await api<string>(cfg, '/get/sms', { request_id: requestId });
    if (data && String(data).trim()) return { status: 'received', code: String(data).trim() };
    return { status: 'waiting' };
  } catch {
    // sms-bus returns a non-200 envelope while the SMS hasn't arrived yet.
    return { status: 'waiting' };
  }
}

// Cancel a pending number request (releases it; usually refunds if no SMS yet).
export async function cancelNumber(cfg: SmsProviderConfig, requestId: string): Promise<void> {
  await api<unknown>(cfg, '/cancel', { request_id: requestId });
}

// Re-rent a previously used number for another service.
export async function reuseNumber(
  cfg: SmsProviderConfig,
  countryId: string | number,
  projectId: string | number,
  mobileNumber: string,
  referId?: string
): Promise<RentedNumber> {
  const data = await api<{ request_id: number | string; number: string }>(cfg, '/reuse', {
    country_id: String(countryId),
    project_id: String(projectId),
    mobile_number: mobileNumber,
    ...(referId ? { refer_id: referId } : {})
  });
  return { requestId: String(data.request_id), number: String(data.number), raw: data };
}
