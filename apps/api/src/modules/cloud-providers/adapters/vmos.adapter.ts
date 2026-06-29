// VMOS Cloud cloud-phone adapter — production implementation.
//
// VMOS Cloud Open API: https://api.vmoscloud.com
// Spec verified against cloud.vmoscloud.com/vmoscloud/doc/en/server/* (V2
// simplified signature + padApi endpoints).
//
// Transport facts:
//   - ALL endpoints are POST with Content-Type: application/json.
//   - Response envelope is { code, msg, data, ts, traceId }; code 200 = success.
//   - Devices are addressed by `padCode`; most ops are BATCH via `padCodes[]`.
//
// Auth — "V2 simplified signature":
//   Headers: X-Access-Key (accessKey), X-Timestamp (unix SECONDS, 10-digit),
//            X-Sign (64-char LOWERCASE hex), Content-Type: application/json
//   signString = secretKey + X-Timestamp + path + rawBody   (no delimiters)
//   X-Sign = lowerHex( SHA256( signString ) )
//   CRITICAL: the EXACT same rawBody string that is signed must be the one sent
//   (byte-identical) — so we JSON.stringify once and reuse it for both.
//
// Credential mapping (for the dashboard hint):
//   creds.apiKey    = VMOS Access Key
//   creds.apiSecret = VMOS Secret Key
//
// Honesty: VMOS pads are always-on and the simplified API exposes no power-on/off
// or create/delete in the documented surface, so those ops throw NotSupportedError
// rather than faking success. reboot maps to /restart; reset (wipe) is NOT abused
// for stop/delete. Shell is async (asyncCmd) — we surface the task payload.

import { createHash } from 'node:crypto';

import type {
  CloudProviderAdapter, CreatePhoneInput, ProviderCreds, ProxyConfig, RemotePhone
} from './types';
import { NotSupportedError } from './types';

const DEFAULT_BASE = 'https://api.vmoscloud.com';

// VMOS pad status: `online` (0/1) is the reliable signal; padStatus is a numeric
// lifecycle code whose values aren't fully enumerated in the public docs, so we
// stay conservative — online===1 → ONLINE, otherwise UNKNOWN.
function mapStatus(online: number | undefined, _padStatus: number | undefined): RemotePhone['status'] {
  if (online === 1) return 'ONLINE';
  if (online === 0) return 'OFFLINE';
  return 'UNKNOWN';
}

type Envelope<T> = { code?: number; msg?: string; data?: T; ts?: number; traceId?: string };

type PadRecord = {
  padCode: string;
  padStatus?: number;
  online?: number;
  // Tolerant name fallbacks (the list payload's label field name varies by plan).
  padName?: string;
  name?: string;
  goodName?: string;
  romVersion?: string;
};

export class VmosAdapter implements CloudProviderAdapter {
  readonly kind = 'VMOS';
  private base: string;
  private accessKey: string;
  private secretKey: string;

  constructor(creds: ProviderCreds) {
    this.base = (creds.baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
    this.accessKey = creds.apiKey || '';
    this.secretKey = creds.apiSecret || '';
  }

  private ensureKey(): void {
    if (!this.accessKey || !this.secretKey) {
      throw new Error('VMOS anahtarları eksik (Sağlayıcılar sayfasından ekleyin: apiKey = Access Key, apiSecret = Secret Key).');
    }
  }

  // Signed POST. `path` must be the full path used in the signature (e.g.
  // /vcpcloud/api/padApi/userPadList). The body is stringified ONCE and reused
  // for both signing and transmission so the bytes are identical.
  private async call<T>(path: string, body: unknown): Promise<T> {
    this.ensureKey();
    const rawBody = JSON.stringify(body ?? {});
    const ts = Math.floor(Date.now() / 1000).toString(); // unix seconds, 10-digit
    const sign = createHash('sha256')
      .update(this.secretKey + ts + path + rawBody)
      .digest('hex'); // lowercase hex

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(`${this.base}${path}`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Access-Key': this.accessKey,
          'X-Timestamp': ts,
          'X-Sign': sign
        },
        body: rawBody
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`VMOS ${path} → HTTP ${res.status}: ${text.slice(0, 200)}`);
      let env: Envelope<T>;
      try {
        env = (text ? JSON.parse(text) : {}) as Envelope<T>;
      } catch {
        throw new Error(`VMOS ${path} → geçersiz yanıt: ${text.slice(0, 200)}`);
      }
      if (env.code !== 200) {
        throw new Error(`VMOS ${path} → code ${env.code ?? '?'}: ${(env.msg || 'bilinmeyen hata').slice(0, 200)}`);
      }
      return (env.data ?? ({} as T));
    } finally {
      clearTimeout(timer);
    }
  }

  async check(): Promise<{ ok: boolean; detail: string }> {
    try {
      this.ensureKey();
      await this.call<{ pageData?: PadRecord[] }>('/vcpcloud/api/padApi/userPadList', { rows: 1 });
      return { ok: true, detail: 'VMOS erişilebilir' };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }

  async listPhones(): Promise<RemotePhone[]> {
    const data = await this.call<{ pageData?: PadRecord[] }>(
      '/vcpcloud/api/padApi/userPadList', { rows: 200 }
    );
    return (data.pageData ?? []).map((p) => {
      const name = p.padName || p.name || p.goodName || p.padCode;
      return {
        externalId: p.padCode,
        name,
        status: mapStatus(p.online, p.padStatus),
        ...(p.romVersion ? { androidVersion: p.romVersion } : {})
      } satisfies RemotePhone;
    });
  }

  // VMOS provisions pads via order flow, not a simple API create — not exposed in
  // the documented surface, so we don't fake it.
  async createPhone(_input: CreatePhoneInput): Promise<RemotePhone> {
    throw new NotSupportedError('createPhone', 'VMOS');
  }

  // Pads are always-on; there is no documented power-on endpoint. Treat start as a
  // satisfied no-op (the pad is already running) rather than erroring the UI.
  async startPhone(_externalId: string): Promise<void> {
    return;
  }

  // No documented power-off endpoint (pads are persistent). Be honest.
  async stopPhone(_externalId: string): Promise<void> {
    throw new NotSupportedError('stopPhone', 'VMOS');
  }

  async rebootPhone(externalId: string): Promise<void> {
    await this.call('/vcpcloud/api/padApi/restart', { padCodes: [externalId] });
  }

  // /reset is a data WIPE, not a delete — abusing it for delete would destroy the
  // pad's data. No documented delete endpoint, so report unsupported.
  async deletePhone(_externalId: string): Promise<void> {
    throw new NotSupportedError('deletePhone', 'VMOS');
  }

  async installApp(externalId: string, apkUrlOrPackage: string): Promise<void> {
    // installApp accepts a package name or a download url depending on the plan;
    // send both-friendly fields. autoInstall=1 installs immediately.
    const isUrl = /^https?:\/\//i.test(apkUrlOrPackage);
    await this.call('/vcpcloud/api/padApi/installApp', {
      padCodes: [externalId],
      autoInstall: 1,
      ...(isUrl ? { url: apkUrlOrPackage } : { packageName: apkUrlOrPackage })
    });
  }

  // Shell runs asynchronously (asyncCmd) — there is no synchronous stdout. We
  // submit the command and return the task acknowledgement so the caller knows it
  // was queued, without fabricating command output.
  async runShell(externalId: string, command: string): Promise<{ output: string }> {
    const data = await this.call<unknown>('/vcpcloud/api/padApi/asyncCmd', {
      padCodes: [externalId],
      scriptContent: command
    });
    return { output: `[async] komut kuyruğa alındı: ${JSON.stringify(data).slice(0, 300)}` };
  }

  async setProxy(externalId: string, proxy: ProxyConfig | null): Promise<void> {
    if (!proxy) {
      await this.call('/vcpcloud/api/padApi/setProxy', { padCodes: [externalId], enable: false });
      return;
    }
    await this.call('/vcpcloud/api/padApi/setProxy', {
      padCodes: [externalId],
      enable: true,
      type: proxy.type,
      ip: proxy.host,
      port: proxy.port,
      ...(proxy.username ? { user: proxy.username } : {}),
      ...(proxy.password ? { pwd: proxy.password } : {})
    });
  }

  async screenshot(externalId: string): Promise<{ base64: string; mime: string }> {
    // Returns an image reference/url or a task — not guaranteed inline base64. If
    // the response carries inline image bytes we use them; otherwise we report it
    // as unsupported for the inline preview rather than inventing pixels.
    const data = await this.call<{ image?: string; url?: string }>(
      '/vcpcloud/api/padApi/screenshot', { padCodes: [externalId], rotation: 0 }
    );
    if (data.image) return { base64: data.image, mime: 'image/jpeg' };
    const err = new NotSupportedError('screenshot', 'VMOS');
    if (data.url) err.message = `${err.message} — ekran görüntüsü URL döndürür: ${data.url}`;
    throw err;
  }
}
