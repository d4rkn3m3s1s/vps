// ★★★2026-08-18 CANLI OPERASYON AKISI — her HTTP istegi + is akisi tek ekranda.
//
// NEDEN DB'YE YAZMIYORUZ (bilincli karar):
//   Agent `/agent/jobs/next` ucunu SUREKLI yokluyor (uzun-yoklama, ~2 sn) ve her
//   host heartbeat gonderiyor. Bu trafigi Postgres'e yazmak gunde yuz binlerce satir
//   demek; ustelik bu projede "buyuk tabloyu bellege cekmek" API'yi ZATEN bir kez
//   cokertti (/analytics 298 MB, /reports/jobs 410 MB → SIGABRT).
//   Operator "CANLI gormek" istiyor, gecmisi sorgulamak degil. Bu yuzden:
//     • sabit boyutlu BELLEK halka tamponu (varsayilan 1000 kayit)
//     • yeni kayit WS ile aninda panele itilir
//   Disk maliyeti SIFIR, sorgu yok, buyume yok. API yeniden baslarsa tampon bosalir
//   (kabul: canli akis zaten "su an ne oluyor" sorusuna cevap verir).
//
// GIZLILIK: govde ve basliklar ASLA saklanmaz. Yalnizca yontem/yol/durum/sure ve
// kaba kaynak bilgisi tutulur; sorgu dizesindeki olasi token'lar maskelenir.

import type { NextFunction, Request, Response } from 'express';
import { deviceHub } from '../devices/device.hub';

export type OpsRequestEntry = {
  id: string;
  at: string;              // ISO
  method: string;
  path: string;            // maskelenmis (querystring'de token yok)
  status: number;
  ms: number;
  // Kimin cagirdigi — panelde renk/filtre icin. Yol ve kimlik basliklarindan cikarilir.
  source: 'panel' | 'agent' | 'public' | 'bilinmiyor';
  workspaceId?: string | undefined;
  ip?: string | undefined;
};

// Halka tampon: sabit boyut, en yeni sonda. Buyume YOK.
const MAX = Math.max(100, Number(process.env.OPS_BUFFER || 1000));
const buffer: OpsRequestEntry[] = [];
let seq = 0;

// Sayaclar — panelin ust seridi (toplam/hata/ortalama sure) icin. Ucuz, O(1).
const counters = { total: 0, err4xx: 0, err5xx: 0, sumMs: 0 };

// Bu yollar akisi BOGAR ve bilgi degeri dusuktur; sayaclara girer ama listede
// gosterilmez. (Agent uzun-yoklamasi saniyede birkac kez tekrarlar.)
const NOISY = [/^\/health$/, /^\/metrics$/, /^\/favicon\.ico$/];

// Sorgu dizesindeki gizli olabilecek degerleri maskele (token/key/secret/password).
function maskQuery(url: string): string {
  const qi = url.indexOf('?');
  if (qi < 0) return url.slice(0, 200);
  const base = url.slice(0, qi);
  const qs = url.slice(qi + 1);
  const parts = qs.split('&').map((kv) => {
    const eq = kv.indexOf('=');
    if (eq < 0) return kv;
    const k = kv.slice(0, eq);
    return /token|key|secret|password|auth|sig/i.test(k) ? `${k}=***` : kv;
  });
  return `${base}?${parts.join('&')}`.slice(0, 200);
}

// ⚠️YOL, istek BASINDA yakalanmali. Express bir router'a girerken `req.path`'i
// KIRPAR (mount oneki `req.baseUrl`'e tasinir): `/agent/jobs/next-batch` sonradan
// `/jobs/next-batch` olur. Ilk surumde siniflandirmayi res 'finish' icinde yapmistim
// ve TUM agent trafigi "bilinmiyor" cikti (canli olcum: 83 istek /agent/jobs/next-batch
// oldugu halde agent sayaci 0). `originalUrl` degistirilmez — dogru kaynak odur.
function classify(rawUrl: string, hasAuthHeader: boolean): OpsRequestEntry['source'] {
  const p = rawUrl.split('?')[0] ?? '';
  if (p.startsWith('/agent/')) return 'agent';
  if (p.startsWith('/v1/') || p.startsWith('/public/')) return 'public';
  // Panel, sunucu tarafindan servis kimligiyle cagirir; JWT tasir.
  if (hasAuthHeader) return 'panel';
  return 'bilinmiyor';
}

export function recordRequest(entry: OpsRequestEntry): void {
  buffer.push(entry);
  if (buffer.length > MAX) buffer.splice(0, buffer.length - MAX);
  // Canli itis — panel acik degilse deviceHub zaten kimseye yollamaz (ucuz no-op).
  deviceHub.broadcast({
    type: 'ops.request',
    deviceId: '',
    payload: entry,
    timestamp: entry.at,
    ...(entry.workspaceId ? { workspaceId: entry.workspaceId } : {})
  });
}

// Express middleware: istek BITTIGINDE (res 'finish') kaydeder. Islem O(1),
// gövde/başlık kopyalanmaz — sicak yolda olcülebilir yuk birakmaz.
export function opsRequestLogger(req: Request, res: Response, next: NextFunction): void {
  const started = process.hrtime.bigint();
  // ★Yolu ve kaynagi SIMDI yakala — routing sonrasi `req.path` kirpilmis olur (bkz. classify).
  const rawUrl = req.originalUrl || req.url || '';
  const source = classify(rawUrl, Boolean(req.header('authorization')));
  const method = req.method;
  const ip = req.ip;
  res.on('finish', () => {
    try {
      const ms = Number((process.hrtime.bigint() - started) / 1000000n);
      counters.total += 1;
      counters.sumMs += ms;
      if (res.statusCode >= 500) counters.err5xx += 1;
      else if (res.statusCode >= 400) counters.err4xx += 1;

      const bare = rawUrl.split('?')[0] ?? '';
      if (NOISY.some((re) => re.test(bare))) return;   // sayaca girdi, listeye girmez

      seq += 1;
      recordRequest({
        id: `r${seq}`,
        at: new Date().toISOString(),
        method,
        path: maskQuery(rawUrl),
        status: res.statusCode,
        ms,
        source,
        // auth, routing SONRASI dolar — bu yuzden finish icinde okunur (dogru olan bu).
        ...(req.auth?.workspaceId ? { workspaceId: req.auth.workspaceId } : {}),
        ...(ip ? { ip } : {})
      });
    } catch {
      /* olcum asla istegi etkilemesin */
    }
  });
  next();
}

// Panelin ilk dolumu: en yeni N kayit + ozet sayaclar.
export function listRequests(limit = 200, workspaceId?: string | undefined): {
  requests: OpsRequestEntry[];
  summary: { total: number; err4xx: number; err5xx: number; avgMs: number; buffered: number };
} {
  const n = Math.max(1, Math.min(1000, limit));
  const rows = buffer.filter((e) => !workspaceId || !e.workspaceId || e.workspaceId === workspaceId);
  return {
    requests: rows.slice(-n).reverse(),   // en yeni once
    summary: {
      total: counters.total,
      err4xx: counters.err4xx,
      err5xx: counters.err5xx,
      avgMs: counters.total ? Math.round(counters.sumMs / counters.total) : 0,
      buffered: buffer.length
    }
  };
}

export const opsService = { listRequests, recordRequest };
