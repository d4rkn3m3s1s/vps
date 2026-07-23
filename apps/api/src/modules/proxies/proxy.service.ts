import type { Proxy, ProxyType } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { decryptString, encryptString } from '../../lib/crypto';
import { AppError } from '../../lib/errors';
import { createJobRecord } from '../jobs/jobs.service';
import type { JobPayload } from '../jobs/job.types';
import type { ProxyCreateInput, ProxyUpdateInput } from './proxy.types';
import { alertsService } from '../alerts/alerts.service';

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
        // undici ships inside Node (it backs global fetch). We import it via a
        // computed specifier so the bundler/TS doesn't hard-require its type
        // package, and treat ProxyAgent/dispatcher loosely. The `dispatcher`
        // fetch option is honored by Node's fetch even though it's absent from
        // the standard fetch typings.
        const undiciMod = 'undici';
        const undici = (await import(undiciMod)) as {
          ProxyAgent: new (opts: { uri: string }) => { close(): Promise<void> };
        };
        const auth =
          proxy.username
            ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password ? decryptString(proxy.password) : '')}@`
            : '';
        const dispatcher = new undici.ProxyAgent({ uri: `http://${auth}${proxy.host}:${proxy.port}` });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        try {
          // The IP this returns is the one the upstream sees → the proxy's exit IP.
          const res = await fetch('https://api.ipify.org?format=json', {
            signal: controller.signal,
            dispatcher
          } as unknown as RequestInit);
          if (res.ok) {
            const json = (await res.json()) as { ip?: string };
            exportIp = json.ip ?? null;
            status = exportIp ? 'OK' : 'FAILED';
          }
        } finally {
          clearTimeout(timer);
          await dispatcher.close().catch(() => undefined);
        }
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
      const failedProxies = await prisma.proxy.findMany({
        where: { status: 'FAILED' },
        select: { workspaceId: true }
      });
      const byWs = new Map<string, number>();
      for (const p of failedProxies) {
        if (!p.workspaceId) continue;
        byWs.set(p.workspaceId, (byWs.get(p.workspaceId) ?? 0) + 1);
      }
      const detail = `Proxy sağlık kontrolünde ${round.failed}/${round.checked} proxy BAŞARISIZ. Cihazlar sağlıksız proxy üzerinden çıkıyor olabilir — datacenter-IP sızıntısı = WhatsApp ban riski. Proxy sağlayıcısını (thordata) ve kredi/erişimi kontrol edin.`;
      for (const [workspaceId, count] of byWs) {
        void alertsService
          .evaluate(workspaceId, 'PROXY_UNHEALTHY', { title: `⚠️ Proxy havuzu sağlıksız — ${count} proxy başarısız`, detail })
          .catch(() => undefined);
      }
      // If no failed proxy carries a workspace (service-owned pool), still alert once
      // globally through any workspace so the operator isn't left blind.
      if (byWs.size === 0 && failedProxies.length > 0) {
        const anyWs = await prisma.workspace.findFirst({ select: { id: true } });
        if (anyWs) void alertsService.evaluate(anyWs.id, 'PROXY_UNHEALTHY', { title: '⚠️ Proxy havuzu sağlıksız', detail }).catch(() => undefined);
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
