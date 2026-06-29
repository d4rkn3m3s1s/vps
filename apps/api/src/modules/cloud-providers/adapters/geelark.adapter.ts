// GeeLark cloud-phone adapter — production implementation.
//
// GeeLark Open API: https://openapi.geelark.com/open/v1
// Spec verified against github.com/GeeLark/geelark-openapi
// (docs/en/openapi.yaml + Request_Instructions.md).
//
// Transport facts:
//   - ALL endpoints are POST with Content-Type: application/json.
//   - Response envelope is ALWAYS { traceId, code, msg, data }; code 0 = success.
//     Any non-zero code is an error — we surface the vendor `msg`.
//   - Rate limit: 200/min, 24000/hr (not enforced here; caller paces).
//
// Auth — two modes:
//   KEY mode (primary): headers appId, traceId, ts, nonce, sign where
//       traceId = UUID v4
//       ts      = millisecond timestamp (string)
//       nonce   = first 6 chars of traceId
//       sign    = SHA256(appId + traceId + ts + nonce + apiKey) -> UPPERCASE hex
//   BEARER mode (fallback): headers Authorization: Bearer <token>, traceId.
//
// Credential mapping (documented for the dashboard hint):
//   creds.apiKey    = GeeLark apiKey   (Team API Key)
//   creds.apiSecret = GeeLark appId    (Team App ID)
// If apiSecret (appId) is empty we fall back to Bearer mode, treating apiKey as
// the bearer token. KEY mode requires BOTH apiKey and appId.
//
// Honesty: we never fake success. Unsupported ops throw NotSupportedError, and
// the async screenshot endpoint reports its taskId rather than inventing pixels.

import { createHash, randomUUID } from 'node:crypto';

import type {
  CloudProviderAdapter, CreatePhoneInput, ProviderCreds, ProxyConfig, RemotePhone
} from './types';
import { NotSupportedError } from './types';

const DEFAULT_BASE = 'https://openapi.geelark.com/open/v1';

// GeeLark phone status codes (from /phone/list + /phone/status).
//   0 = stopped, 1 = starting, 2 = running.
function mapStatus(code: number | undefined): RemotePhone['status'] {
  switch (code) {
    case 2: return 'ONLINE';
    case 1: return 'STARTING';
    case 0: return 'OFFLINE';
    default: return 'UNKNOWN';
  }
}

// Standard GeeLark response envelope.
type Envelope<T> = { traceId?: string; code?: number; msg?: string; data?: T };

type PhoneListItem = {
  id: string;
  serialName?: string;
  serialNo?: string;
  status?: number;
  proxy?: unknown;
  group?: unknown;
};

type BatchDetail = { id?: string; code?: number; msg?: string; url?: string };

export class GeeLarkAdapter implements CloudProviderAdapter {
  readonly kind = 'GEELARK';
  private base: string;
  private apiKey: string;   // GeeLark Team API Key
  private appId: string;    // GeeLark Team App ID (creds.apiSecret)

  constructor(creds: ProviderCreds) {
    this.base = (creds.baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
    this.apiKey = creds.apiKey || '';
    this.appId = creds.apiSecret || '';
  }

  // KEY mode needs the apiKey; BEARER fallback also needs the apiKey (as token).
  // Either way a missing apiKey is fatal.
  private ensureKey(): void {
    if (!this.apiKey) {
      throw new Error('GeeLark API anahtarı yapılandırılmamış (Sağlayıcılar sayfasından ekleyin: apiKey = GeeLark API Key, apiSecret = GeeLark App ID).');
    }
  }

  // Build the auth headers for one request. KEY mode when appId is present,
  // otherwise BEARER mode. traceId is generated fresh per call.
  private authHeaders(): Record<string, string> {
    const traceId = randomUUID();
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      traceId
    };
    if (this.appId) {
      // KEY mode. Signature is the #1 failure point — compute EXACTLY:
      //   sign = SHA256(appId + traceId + ts + nonce + apiKey).toUpperCase()
      //   nonce = first 6 chars of traceId, ts = ms timestamp as string.
      const ts = Date.now().toString();
      const nonce = traceId.slice(0, 6);
      const sign = createHash('sha256')
        .update(this.appId + traceId + ts + nonce + this.apiKey)
        .digest('hex')
        .toUpperCase();
      headers.appId = this.appId;
      headers.ts = ts;
      headers.nonce = nonce;
      headers.sign = sign;
    } else {
      // BEARER fallback — apiKey is the token.
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  // Signed POST helper. Throws on transport error, non-2xx, or non-zero
  // envelope code (surfacing the vendor msg, truncated to 200 chars).
  private async call<T>(path: string, body: unknown): Promise<T> {
    this.ensureKey();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(`${this.base}${path}`, {
        method: 'POST',
        signal: controller.signal,
        headers: this.authHeaders(),
        body: JSON.stringify(body ?? {})
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`GeeLark ${path} → HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      let env: Envelope<T>;
      try {
        env = (text ? JSON.parse(text) : {}) as Envelope<T>;
      } catch {
        throw new Error(`GeeLark ${path} → geçersiz yanıt: ${text.slice(0, 200)}`);
      }
      if (env.code !== 0) {
        const msg = (env.msg || 'bilinmeyen hata').slice(0, 200);
        throw new Error(`GeeLark ${path} → code ${env.code ?? '?'}: ${msg}`);
      }
      return (env.data ?? ({} as T));
    } finally {
      clearTimeout(timer);
    }
  }

  // For a batch endpoint that wraps one id, assert the single result succeeded.
  private assertBatchOk(path: string, externalId: string, data: { successDetails?: BatchDetail[]; failDetails?: BatchDetail[] }): void {
    const fail = (data.failDetails ?? []).find((d) => d.id === externalId) ?? (data.failDetails ?? [])[0];
    if (fail) {
      throw new Error(`GeeLark ${path} → ${externalId} başarısız (code ${fail.code ?? '?'}): ${(fail.msg || '').slice(0, 200)}`);
    }
  }

  async check(): Promise<{ ok: boolean; detail: string }> {
    try {
      this.ensureKey();
      await this.call<{ total?: number }>('/phone/list', { page: 1, pageSize: 1 });
      return { ok: true, detail: this.appId ? 'GeeLark erişilebilir (KEY modu)' : 'GeeLark erişilebilir (Bearer modu)' };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }

  async listPhones(): Promise<RemotePhone[]> {
    const data = await this.call<{ total?: number; items?: PhoneListItem[] }>(
      '/phone/list', { page: 1, pageSize: 100 }
    );
    return (data.items ?? []).map((p) => {
      const name = p.serialName || p.serialNo || p.id;
      return {
        externalId: p.id,
        name,
        status: mapStatus(p.status)
      } satisfies RemotePhone;
    });
  }

  async createPhone(input: CreatePhoneInput): Promise<RemotePhone> {
    // /phone/addNew creates one or more phones from a `data[]` array of profiles.
    // mobileType expects a human label like "Android 13"; we derive it from the
    // requested androidVersion, defaulting to "Android 13".
    const mobileType = input.androidVersion
      ? (/^android/i.test(input.androidVersion) ? input.androidVersion : `Android ${input.androidVersion}`)
      : 'Android 13';
    const data = await this.call<{ details?: Array<{ index?: number; code?: number; msg?: string; id?: string; profileName?: string }> }>(
      '/phone/addNew',
      {
        mobileType,
        chargeMode: 0,
        ...(input.region ? { region: input.region } : {}),
        data: [{ profileName: input.name }]
      }
    );
    const detail = (data.details ?? [])[0];
    if (!detail || detail.code !== 0 || !detail.id) {
      const msg = (detail?.msg || 'oluşturma başarısız').slice(0, 200);
      throw new Error(`GeeLark /phone/addNew → code ${detail?.code ?? '?'}: ${msg}`);
    }
    return {
      externalId: detail.id,
      name: detail.profileName || input.name,
      status: 'OFFLINE', // newly created phones start stopped; caller starts them
      ...(input.androidVersion ? { androidVersion: input.androidVersion } : {}),
      ...(input.region ? { region: input.region } : {})
    };
  }

  async startPhone(externalId: string): Promise<void> {
    const data = await this.call<{ successDetails?: BatchDetail[]; failDetails?: BatchDetail[] }>(
      '/phone/start', { ids: [externalId] }
    );
    this.assertBatchOk('/phone/start', externalId, data);
  }

  async stopPhone(externalId: string): Promise<void> {
    const data = await this.call<{ successDetails?: BatchDetail[]; failDetails?: BatchDetail[] }>(
      '/phone/stop', { ids: [externalId] }
    );
    this.assertBatchOk('/phone/stop', externalId, data);
  }

  // GeeLark has no dedicated restart endpoint — reboot = stop then start.
  async rebootPhone(externalId: string): Promise<void> {
    await this.stopPhone(externalId);
    await this.startPhone(externalId);
  }

  async deletePhone(externalId: string): Promise<void> {
    await this.call('/phone/delete', { ids: [externalId] });
  }

  async installApp(externalId: string, apkUrlOrPackage: string): Promise<void> {
    // packageUrl accepts an APK url or a Play Store url.
    await this.call('/phone/app/install', { id: externalId, packageUrl: apkUrlOrPackage });
  }

  async runShell(externalId: string, command: string): Promise<{ output: string }> {
    const data = await this.call<{ output?: string }>(
      '/phone/shell/execute', { id: externalId, command }
    );
    return { output: data.output ?? '' };
  }

  async setProxy(externalId: string, proxy: ProxyConfig | null): Promise<void> {
    if (!proxy) {
      // Clearing the proxy — send an empty proxyInformation string.
      await this.call('/phone/network', { id: externalId, proxyInformation: '', proxyQueryChannel: '' });
      return;
    }
    // proxyInformation is a single string per docs. Encode as
    // type://[user:pass@]host:port (a widely understood proxy URI form).
    const scheme = proxy.type.toLowerCase(); // http | https | socks5
    const auth = proxy.username
      ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password ?? '')}@`
      : '';
    const proxyInformation = `${scheme}://${auth}${proxy.host}:${proxy.port}`;
    await this.call('/phone/network', {
      id: externalId,
      proxyInformation,
      proxyQueryChannel: ''
    });
  }

  async screenshot(externalId: string): Promise<{ base64: string; mime: string }> {
    // GeeLark's screenshot is ASYNC: /phone/screenshot returns a taskId, not an
    // image, and there is no documented synchronous result endpoint that returns
    // base64 pixels. Rather than fabricate an image, we kick the task and report
    // the taskId via NotSupportedError so the caller/UI can disable the inline
    // preview for this provider.
    const data = await this.call<{ taskId?: string }>('/phone/screenshot', { id: externalId });
    const taskId = data.taskId ?? '(bilinmiyor)';
    const err = new NotSupportedError('screenshot', 'GeeLark');
    err.message = `${err.message} — ekran görüntüsü asenkron çalışır (taskId=${taskId}); senkron görüntü uç noktası yok.`;
    throw err;
  }
}
