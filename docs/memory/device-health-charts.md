---
name: device-health-charts
description: "YENİ ÖZELLİK 2026-06-29: cihaz başına CPU/bellek/disk canlı zaman serisi grafiği (sparkline). DeviceMetricPoint tablosu + endpoint + profil detayında 'Cihaz Sağlığı' paneli."
metadata:
  node_type: memory
  type: project
  originSessionId: f759a3b2-5af6-41bc-84c4-481e3e98ff97
---

Explore ajanı 6 aday taradı; "per-device live resource charts" GERÇEKTEN EKSİK çıktı (veri akıyordu ama
zaman-serisi depolama + UI yoktu — Device satırında sadece anlık değer vardı). EKLENDİ:

1. SCHEMA: yeni `DeviceMetricPoint` modeli (deviceId, cpuUsage, memoryUsage, diskUsage, capturedAt;
   @@index([deviceId, capturedAt]); Device.metricPoints relation; onDelete Cascade). Migration:
   20260629130000_device_metric_points (CREATE TABLE IF NOT EXISTS + FK DO$$ guard).
2. CAPTURE: agent.service.updateDeviceMetrics artık her metrik raporunda deviceMetricPoint.create yapıyor
   (best-effort .catch). Opportunistic prune: updated>0 && epoch%20==0 iken 7 günden eski noktaları siler
   (tablo sınırsız büyümez). Agent zaten ~10-30sn'de /agent/device-metrics gönderiyor.
3. API: deviceService.getMetrics(id, hours=6, workspaceId) — workspace-scoped, since-pencereli, take 2000,
   {t,cpu,mem,disk} döndürür. getDeviceMetricsHandler + route GET /devices/:id/metrics?hours=N (1..168,
   requireApiKey+authenticateJwt). Dashboard proxy: app/api/devices/[id]/metrics/route.ts.
4. UI: DeviceMetricsPanel.tsx (profiles/[id]) — BAĞIMSIZ SVG sparkline (chart lib YOK, bundle yalın).
   CPU(mavi)/Bellek(mor)/Disk(turuncu) satırları + anlık % + 1s/6s/24s aralık toggle (seg-mini).
   30sn'de bir usePolling ile canlı tazeler. ProfileDetailView'a "Cihaz Sağlığı" olarak gömüldü (LiveScreen sonrası).
   globals.css: .metric-stack/.metric-row/.metric-spark/.seg-mini eklendi.

DOĞRULANDI CANLI: endpoint Phone01 için 3-4 gerçek nokta döndü (cpu=1.7 mem=57.8 disk=38 trend), profil
sayfası 200, dashboard proxy 200. Her iki app tsc temiz.

NOT: schema değişti → API durdur→prisma generate→restart→agent restart yapıldı ([[session-state-live-issues]]
kuralı). [[optimization-round-2026-06-29]] ile aynı oturum. KALAN aday yenilikler: device tags/smart groups
(ABSENT, değerli), activity feed (ActivityTimeline.tsx VAR ama bağlı değil), PDF export.
