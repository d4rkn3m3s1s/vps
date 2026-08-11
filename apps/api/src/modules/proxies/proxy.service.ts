import type { Proxy, ProxyType } from '@prisma/client';
import http from 'node:http';
import { prisma } from '../../db/prisma';
import { decryptString, encryptString } from '../../lib/crypto';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { createJobRecord } from '../jobs/jobs.service';
import type { JobPayload } from '../jobs/job.types';
import type { ProxyCreateInput, ProxyUpdateInput } from './proxy.types';
import { alertsService } from '../alerts/alerts.service';

// ★2026-07-26: HTTP FORWARD-proxy testi (undici'siz). Node'un yerleşik fetch'i ayrı
// undici ProxyAgent'ı dispatcher olarak kabul ETMEZ ("invalid onRequestStart method").
// ★CONNECT-tünel de İŞE YARAMADI: thordata port 5555'te CONNECT'i host'un kendi çıkışına
// yönlendiriyor (exit-IP=host datacenter-IP, YANLIŞ). curl'ün asıl yaptığı FORWARD-proxy:
// proxy'ye TAM-URL ile HTTP GET at (`GET http://api.ipify.org/... HTTP/1.1`), proxy hedefe
// KENDİ exit-IP'sinden gider → dönen IP GERÇEK proxy çıkışı. HTTP hedef (https değil) şart
// ki proxy CONNECT'e düşmesin. Zero-dep, Node built-in http. (Canlı: forward→141.98.142.4 AL✓)
function probeThroughHttpProxy(opts: {
  proxyHost: string; proxyPort: number; auth: string; timeoutMs: number;
}): Promise<string | null> {
  const { proxyHost, proxyPort, auth, timeoutMs } = opts;
  return new Promise((resolve) => {
    let done = false;
    const finish = (ip: string | null) => { if (!done) { done = true; resolve(ip); } };
    const headers: Record<string, string> = { Host: 'api.ipify.org' };
    if (auth) headers['Proxy-Authorization'] = `Basic ${Buffer.from(auth).toString('base64')}`;
    const req = http.request({
      host: proxyHost, port: proxyPort, method: 'GET',
      // Tam-URL path = forward-proxy modu (proxy hedefe KENDİ IP'sinden gider).
      path: 'http://api.ipify.org/?format=json', headers, timeout: timeoutMs
    }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        try { finish((JSON.parse(body) as { ip?: string }).ip ?? null); } catch { finish(null); }
      });
    });
    const killTimer = setTimeout(() => { req.destroy(); finish(null); }, timeoutMs);
    req.on('close', () => clearTimeout(killTimer));
    req.on('error', () => { clearTimeout(killTimer); finish(null); });
    req.on('timeout', () => { clearTimeout(killTimer); req.destroy(); finish(null); });
    req.end();
  });
}

// Public-safe proxy shape: the encrypted password is never returned; clients
// only learn whether one is set.
function toPublic(proxy: Proxy) {
  const { password, ...rest } = proxy;
  return { ...rest, hasPassword: Boolean(password) };
}

type ParsedProxy = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  type?: ProxyType;
  countryCode?: string;
  label: string;
};

// Parse one proxy line from a provider list. Supports the common formats and an
// optional ",CC" country suffix. Returns null for an unparseable line.
function parseProxyLine(raw: string): ParsedProxy | null {
  let line = raw.trim();
  if (!line) return null;

  // Optional trailing country tag: "host:port,US"
  let countryCode: string | undefined;
  const commaIdx = line.lastIndexOf(',');
  if (commaIdx !== -1) {
    const tail = line.slice(commaIdx + 1).trim();
    if (/^[A-Za-z]{2}$/.test(tail)) {
      countryCode = tail.toUpperCase();
      line = line.slice(0, commaIdx).trim();
    }
  }

  // Optional scheme.
  let type: ProxyType | undefined;
  const schemeMatch = line.match(/^(https?|socks5):\/\//i);
  if (schemeMatch) {
    const s = schemeMatch[1]!.toUpperCase();
    type = s === 'SOCKS5' ? 'SOCKS5' : s === 'HTTPS' ? 'HTTPS' : 'HTTP';
    line = line.slice(schemeMatch[0].length);
  }

  let username: string | undefined;
  let password: string | undefined;
  let hostPort = line;

  // user:pass@host:port form.
  if (line.includes('@')) {
    const [creds, hp] = line.split('@');
    const [u, p] = (creds ?? '').split(':');
    username = u || undefined;
    password = p || undefined;
    hostPort = hp ?? '';
  }

  const parts = hostPort.split(':');
  // host:port  OR  host:port:user:pass
  if (parts.length < 2) return null;
  const host = parts[0]!.trim();
  const port = Number(parts[1]);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (parts.length >= 4 && !username) {
    username = parts[2] || undefined;
    password = parts[3] || undefined;
  }

  return {
    host,
    port,
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    ...(type ? { type } : {}),
    ...(countryCode ? { countryCode } : {}),
    label: `${host}:${port}`
  };
}

export class ProxyService {
  async list(workspaceId?: string) {
    const rows = await prisma.proxy.findMany({
      where: { ...(workspaceId ? { workspaceId } : {}) },
      orderBy: { createdAt: 'desc' }
    });
    return rows.map(toPublic);
  }

  async create(input: ProxyCreateInput, workspaceId?: string) {
    const proxy = await prisma.proxy.create({
      data: {
        label: input.label,
        host: input.host,
        port: input.port,
        ...(input.type ? { type: input.type } : {}),
        ...(input.username ? { username: input.username } : {}),
        // Encrypt at rest with AES-256-GCM.
        ...(input.password ? { password: encryptString(input.password) } : {}),
        ...(input.group ? { group: input.group } : {}),
        ...(input.isp ? { isp: input.isp } : {}),
        ...(input.remarks ? { remarks: input.remarks } : {}),
        ...(input.countryCode ? { countryCode: input.countryCode } : {}),
        ...(workspaceId ? { workspaceId } : {})
      }
    });
    return toPublic(proxy);
  }

  async update(id: string, input: ProxyUpdateInput, workspaceId?: string) {
    await this.getOwned(id, workspaceId);
    const proxy = await prisma.proxy.update({
      where: { id },
      data: {
        ...(input.label ? { label: input.label } : {}),
        ...(input.type ? { type: input.type } : {}),
        ...(input.host ? { host: input.host } : {}),
        ...(typeof input.port === 'number' ? { port: input.port } : {}),
        ...(input.username !== undefined ? { username: input.username } : {}),
        ...(input.password !== undefined
          ? { password: input.password ? encryptString(input.password) : null }
          : {}),
        ...(input.group !== undefined ? { group: input.group } : {}),
        ...(input.isp !== undefined ? { isp: input.isp } : {}),
        ...(input.remarks !== undefined ? { remarks: input.remarks } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.exportIp !== undefined ? { exportIp: input.exportIp } : {}),
        ...(input.countryCode !== undefined ? { countryCode: input.countryCode } : {})
      }
    });
    return toPublic(proxy);
  }

  // Decrypts the stored password for internal use (e.g. building the proxy URL
  // when routing traffic). Never exposed over the API.
  decryptPassword(proxy: Proxy): string | null {
    return proxy.password ? decryptString(proxy.password) : null;
  }

  async remove(id: string, workspaceId?: string) {
    await this.getOwned(id, workspaceId);
    return prisma.proxy.delete({ where: { id } });
  }

  // ── Bulk import from a provider list ───────────────────────────────────────
  // Operators paste a proxy list from any provider (Bright Data, IPRoyal,
  // OwlProxy, …). We accept the ubiquitous line formats:
  //   host:port
  //   host:port:user:pass
  //   user:pass@host:port
  //   scheme://user:pass@host:port
  // plus an optional trailing ",CC" country tag. Returns created/skipped counts.
  async bulkImport(
    text: string,
    opts: { type?: ProxyType | undefined; group?: string | undefined } = {},
    workspaceId?: string
  ): Promise<{ created: number; skipped: number }> {
    // Bound the input so a giant paste can't stall the import loop (DoS guard).
    if (text.length > 500_000) {
      throw new AppError('Liste çok büyük (en fazla ~500 KB).', 400, 'IMPORT_TOO_LARGE');
    }
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 5000);
    let created = 0;
    let skipped = 0;
    for (const line of lines) {
      const parsed = parseProxyLine(line);
      if (!parsed) { skipped += 1; continue; }
      await prisma.proxy.create({
        data: {
          label: parsed.label,
          host: parsed.host,
          port: parsed.port,
          ...(opts.type ? { type: opts.type } : parsed.type ? { type: parsed.type } : {}),
          ...(parsed.username ? { username: parsed.username } : {}),
          ...(parsed.password ? { password: encryptString(parsed.password) } : {}),
          ...(opts.group ? { group: opts.group } : {}),
          ...(parsed.countryCode ? { countryCode: parsed.countryCode } : {}),
          ...(workspaceId ? { workspaceId } : {})
        }
      }).then(() => { created += 1; }).catch(() => { skipped += 1; });
    }
    return { created, skipped };
  }

  // ── Geo-matched auto-assignment ────────────────────────────────────────────
  // Pick a healthy proxy whose countryCode matches the device's fingerprint
  // country (falling back to any healthy proxy), then dispatch a SET_PROXY job.
  async autoAssignGeoMatched(deviceId: string, workspaceId?: string): Promise<{ assigned: boolean; proxyId?: string; matchedCountry?: boolean }> {
    // Tenant guard: only operate on a device in the caller's workspace, so a
    // foreign deviceId can't get a SET_PROXY job written to another tenant's phone.
    const device = await prisma.device.findFirst({
      where: { id: deviceId, ...(workspaceId ? { workspaceId } : {}) },
      include: { fingerprint: { select: { countryCode: true } } }
    });
    if (!device) throw new AppError('Device not found', 404, 'DEVICE_NOT_FOUND');
    const country = device.fingerprint?.countryCode ?? null;

    const pool = await prisma.proxy.findMany({
      where: { ...(workspaceId ? { workspaceId } : {}), status: { not: 'FAILED' } },
      // Prefer the healthiest proxy (highest score); tie-break on least-recently used.
      orderBy: [{ score: 'desc' }, { lastCheckedAt: 'asc' }]
    });
    if (pool.length === 0) return { assigned: false };

    const matched = country ? pool.filter((p) => p.countryCode === country) : [];
    const pick = (matched.length > 0 ? matched : pool)[0]!;

    await createJobRecord(
      'EMULATOR_SET_PROXY',
      { deviceId, proxyId: pick.id, host: pick.host, port: pick.port, type: pick.type } as unknown as JobPayload,
      undefined,
      workspaceId
    );
    return { assigned: true, proxyId: pick.id, matchedCountry: matched.length > 0 };
  }

  // ── Provider (country-selectable) proxies ──────────────────────────────────
  // A "provider" proxy is a residential account whose exit COUNTRY is chosen at
  // assign time by appending -cc-<CC> to the username (thordata/BrightData style).
  // We store it once (group='provider', username = the BASE with NO country) and
  // let the operator pick any country in the modal. wd-proxy.sh appends -cc-<CC>
  // (verified live: us/gb/de/tr/al all resolve to the right country).
  async listProviders(workspaceId?: string) {
    const rows = await prisma.proxy.findMany({
      where: { ...(workspaceId ? { workspaceId } : {}), group: 'provider' },
      orderBy: { createdAt: 'desc' }
    });
    return rows.map(toPublic);
  }

  // Route ONE device through a provider proxy for a chosen country. Dispatches
  // EMULATOR_SET_PROXY with instance + BASE username + country + decrypted pass;
  // the agent's wd-proxy.sh builds the -cc-<CC> sticky-country login. Persists the
  // device↔proxy link + the chosen country on device.metadata.
  async assignCountryProxy(
    deviceId: string,
    providerId: string,
    countryCode: string,
    workspaceId?: string
  ): Promise<{ jobId: string; country: string }> {
    const cc = countryCode.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc)) throw new AppError('Geçerli bir ülke kodu gerekli (ISO-2)', 400, 'INVALID_COUNTRY');

    const device = await prisma.device.findFirst({
      where: { id: deviceId, ...(workspaceId ? { workspaceId } : {}) },
      select: { id: true, metadata: true }
    });
    if (!device) throw new AppError('Cihaz bulunamadı', 404, 'DEVICE_NOT_FOUND');
    const instance = ((device.metadata ?? {}) as Record<string, unknown>).instance;
    if (typeof instance !== 'string' || !instance) {
      throw new AppError('Bu cihazın Waydroid instance adı yok — proxy gömülemiyor (yalnızca tek-tık kurulan cihazlarda).', 409, 'NO_INSTANCE');
    }

    const provider = await prisma.proxy.findFirst({
      where: { id: providerId, group: 'provider', ...(workspaceId ? { workspaceId } : {}) }
    });
    if (!provider) throw new AppError('Proxy sağlayıcısı bulunamadı', 404, 'PROVIDER_NOT_FOUND');

    const job = await createJobRecord(
      'EMULATOR_SET_PROXY',
      {
        deviceId,
        instance,
        country: cc,
        host: provider.host,
        port: provider.port,
        username: provider.username ?? '',
        // Carry the ciphertext (not plaintext): materializePayload decrypts it at
        // agent-claim time, so the stored payload and GET /jobs/:id never expose
        // the residential-proxy password. Matches bulk.service.ts.
        ...(provider.password ? { passwordEnc: provider.password } : {})
      } as unknown as JobPayload,
      undefined,
      workspaceId
    );

    // Persist the link + chosen country so the card/detail can show it.
    const meta = { ...((device.metadata ?? {}) as Record<string, unknown>), proxyCountry: cc, proxyProviderId: providerId };
    await prisma.device.update({ where: { id: deviceId }, data: { proxyId: providerId, metadata: meta as object } }).catch(() => undefined);

    return { jobId: job.id, country: cc };
  }

  // Health check: actually route a public-IP probe THROUGH the proxy and record
  // the real egress IP. HTTP/HTTPS proxies are tunnelled with undici's
  // ProxyAgent (built into Node's global fetch stack — no extra dependency). The
  // proxy is only marked OK when the tunnelled request succeeds; the recorded
  // exportIp is the IP seen by the upstream service through the proxy, i.e. the
  // proxy's real exit IP, not this server's.
  //
  // SOCKS5 isn't tunnelable via ProxyAgent, so rather than fabricate an OK we
  // leave it UNKNOWN ("not verified") instead of claiming a status we can't back.
  async check(id: string, workspaceId?: string) {
    const proxy = await this.getOwned(id, workspaceId);

    let status: 'OK' | 'FAILED' | 'UNKNOWN' = 'FAILED';
    let exportIp: string | null = null;

    if (proxy.type === 'SOCKS5') {
      // No SOCKS tunnel available here — don't fabricate a result.
      status = 'UNKNOWN';
    } else {
      try {
        // ★2026-07-26: thordata proxy'leri username'e -country-<cc>-sessid-<x>-sesstime-<dk>
        // suffix'i GEREKTİRİR; suffix'siz test thordata tarafından reddedilir → havuz "hepsi
        // FAILED" yanlış-alarmı (gerçek trafik cihazdan redsocks ile suffix'li çıkıyor ve
        // ÇALIŞIR). Canlı-kanıt: suffix'siz→boş, `-country-TR-sessid-x-sesstime-5`→TR-IP.
        // ★sessid ŞART (mobile hesabı sesstime tek başına REDDEDER). Host DOĞRU form:
        // `<sub>.pr.thordata.net` (pr=proxy) — `.eu` tutarsız, resmi `.pr`'ye çevir.
        let testUser = proxy.username || '';
        const testHost = /thordata/i.test(proxy.host) ? proxy.host.replace(/\.eu\.thordata\.net/i, '.pr.thordata.net') : proxy.host;
        if (testUser && /thordata/i.test(proxy.host) && proxy.countryCode && !/-country-/i.test(testUser)) {
          testUser = `${testUser}-country-${proxy.countryCode.toUpperCase()}-sessid-hcheck-sesstime-5`;
        }
        const pass = proxy.password ? decryptString(proxy.password) : '';
        const auth = testUser ? `${testUser}:${pass}` : '';
        // HTTP-CONNECT tüneli ile gerçek exit-IP'yi al (undici'siz, curl-eşdeğeri).
        exportIp = await probeThroughHttpProxy({ proxyHost: testHost, proxyPort: proxy.port, auth, timeoutMs: 10000 });
        status = exportIp ? 'OK' : 'FAILED';
      } catch {
        status = 'FAILED';
      }
    }

    // Rolling health score: reward success, penalize failure, leave UNKNOWN flat.
    // Next check is scheduled sooner for unhealthy proxies, later for healthy ones.
    const now = new Date();
    let score = proxy.score;
    let failCount = proxy.failCount;
    if (status === 'OK') {
      score = Math.min(100, score + 15);
      failCount = 0;
    } else if (status === 'FAILED') {
      score = Math.max(0, score - 25);
      failCount = failCount + 1;
    }
    const nextMs = status === 'OK' && score >= 60 ? 6 * 60 * 60 * 1000 : 20 * 60 * 1000;
    const checksDue = new Date(now.getTime() + nextMs);

    const updated = await prisma.proxy.update({
      where: { id },
      // On a failed/unknown check don't keep a stale exportIp around.
      data: { status, exportIp: status === 'OK' ? exportIp : null, lastCheckedAt: now, score, failCount, checksDue }
    });
    return toPublic(updated);
  }

  // Periodic revalidation: re-check proxies whose checksDue has passed (or was
  // never set). Called by the background ticker in index.ts. Bounded per run so a
  // huge pool doesn't stall the loop. Returns counts for logging.
  async revalidateDue(limit = 25): Promise<{ checked: number; ok: number; failed: number }> {
    const now = new Date();
    const due = await prisma.proxy.findMany({
      where: { OR: [{ checksDue: null }, { checksDue: { lte: now } }] },
      orderBy: [{ checksDue: { sort: 'asc', nulls: 'first' } }],
      take: limit,
      select: { id: true, workspaceId: true }
    });
    let ok = 0;
    let failed = 0;
    for (const p of due) {
      try {
        const r = await this.check(p.id, p.workspaceId ?? undefined);
        if (r.status === 'OK') ok++;
        else if (r.status === 'FAILED') failed++;
      } catch {
        failed++;
      }
    }
    return { checked: due.length, ok, failed };
  }

  // ★2026-07-24: fire a PROXY_UNHEALTHY alert per affected workspace when the revalidation
  // round found a large share of the pool failing. A degraded proxy pool is the #1 WhatsApp
  // ban cause (devices keep exiting through a dead/slow proxy), and it was previously silent
  // — only logged. Groups the CURRENTLY-failed proxies by workspace so each tenant hears
  // about its own pool. Best-effort; never throws into the ticker.
  async alertUnhealthyPool(round: { checked: number; ok: number; failed: number }): Promise<void> {
    try {
      // ★2026-08-11 YANLIŞ ALARM DÜZELTMESİ — "kaç cihaz ETKİLENİYOR"a bak.
      // Eski hâli FAILED durumdaki TÜM proxy KAYITLARINI sayıyordu; o kaydı bir cihazın
      // kullanıp kullanmadığına BAKMIYORDU. Sonuç: kullanılmayan/ölü bir havuz kaydı
      // yüzünden alarm 30 dakikada bir, SAATLERCE tekrarlıyordu.
      // CANLI ÖLÇÜM (11 Ağu, alarm 20 saattir tekrarlıyordu): 2 kayıt FAILED idi ama
      // birini 0, diğerini 1 cihaz kullanıyordu; 94 cihaz zaten SAĞLIKLI kayıttaydı ve
      // örneklenen 5 cihazın 5'i de TR'den, FARKLI IP'lerle çıkıyordu. Yani gerçek
      // "datacenter-IP sızıntısı" riski YOKTU — alarm boşuna operatörü uyandırıyordu.
      // Artık cihazı OLMAYAN FAILED kayıtlar alarma sebep olmuyor (yine de aşağıda
      // loglanıyor ki ölü kayıt sessizce birikmesin).
      const failedProxies = await prisma.proxy.findMany({
        where: { status: 'FAILED' },
        select: { id: true, workspaceId: true, label: true }
      });
      // Etkilenen cihaz sayısını proxy başına çıkar (yalnızca ONLINE cihazlar sayılır —
      // kapalı bir cihaz o an trafik üretmiyor, dolayısıyla ban riski de taşımıyor).
      const affected = failedProxies.length
        ? await prisma.device.groupBy({
            by: ['proxyId'],
            where: { status: 'ONLINE', proxyId: { in: failedProxies.map((p) => p.id) } },
            _count: { _all: true }
          }).catch(() => [] as Array<{ proxyId: string | null; _count: { _all: number } }>)
        : [];
      const deviceCountByProxy = new Map(affected.map((a) => [a.proxyId ?? '', a._count._all]));
      const unusedFailed = failedProxies.filter((p) => (deviceCountByProxy.get(p.id) ?? 0) === 0);
      if (unusedFailed.length) {
        logger.warn('proxy: FAILED ama HİÇBİR cihaz kullanmıyor (alarm üretilmedi)', {
          count: unusedFailed.length, labels: unusedFailed.map((p) => p.label).slice(0, 5)
        });
      }
      // Workspace başına ETKİLENEN CİHAZ sayısını topla.
      const byWs = new Map<string, { proxies: number; devices: number }>();
      for (const p of failedProxies) {
        const devices = deviceCountByProxy.get(p.id) ?? 0;
        if (!p.workspaceId || devices === 0) continue;   // cihazı yoksa alarm YOK
        const cur = byWs.get(p.workspaceId) ?? { proxies: 0, devices: 0 };
        byWs.set(p.workspaceId, { proxies: cur.proxies + 1, devices: cur.devices + devices });
      }
      for (const [workspaceId, { proxies, devices }] of byWs) {
        const detail = `${devices} cihaz BAŞARISIZ proxy üzerinden çıkıyor (${proxies} proxy kaydı bozuk; tur: ${round.failed}/${round.checked}). Datacenter-IP sızıntısı = WhatsApp ban riski. Proxy sağlayıcısını (thordata) ve kredi/erişimi kontrol edin.`;
        void alertsService
          .evaluate(workspaceId, 'PROXY_UNHEALTHY', { title: `⚠️ Proxy havuzu sağlıksız — ${devices} cihaz etkileniyor`, detail })
          .catch(() => undefined);
      }
    } catch {
      /* never break the ticker */
    }
  }

  // ★2026-07-26: thordata hesabının KALAN TRAFİĞİNİ (GB) sorgula. token = Dashboard →
  // My Account API token'ı (proxy user/pass DEĞİL). Döner: { balanceMb, expiration } veya
  // null (token yok/hata). openapi.thordata.com public API.
  async fetchThordataBalance(token: string): Promise<{ balanceMb: number; expiration: string } | null> {
    if (!token) return null;
    try {
      const res = await fetch(`https://openapi.thordata.com/api/account/traffic-balance?token=${encodeURIComponent(token)}`, {
        signal: AbortSignal.timeout(12000)
      });
      const json = (await res.json()) as { code?: number; data?: { traffic_balance?: number; expiration_time?: string } };
      if (json.code !== 200 || !json.data) return null;
      return { balanceMb: Number(json.data.traffic_balance ?? 0), expiration: String(json.data.expiration_time ?? '') };
    } catch {
      return null;
    }
  }

  // Günlük ticker: env'deki thordata token(lar)ı için kalan GB'yi kontrol et; eşiğin
  // (varsayılan 2 GB) altındaysa PROXY_CREDIT_LOW alarmı at (top-up hatırlatması).
  // Birden çok hesap: FLEET_THORDATA_TOKEN (residential) + FLEET_THORDATA_TOKEN_MOBILE.
  // Best-effort — token yoksa sessizce atlar, asla ticker'ı kırmaz.
  async checkThordataCredit(): Promise<void> {
    try {
      const thresholdGb = Number(process.env.FLEET_PROXY_CREDIT_ALERT_GB || 2);
      const accounts: Array<{ label: string; token: string }> = [
        { label: 'residential (AL/BG)', token: process.env.FLEET_THORDATA_TOKEN || '' },
        { label: 'mobile (TR)', token: process.env.FLEET_THORDATA_TOKEN_MOBILE || '' }
      ].filter((a) => a.token);
      if (!accounts.length) return; // token yapılandırılmamış — atla

      const anyWs = await prisma.workspace.findFirst({ select: { id: true } });
      if (!anyWs) return;

      for (const acc of accounts) {
        const bal = await this.fetchThordataBalance(acc.token);
        if (!bal) continue;
        const gb = bal.balanceMb / 1024;
        if (gb < thresholdGb) {
          const detail = `thordata ${acc.label} hesabında kalan trafik: ${gb.toFixed(2)} GB (${bal.balanceMb.toFixed(0)} MB), bitiş: ${bal.expiration}. Eşiğin (${thresholdGb} GB) altına düştü — bitince cihazlar datacenter-IP'ye düşer (WhatsApp ban riski). Panelden/thordata'dan trafik yükleyin (top-up).`;
          void alertsService
            .evaluate(anyWs.id, 'PROXY_CREDIT_LOW', { title: `⚠️ Proxy trafiği azaldı — ${acc.label}: ${gb.toFixed(1)} GB kaldı`, detail, value: gb })
            .catch(() => undefined);
        }
      }
    } catch {
      /* never break the ticker */
    }
  }

  // Workspace-scoped ownership check: returns the proxy only if the caller owns
  // it (or the caller is a service identity with no workspace). Prevents a tenant
  // from editing/deleting/probing another tenant's proxy by id.
  private async getOwned(id: string, workspaceId?: string): Promise<Proxy> {
    const proxy = await prisma.proxy.findUnique({ where: { id } });
    if (!proxy || (workspaceId && proxy.workspaceId && proxy.workspaceId !== workspaceId)) {
      throw new AppError('Proxy not found', 404, 'PROXY_NOT_FOUND');
    }
    return proxy;
  }
}
