---
name: device-tags-feature
description: "YENİ ÖZELLİK 2026-06-29: cihaz etiketleri (Device.tags) + tag'e göre filtreleme. /profiles'ta tag chip filtre satırı + kart başına chip + '+ etiket' editör. Grants/transfer/revoke IDOR'ları da kapatıldı."
metadata:
  node_type: memory
  type: project
  originSessionId: f759a3b2-5af6-41bc-84c4-481e3e98ff97
---

GÜVENLİK (kalan IDOR'lar kapatıldı, canlı):
- grants.service: grant() device lookup workspace-scoped; revoke(grantId, workspaceId) findFirst scoped;
  transfer(deviceId, target, workspaceId) kaynak cihaz workspace-scoped. Controller getWorkspaceId geçiyor.
- (permissions.service RBAC dokunulmadı — requireAdmin gated, doğrudan tenant-data IDOR değil.)

YENİ ÖZELLİK — Cihaz Etiketleri:
- SCHEMA: Device.tags String[] @default([]) + GIN index (Device_tags_idx). Migration 20260629140000_device_tags
  (ADD COLUMN IF NOT EXISTS + CREATE INDEX GIN).
- API: device.types DeviceUpdateInput.tags; updateDevice normalize (trim+lowercase+dedupe+cap 20×32);
  listDevices(workspaceId, tag) → tags:{has:tag}; controller list ?tag= + update schema tags z.array max20.
- UI (ProfilesView): tags?: string[] tipte; allTags memo; filtered'a tagFilter + arama tag'e de bakıyor;
  filtre panelinde tag-chip satırı (Tümü + #tag toggle); kart başına .card-tags chip'ler (tıkla→filtrele) +
  "+ etiket" editör (window.prompt, optimistic local update via setDevices). globals.css: .tag-chip/.tag-filter-row/.card-tags.

DOĞRULANDI CANLI: PUT tags ["warmup","us-geo","VIP "] → kaydedildi "warmup,us-geo,vip" (normalize çalışıyor);
?tag=warmup→1, ?tag=nonexistent→0; /profiles 200; tags dashboard'a akıyor. Her iki app tsc temiz.

KARAR: "Birleşik aktivite akışı" YAPILMADI — AuditView (/audit) zaten aynı işi yapıyor (kronolojik, user email,
filtre). ActivityTimeline.tsx kullanılmıyor ama yetenek mevcut → redundant olurdu. Onun yerine ABSENT olan
device tags yapıldı. [[security-round-2-2026-06-29]] + [[device-health-charts]] + [[optimization-round-2026-06-29]]
aynı oturum. Windows-API kuralı: schema değişti → API durdur→generate→restart→agent restart yapıldı.
