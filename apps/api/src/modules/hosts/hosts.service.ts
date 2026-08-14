import { readFile } from 'node:fs/promises';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { sha256 } from '../../lib/crypto';
import { AppError } from '../../lib/errors';

// Host üstündeki kurtarma ucu (wd-kurtar). Root çalışır, systemd tıkalıyken de
// yanıt verir; API'nin root yetkisi olmadığı için müdahaleler oraya devredilir.
const RESCUE_BASE = process.env.RESCUE_URL ?? 'http://127.0.0.1:4700';
const RESCUE_TOKEN_FILE = process.env.RESCUE_TOKEN_FILE ?? '/opt/fleet-agent/state/kurtar.token';

export type HostCreateInput = {
  name: string;
  address: string;
  region?: string | undefined;
  capacity?: number | undefined;
  cpuCores?: number | undefined;
  memoryGb?: number | undefined;
  kvm?: boolean | undefined;
};

export type HostHeartbeatInput = {
  status?: 'ONLINE' | 'OFFLINE' | 'DEGRADED' | undefined;
  runningPhones?: number | undefined;
  capacity?: number | undefined;
};

// Hide the agent key hash from API responses.
function toPublic<T extends { agentKeyHash: string | null }>(host: T) {
  const { agentKeyHash, ...rest } = host;
  return { ...rest, hasAgentKey: Boolean(agentKeyHash) };
}

export class HostsService {
  async list(workspaceId?: string) {
    const rows = await prisma.host.findMany({
      where: { ...(workspaceId ? { workspaceId } : {}) },
      orderBy: { createdAt: 'desc' }
    });
    return rows.map(toPublic);
  }

  // Registers a host and returns a one-time agent key (shown once) the host
  // agent uses to authenticate heartbeats.
  async create(input: HostCreateInput, workspaceId?: string) {
    const agentKey = `host_${sha256(input.name + input.address + Date.now()).slice(0, 32)}`;
    const data: Prisma.HostCreateInput = {
      name: input.name,
      address: input.address,
      agentKeyHash: sha256(agentKey),
      ...(input.region ? { region: input.region } : {}),
      ...(typeof input.capacity === 'number' ? { capacity: input.capacity } : {}),
      ...(typeof input.cpuCores === 'number' ? { cpuCores: input.cpuCores } : {}),
      ...(typeof input.memoryGb === 'number' ? { memoryGb: input.memoryGb } : {}),
      ...(typeof input.kvm === 'boolean' ? { kvm: input.kvm } : {}),
      ...(workspaceId ? { workspace: { connect: { id: workspaceId } } } : {})
    };
    const host = await prisma.host.create({ data });
    return { ...toPublic(host), agentKey };
  }

  async heartbeat(id: string, input: HostHeartbeatInput) {
    // The caller is already authenticated as this host (per-host agent key), so we
    // can update directly; a missing row throws via Prisma's record-not-found.
    const host = await prisma.host.update({
      where: { id },
      data: {
        status: input.status ?? 'ONLINE',
        ...(typeof input.runningPhones === 'number' ? { runningPhones: input.runningPhones } : {}),
        ...(typeof input.capacity === 'number' ? { capacity: input.capacity } : {}),
        lastSeenAt: new Date()
      }
    });
    return toPublic(host);
  }

  async remove(id: string, workspaceId?: string) {
    // Scope the lookup to the caller's workspace: a host in another tenant is
    // simply "not found" rather than deletable cross-tenant.
    const host = await prisma.host.findFirst({
      where: { id, ...(workspaceId ? { workspaceId } : {}) }
    });
    if (!host) throw new AppError('Host not found', 404, 'HOST_NOT_FOUND');
    return prisma.host.delete({ where: { id } });
  }

  // ★2026-08-14: tek tıkla AGENT SIFIRLAMA.
  // Neden: canlı yayın kanalı (agent → /ws/agent-stream) API restart'ında veya ağ
  // kesintisinde kopuyor ve kendiliğinden dönmeyebiliyor — panelde "Sunucu aracısı
  // çevrimdışı" görünüyor, tek çare SSH'tan `systemctl restart fleet-agent` oluyordu.
  // Operatör gece yarısı SSH açamayabilir (14 Ağu: SSH 5 saat kilitliydi), bu yüzden
  // müdahale panele taşındı.
  //
  // Mimari: API'nin root yetkisi YOK. Host üstünde zaten root çalışan kurtarma ucu var
  // (wd-kurtar, 127.0.0.1:4700) — çağrıyı ona devrediyoruz. O uç systemd'ye bağımlı
  // olmayan `pkill`/`systemctl` adımlarını yürütür.
  async resetAgent(id: string, workspaceId?: string): Promise<{ ok: boolean; detail: string }> {
    const host = await prisma.host.findFirst({
      where: { id, ...(workspaceId ? { workspaceId } : {}) },
      select: { id: true, name: true }
    });
    if (!host) throw new AppError('Host not found', 404, 'HOST_NOT_FOUND');

    const token = await readFile(RESCUE_TOKEN_FILE, 'utf8')
      .then((t) => t.trim())
      .catch(() => '');
    if (!token) {
      throw new AppError(
        'Kurtarma ucu yapılandırılmamış (token dosyası yok)',
        503,
        'RESCUE_NOT_CONFIGURED'
      );
    }

    // Kurtarma ucu tıkalı bir sistemde de yanıt vermeli; yine de sonsuza kadar
    // bekleme — kullanıcı butona bastığında sonucu görmeli.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 30_000);
    try {
      const url = `${RESCUE_BASE}/kurtar/eylem?ad=sifirla-agent&token=${encodeURIComponent(token)}`;
      const res = await fetch(url, { method: 'GET', signal: ac.signal });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; cikti?: string };
      if (!res.ok) {
        throw new AppError('Kurtarma ucu hata döndü', 502, 'RESCUE_FAILED');
      }
      return { ok: body.ok !== false, detail: String(body.cikti ?? '').slice(0, 500) };
    } catch (err) {
      if (err instanceof AppError) throw err;
      const reason = err instanceof Error && err.name === 'AbortError' ? 'zaman aşımı' : 'ulaşılamadı';
      throw new AppError(`Kurtarma ucuna ${reason}`, 502, 'RESCUE_UNREACHABLE');
    } finally {
      clearTimeout(timer);
    }
  }
}

export const hostsService = new HostsService();
