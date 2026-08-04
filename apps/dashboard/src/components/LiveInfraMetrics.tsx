'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFleetEvents } from '../lib/live';
import type { DeckMetric } from './CommandDeck';

// Ana sayfanın "Canlı Altyapı" kartlarını GERÇEKTEN canlı tutar.
//
// Neden gerekli: ana sayfa bir sunucu bileşeni (`force-dynamic`) — veriyi sayfa
// AÇILDIĞI anda çeker ve orada dondurur. Ölçümlerin kendisi gerçek ve 30 sn'de
// bir tazeleniyor (agent ADB ile /proc + df okuyup `/agent/device-metrics`e
// gönderiyor), ama panel bunu sayfa yenilenmeden asla görmüyordu.
//
// Tazeleme iki kaynaktan tetiklenir:
//   1) `device.metrics` olayı — host ölçümleri yazdığında (asıl yol, ~30 sn)
//   2) 30 sn'lik yedek zamanlayıcı — WS kopuksa kartlar yine de bayatlamaz
//
// Sunucudan gelen ilk değerler `initial` olarak verilir; böylece ilk boyamada
// boş/sıfır kart görünmez (sunucu zaten veriyi getirmiş durumda).

type MetricsPayload = {
  cpuPct: number;
  memPct: number;
  diskPct: number;
  onlineCount: number;
  queueWaiting: number;
  queueActive: number;
};

const REFRESH_MS = 30_000;

function tone(p: number): DeckMetric['tone'] {
  return p >= 85 ? 'error' : p >= 65 ? 'warning' : p >= 40 ? 'info' : 'success';
}

export function buildMetrics(m: MetricsPayload): DeckMetric[] {
  const busy = m.queueWaiting + m.queueActive;
  return [
    {
      key: 'cpu',
      label: 'Cihaz CPU (ort.)',
      percent: m.cpuPct,
      detail: `${m.onlineCount} çevrimiçi cihaz`,
      tone: tone(m.cpuPct),
    },
    {
      key: 'memory',
      label: 'Cihaz Bellek (ort.)',
      percent: m.memPct,
      detail: m.onlineCount > 0 ? `${m.onlineCount} cihaz ortalaması` : 'çevrimiçi cihaz yok',
      tone: tone(m.memPct),
    },
    {
      // ★2026-08-04: eskiden "Kuyruk Verimi" idi ve yüzdesi
      // (aktif+bekleyen) / TÜM ZAMANLARIN iş sayısı ile hesaplanıyordu. Payda
      // on binlerce olduğu için sonuç PRATİKTE HER ZAMAN %0 çıkıyordu — ölçü
      // hiçbir bilgi taşımıyordu. Artık mutlak sayı gösteriliyor; yüzde ise
      // "kuyruk ne kadar dolu" için 20 işlik bir ölçekte doluluk.
      key: 'network',
      label: 'İş Kuyruğu',
      percent: Math.min(100, Math.round((busy / 20) * 100)),
      detail: busy === 0 ? 'kuyruk boş' : `${m.queueWaiting} bekliyor · ${m.queueActive} çalışıyor`,
      tone: busy === 0 ? 'success' : tone(Math.min(100, (busy / 20) * 100)),
    },
    {
      key: 'storage',
      label: 'Cihaz Disk (ort.)',
      percent: m.diskPct,
      detail: `${m.onlineCount} çevrimiçi cihaz`,
      tone: tone(m.diskPct),
    },
  ];
}

export function useLiveInfraMetrics(initial: DeckMetric[]): DeckMetric[] {
  const [metrics, setMetrics] = useState<DeckMetric[]>(initial);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    // Üst üste binen istekleri engelle: WS olayı ve zamanlayıcı aynı anda
    // tetiklenebilir; iki eşzamanlı çekim gereksiz yük ve yarış demektir.
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch('/api/infra-metrics', { cache: 'no-store' });
      if (!res.ok) return;
      const json = await res.json();
      if (json?.data) setMetrics(buildMetrics(json.data as MetricsPayload));
    } catch {
      // Geçici hata — bir sonraki turda yeniden denenir. Eski değerler kalır
      // (sıfırlamak "cihazlar boşta" gibi YANLIŞ bir izlenim verirdi).
    } finally {
      inFlight.current = false;
    }
  }, []);

  // Asıl tetikleyici: host ölçümleri yazdığında gelen özet olay.
  useFleetEvents(['device.metrics'], () => { void refresh(); });

  // Yedek: WS kopuksa kartlar bayatlamasın.
  useEffect(() => {
    const t = setInterval(() => { void refresh(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [refresh]);

  return metrics;
}
